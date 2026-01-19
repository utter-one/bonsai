import { inject } from "tsyringe";
import { NotFoundError } from "../../errors";
import { Classifier, ContextTransformer, Conversation, Project, Stage } from "../../types/models";
import { db } from "../../db";
import { ConversationService } from "../ConversationService";
import { logger } from "../../utils/logger";
import { PersonaService } from "../PersonaService";
import { Session, SessionManager } from "./SessionManager";
import { EndAiVoiceOutputMessage, SendAiVoiceChunkMessage, StartAiVoiceOutputMessage } from "../../contracts/websocket/aiResponse";
import { ILlmProvider } from "../providers/llm/ILlmProvider";
import { IAsrProvider } from "../providers/asr/IAsrProvider";
import { ITtsProvider } from "../providers/tts/ITtsProvider";
import { LlmProviderFactory } from "../providers/llm/LlmProviderFactory";
import { AsrProviderFactory } from "../providers/asr/AsrProviderFactory";
import { TtsProviderFactory } from "../providers/tts/TtsProviderFactory";
import { UserInputProcessor } from "./UserInputProcessor";

export type ClassifierRuntimeData = {
  classifier: Classifier;
  llmProvider: ILlmProvider;
}

export type TransformerRuntimeData = {
  transformer: ContextTransformer;
  llmProvider: ILlmProvider;
}

export type StageRuntimeData = {
  id: string;
  conversation: Conversation;
  project: Project;
  stage: Stage;
  completionLlmProvider?: ILlmProvider;
  classifiers: ClassifierRuntimeData[];
  transformers: TransformerRuntimeData[];
  asrProvider?: IAsrProvider;
  ttsProvider?: ITtsProvider;
}

export type ConversationState = 'awaiting_user_input' // Runner is waiting for user input (text or voice)
  | 'receiving_user_voice' // Runner is receiving voice input from user (ASR in progress)
  | 'processing_user_input' // Runner is processing user input (classification/transformation)
  | 'generating_response' // Runner is generating a response  
  | 'finished' // Runner has finished
  | 'failed'; // Runner has failed due to an error

/** 
 * Manages the lifecycle and state of a conversation. Runners are hosted by the SessionManager.
 */
export class ConversationRunner {
  private stageData: StageRuntimeData;
  private state: ConversationState = 'awaiting_user_input';
  private failureReason?: string;
  private session: Session;

  constructor(
    @inject(SessionManager) private sessionManager: SessionManager,
    @inject(LlmProviderFactory) private llmProviderFactory: LlmProviderFactory,
    @inject(AsrProviderFactory) private asrProviderFactory: AsrProviderFactory,
    @inject(TtsProviderFactory) private ttsProviderFactory: TtsProviderFactory,
    @inject(ConversationService) private conversationService: ConversationService,
    @inject(PersonaService) private personaService: PersonaService,
    @inject(UserInputProcessor) private userInputProcessor: UserInputProcessor,
  ) { }

  private getWebSocket(): WebSocket | undefined {
    return this.sessionManager.getWebSocketForSession(this.session.id);
  }

  public getRuntimeData(): StageRuntimeData {
    return this.stageData;
  }

  async prepareConversation(conversationId: string, session: Session): Promise<void> {
    this.session = session;

    // Load conversation data
    const conversation = await db.query.conversations.findFirst({ where: (conversations, { eq }) => eq(conversations.id, conversationId) });
    if (!conversation) {
      throw new NotFoundError(`Conversation with ID ${conversationId} not found`);
    }

    // Check if conversation is active
    if (conversation.status !== 'active') {
      throw new Error(`Conversation with ID ${conversationId} is not active`);
    }

    this.stageData = await this.buildStageData(conversation);
    this.state = this.stageData.stage.enterBehavior === 'await_user_input' ? 'awaiting_user_input' : 'generating_response';
    await this.wireUpProviders();
  }

  private async buildStageData(conversation: Conversation): Promise<StageRuntimeData> {
    // Load current stage data
    const stage = await db.query.stages.findFirst({ where: (stages, { eq }) => eq(stages.id, conversation.stageId) });
    if (!stage) {
      throw new NotFoundError(`Stage with ID ${conversation.stageId} not found`);
    }

    const project = await db.query.projects.findFirst({ where: (projects, { eq }) => eq(projects.id, stage.projectId) });

    const stageData: StageRuntimeData = {
      id: stage.id,
      stage: stage,
      project: project,
      conversation: conversation,
      completionLlmProvider: undefined,
      classifiers: [],
      transformers: [],
      asrProvider: undefined,
      ttsProvider: undefined,
    };

    // Load completion LLM provider for the stage
    if (stage.llmProviderId) {
      const llmProviderEntity = await db.query.providers.findFirst({ where: (providers, { eq }) => eq(providers.id, stage.llmProviderId) });
      if (llmProviderEntity) {
        stageData.completionLlmProvider = this.llmProviderFactory.createProvider(llmProviderEntity);
      }
    }

    // Load classifiers for the stage
    for (const classifierId of stage.classifierIds) {
      const classifier = await db.query.classifiers.findFirst({ where: (classifiers, { eq }) => eq(classifiers.id, classifierId) });
      if (!classifier) {
        throw new NotFoundError(`Classifier with ID ${classifierId} not found`);
      }
      const llmProviderEntity = await db.query.providers.findFirst({ where: (providers, { eq }) => eq(providers.id, classifier.llmProviderId) });
      const llmProvider = this.llmProviderFactory.createProvider(llmProviderEntity);
      stageData.classifiers.push({ classifier, llmProvider });
    }

    // Load transformers for the stage
    for (const transformerId of stage.transformerIds) {
      const transformer = await db.query.contextTransformers.findFirst({ where: (contextTransformers, { eq }) => eq(contextTransformers.id, transformerId) });
      if (!transformer) {
        throw new NotFoundError(`Transformer with ID ${transformerId} not found`);
      }
      const llmProviderEntity = await db.query.providers.findFirst({ where: (providers, { eq }) => eq(providers.id, transformer.llmProviderId) });
      const llmProvider = this.llmProviderFactory.createProvider(llmProviderEntity);
      stageData.transformers.push({ transformer, llmProvider });
    }

    // TODO: Initialize TTS provider if configured
    const persona = await this.personaService.getPersonaById(this.stageData.stage.personaId);
    if (!persona) {
      throw new NotFoundError(`Persona with ID ${this.stageData.stage.personaId} not found`);
    }

    // TODO: Initialize ASR provider if configured

    return stageData;
  }

  private async wireUpProviders() {
    const conversationId = this.stageData.conversation.id;
    const { asrProvider, ttsProvider, completionLlmProvider } = this.stageData;

    // Initialize and wire up ASR provider
    if (asrProvider) {
      try {
        await asrProvider.init();

        asrProvider.setOnRecognitionStopped(async () => {
          logger.info({ conversationId }, `ASR recognition stopped for conversation ${conversationId}`);
          // Get all recognized text chunks and combine them
          const allTextChunks = asrProvider.getAllTextChunks();
          const fullText = allTextChunks.map(chunk => chunk.text).join(' ').trim();

          if (fullText) {
            logger.info({ conversationId, recognizedText: fullText, chunkCount: allTextChunks.length }, `ASR complete text for conversation ${conversationId}: "${fullText}"`);
            await this.processUserInput(fullText);
          } else {
            logger.warn({ conversationId }, `No text recognized for conversation ${conversationId}`);
          }
        });

        asrProvider.setOnError(async (error: Error) => {
          logger.error({ conversationId, error: error.message }, `ASR error for conversation ${conversationId}: ${error.message}`);
          // TODO: Send error to client through WebSocket
        });

        logger.info({ conversationId }, `ASR provider initialized for conversation ${conversationId}`);
      } catch (error) {
        logger.error({ conversationId, error: error instanceof Error ? error.message : String(error) }, `Failed to initialize ASR provider for conversation ${conversationId}`);
      }
    }

    // Initialize and wire up TTS provider
    if (ttsProvider) {
      try {
        await ttsProvider.init();

        let firstTtsChunkGenerated = false;
        let voiceOutputId: string = null;

        ttsProvider.setOnGenerationStarted(async () => {
          logger.info({ conversationId }, `TTS generation started for conversation ${conversationId}`);
          firstTtsChunkGenerated = false;
          voiceOutputId = `voice_${Math.random().toString(36).substr(2, 9)}`;

          // Send AI response start notification to client through WebSocket
          const ws = this.getWebSocket();
          const message = { 
            type: 'start_ai_voice_output',
            conversationId,
            voiceOutputId,
            sessionId: this.session.id,
            requestId: null
          } as StartAiVoiceOutputMessage;
          ws.send(JSON.stringify(message));
        });

        ttsProvider.setOnGenerationEnded(async () => {
          logger.info({ conversationId }, `TTS generation ended for conversation ${conversationId}`);
          firstTtsChunkGenerated = false;

          // Send AI response end notification to client through WebSocket
          const ws = this.getWebSocket();
          const message = { 
            type: 'end_ai_voice_output',
            conversationId,
            voiceOutputId,
            sessionId: this.session.id,
            requestId: null
          } as EndAiVoiceOutputMessage;
          ws.send(JSON.stringify(message));
        });

        ttsProvider.setOnSpeechGenerating(async (chunk) => {
          if (!firstTtsChunkGenerated) {
            logger.info({ conversationId, chunkId: chunk.chunkId }, `First TTS chunk generated for conversation ${conversationId}`);
            firstTtsChunkGenerated = true;
          }

          // Send TTS audio chunk to client through WebSocket
          const ws = this.getWebSocket();
          const message = { 
            type: 'send_ai_voice_chunk',
            conversationId,
            voiceOutputId,
            audioData: chunk.audio.toString('base64'),
            chunkId: chunk.chunkId,
            ordinal: chunk.ordinal,
            isFinal: chunk.isFinal,
            sessionId: this.session.id,
            requestId: null
          } as SendAiVoiceChunkMessage;
          ws.send(JSON.stringify(message));
          logger.debug({ conversationId, chunkId: chunk.chunkId, ordinal: chunk.ordinal, isFinal: chunk.isFinal }, `TTS chunk generated for conversation ${conversationId}`);

          if (chunk.isFinal) {
            logger.info({ conversationId }, `TTS generation completed for conversation ${conversationId}`);
            firstTtsChunkGenerated = false;
          }
        });

        ttsProvider.setOnError(async (error: Error) => {
          logger.error({ conversationId, error: error.message }, `TTS error for conversation ${conversationId}: ${error.message}`);
          // TODO: Send error to client through WebSocket
        });

        logger.info({ conversationId }, `TTS provider initialized for conversation ${conversationId}`);
      } catch (error) {
        logger.error({ conversationId, error: error instanceof Error ? error.message : String(error) }, `Failed to initialize TTS provider for conversation ${conversationId}`);
      }
    }

    // Initialize and wire up completion LLM provider
    if (completionLlmProvider) {
      try {
        completionLlmProvider.setOnError(async (error: Error) => {
          logger.error({ conversationId, error: error.message }, `LLM completion error for conversation ${conversationId}: ${error.message}`);
          // TODO: Send error to client through WebSocket
        });

        logger.info({ conversationId, stageId: this.stageData.id }, `Completion LLM provider wired up for conversation ${conversationId}`);
      } catch (error) {
        logger.error({ conversationId, stageId: this.stageData.id, error: error instanceof Error ? error.message : String(error) }, `Failed to wire up completion LLM provider for conversation ${conversationId}`);
      }
    } else {
      logger.warn({ conversationId, stageId: this.stageData.id }, `No completion LLM provider available for conversation ${conversationId}`);
    }

    // Wire up classification LLM providers
    for (const classifierData of this.stageData.classifiers) {
      try {
        classifierData.llmProvider.setOnError(async (error: Error) => {
          logger.error({ conversationId, classifierId: classifierData.classifier.id, error: error.message }, `LLM classification error for conversation ${conversationId}: ${error.message}`);
          // TODO: Send error to client through WebSocket
        });

        logger.info({ conversationId, classifierId: classifierData.classifier.id }, `Classification LLM provider wired up for classifier ${classifierData.classifier.name}`);
      } catch (error) {
        logger.error({ conversationId, classifierId: classifierData.classifier.id, error: error instanceof Error ? error.message : String(error) }, `Failed to wire up classification LLM provider for classifier ${classifierData.classifier.id}`);
      }
    }

    // Wire up transformer LLM providers
    for (const transformerData of this.stageData.transformers) {
      try {
        transformerData.llmProvider.setOnError(async (error: Error) => {
          logger.error({ conversationId, transformerId: transformerData.transformer.id, error: error.message }, `LLM transformer error for conversation ${conversationId}: ${error.message}`);
          // TODO: Send error to client through WebSocket
        });

        logger.info({ conversationId, transformerId: transformerData.transformer.id }, `Transformer LLM provider wired up for transformer ${transformerData.transformer.name}`);
      } catch (error) {
        logger.error({ conversationId, transformerId: transformerData.transformer.id, error: error instanceof Error ? error.message : String(error) }, `Failed to wire up transformer LLM provider for transformer ${transformerData.transformer.id}`);
      }
    }
  }

  async startConversation() {
    throw new Error("Method not implemented.");
  }

  async resumeConversation() {
    throw new Error("Method not implemented.");
  }

  async receiveUserTextInput(userInput: string) {
    if (this.state !== 'awaiting_user_input') {
      throw new Error(`Cannot receive user input in current state: ${this.state}`);
    }

    await this.processUserInput(userInput);
  }

  async startUserVoiceInput() {
    if (this.state !== 'awaiting_user_input') {
      throw new Error(`Cannot start receiving user voice input in current state: ${this.state}`);
    }

    if (!this.stageData.asrProvider) {
      const errorMessage = `ASR provider not available for conversation ${this.stageData.conversation.id}`;
      await this.markAsFailed(errorMessage);
      throw new Error(errorMessage);
    }

    try {
      await this.stageData.asrProvider.start();
      this.state = 'receiving_user_voice';
      logger.info({ conversationId: this.stageData.conversation.id }, `Started voice input for conversation ${this.stageData.conversation.id}`);
    } catch (error) {
      const errorMessage = `Failed to start voice input: ${error instanceof Error ? error.message : String(error)}`;
      await this.markAsFailed(errorMessage);
      logger.error({ conversationId: this.stageData.conversation.id, error: error instanceof Error ? error.message : String(error) }, `Failed to start voice input for conversation ${this.stageData.conversation.id}`);
      throw error;
    }
  }

  async receiveUserVoiceData(voiceData: Buffer) {
    if (this.state !== 'receiving_user_voice') {
      throw new Error(`Cannot receive user voice data in current state: ${this.state}`);
    }

    if (!this.stageData.asrProvider) {
      const errorMessage = `ASR provider not available for conversation ${this.stageData.conversation.id}`;
      await this.markAsFailed(errorMessage);
      throw new Error(errorMessage);
    }

    try {
      await this.stageData.asrProvider.sendAudio(voiceData);
      logger.debug({ conversationId: this.stageData.conversation.id, bufferSize: voiceData.length }, `Sent ${voiceData.length} bytes of audio data for conversation ${this.stageData.conversation.id}`);
    } catch (error) {
      const errorMessage = `Failed to process voice data: ${error instanceof Error ? error.message : String(error)}`;
      await this.markAsFailed(errorMessage);
      logger.error({ conversationId: this.stageData.conversation.id, error: error instanceof Error ? error.message : String(error) }, `Failed to send audio data for conversation ${this.stageData.conversation.id}`);
      throw error;
    }
  }

  async stopUserVoiceInput() {
    if (this.state !== 'receiving_user_voice') {
      throw new Error(`Cannot stop receiving user voice input in current state: ${this.state}`);
    }

    if (!this.stageData.asrProvider) {
      const errorMessage = `ASR provider not available for conversation ${this.stageData.conversation.id}`;
      await this.markAsFailed(errorMessage);
      throw new Error(errorMessage);
    }

    try {
      await this.stageData.asrProvider.stop();
      this.state = 'processing_user_input';
      logger.info({ conversationId: this.stageData.conversation.id }, `Stopped voice input for conversation ${this.stageData.conversation.id}`);
    } catch (error) {
      const errorMessage = `Failed to stop voice input: ${error instanceof Error ? error.message : String(error)}`;
      await this.markAsFailed(errorMessage);
      logger.error({ conversationId: this.stageData.conversation.id, error: error instanceof Error ? error.message : String(error) }, `Failed to stop voice input for conversation ${this.stageData.conversation.id}`);
      throw error;
    }
  }

  async receiveCommand(command: string, data: any) {    
    throw new Error("Method not implemented.");
  }

  /**
   * Marks the conversation as failed and stores the failure reason
   * @param reason Human-readable description of why the conversation failed
   */
  private async markAsFailed(reason: string): Promise<void> {
    this.state = 'failed';
    this.failureReason = reason;
    logger.error({ conversationId: this.stageData.conversation.id, reason }, `Conversation ${this.stageData.conversation.id} marked as failed: ${reason}`);

    // Update conversation status via ConversationService
    try {
      await this.conversationService.failConversation(this.stageData.conversation.id, reason);
    } catch (error) {
      logger.error({ conversationId: this.stageData.conversation.id, error: error instanceof Error ? error.message : String(error) }, `Failed to update conversation status in database via ConversationService`);
    }
  }

  /**
   * Processes user input (text or voice) and advances the conversation state
   * @param userInput The user input text to process
   */
  private async processUserInput(userInput: string) {
    this.state = 'processing_user_input';
    const actions = await this.userInputProcessor.processTextInput(this.session, userInput);

    let shouldGenerateResponse = false;
    // TODO: process actions (not implemented yet)

    if (shouldGenerateResponse) {
      this.state = 'generating_response';
      // TODO: implement response generation
    } else {
      this.state = 'awaiting_user_input';
    }
  }

  /**
   * Gets the current state of the conversation
   */
  getState(): ConversationState {
    return this.state;
  }

  /**
   * Gets the failure reason if the conversation has failed
   */
  getFailureReason(): string | undefined {
    return this.failureReason;
  }
}