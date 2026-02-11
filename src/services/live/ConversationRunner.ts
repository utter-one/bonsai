import { z } from "zod";
import { inject, injectable } from "tsyringe";
import { NotFoundError } from "../../errors";
import { Classifier, ContextTransformer, Conversation, GlobalAction, Project, Stage, Tool } from "../../types/models";
import { StageAction, LIFECYCLE_ACTION_NAMES } from "../../types/actions";
import { db } from "../../db";
import { conversations, users } from "../../db/schema";
import { MessageEventData, ActionEventData, ConversationStartEventData, ConversationResumeEventData, ConversationEndEventData, ConversationAbortedEventData, ConversationFailedEventData, JumpToStageEventData, ToolCallEventData, conversationStateSchema, ConversationState } from "../../types/conversationEvents";
import { ConversationService } from "../ConversationService";
import { logger } from "../../utils/logger";
import { PersonaService } from "../PersonaService";
import { Connection } from "../../websocket/ConnectionManager";
import { AiTranscribedChunkMessage, EndAiGenerationOutputMessage, SendAiVoiceChunkMessage, StartAiGenerationOutputMessage } from "../../websocket/contracts/aiResponse";
import { ILlmProvider, LlmChunk, LlmGenerationResult } from "../providers/llm/ILlmProvider";
import { IAsrProvider } from "../providers/asr/IAsrProvider";
import { ITtsProvider } from "../providers/tts/ITtsProvider";
import { LlmProviderFactory } from "../providers/llm/LlmProviderFactory";
import { AsrProviderFactory } from "../providers/asr/AsrProviderFactory";
import { TtsProviderFactory } from "../providers/tts/TtsProviderFactory";
import { UserInputProcessor } from "./UserInputProcessor";
import { VoiceConfig } from "../../http/contracts/persona";
import { ActionsExecutionOutcome, ActionsExecutor } from "./ActionsExecutor";
import { ConversationContext, ConversationContextBuilder } from "./ConversationContextBuilder";
import { eq } from "drizzle-orm";
import { ResponseGenerator } from "./ResponseGenerator";
import { ToolExecutor } from "./ToolExecutor";
import { generateId, ID_PREFIXES } from "../../utils/idGenerator";
import { UserTranscribedChunkMessage } from "../../websocket/contracts/userInput";

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
  lastCompletionResult?: LlmGenerationResult;
  classifiers: ClassifierRuntimeData[];
  transformers: TransformerRuntimeData[];
  globalActions: GlobalAction[];
  asrProvider?: IAsrProvider;
  ttsProvider?: ITtsProvider;
  voiceConfig?: VoiceConfig;
  shouldEndConversation: boolean;
  inputTurnId?: string;
  outputTurnId?: string;
}

/** 
 * Manages the lifecycle and state of a conversation. Runners are hosted by the SessionManager.
 */
@injectable()
export class ConversationRunner {
  private stageData: StageRuntimeData;
  private session: Connection;
  private conversation: Conversation;
  private ws: WebSocket;

  constructor(
    @inject(LlmProviderFactory) private llmProviderFactory: LlmProviderFactory,
    @inject(AsrProviderFactory) private asrProviderFactory: AsrProviderFactory,
    @inject(TtsProviderFactory) private ttsProviderFactory: TtsProviderFactory,
    @inject(ConversationService) private conversationService: ConversationService,
    @inject(ConversationContextBuilder) private contextBuilder: ConversationContextBuilder,
    @inject(PersonaService) private personaService: PersonaService,
    @inject(UserInputProcessor) private userInputProcessor: UserInputProcessor,
    @inject(ActionsExecutor) private actionsExecutor: ActionsExecutor,
    @inject(ResponseGenerator) private responseGenerator: ResponseGenerator,
    @inject(ToolExecutor) private toolExecutor: ToolExecutor,
  ) { }

  public getRuntimeData(): StageRuntimeData {
    return this.stageData;
  }

  async prepareConversation(conversationId: string, session: Connection, ws: WebSocket): Promise<void> {
    this.session = session;
    this.ws = ws;

    // Load conversation data
    this.conversation = await db.query.conversations.findFirst({ where: (conversations, { eq }) => eq(conversations.id, conversationId) });
    if (!this.conversation) {
      throw new NotFoundError(`Conversation with ID ${conversationId} not found`);
    }

    // Check if conversation is active
    if (this.conversation.status === 'finished' || this.conversation.status === 'failed' || this.conversation.status === 'aborted') {
      throw new Error(`Conversation with ID ${conversationId} is not active`);
    }

    this.stageData = await this.buildStageData(this.conversation);
    await this.wireUpProviders();
  }

  private async buildStageData(conversation: Conversation): Promise<StageRuntimeData> {
    // Load current stage data with persona relation
    const stage = await db.query.stages.findFirst({ where: (stages, { eq }) => eq(stages.id, conversation.stageId), with: { persona: true } });
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
      lastCompletionResult: null,
      classifiers: [],
      transformers: [],
      globalActions: [],
      asrProvider: undefined,
      ttsProvider: undefined,
      shouldEndConversation: false,
    };

    // Load completion LLM provider for the stage
    if (stage.llmProviderId) {
      const llmProviderEntity = await db.query.providers.findFirst({ where: (providers, { eq }) => eq(providers.id, stage.llmProviderId) });
      if (llmProviderEntity) {
        stageData.completionLlmProvider = this.llmProviderFactory.createProvider(llmProviderEntity, stage.llmSettings);
      }
    }

    // Load classifiers for the stage
    for (const classifierId of stage.classifierIds) {
      const classifier = await db.query.classifiers.findFirst({ where: (classifiers, { eq }) => eq(classifiers.id, classifierId) });
      if (!classifier) {
        throw new NotFoundError(`Classifier with ID ${classifierId} not found`);
      }
      const llmProviderEntity = await db.query.providers.findFirst({ where: (providers, { eq }) => eq(providers.id, classifier.llmProviderId) });
      const llmProvider = this.llmProviderFactory.createProvider(llmProviderEntity, classifier.llmSettings);
      stageData.classifiers.push({ classifier, llmProvider });
    }

    // Load transformers for the stage
    for (const transformerId of stage.transformerIds) {
      const transformer = await db.query.contextTransformers.findFirst({ where: (contextTransformers, { eq }) => eq(contextTransformers.id, transformerId) });
      if (!transformer) {
        throw new NotFoundError(`Transformer with ID ${transformerId} not found`);
      }
      const llmProviderEntity = await db.query.providers.findFirst({ where: (providers, { eq }) => eq(providers.id, transformer.llmProviderId) });
      const llmProvider = this.llmProviderFactory.createProvider(llmProviderEntity, transformer.llmSettings);
      stageData.transformers.push({ transformer, llmProvider });
    }

    // Load global actions for the stage if enabled
    if (stage.useGlobalActions) {
      const { globalActions: globalActionsTable } = await import('../../db/schema');
      const { inArray } = await import('drizzle-orm');

      // If stage.globalActions is empty, load all global actions for the project
      // Otherwise, load only the specified global actions
      if (stage.globalActions.length === 0) {
        const allGlobalActions = await db.query.globalActions.findMany({
          where: (globalActions, { eq }) => eq(globalActions.projectId, project.id)
        });
        stageData.globalActions = allGlobalActions;
      } else {
        const selectedGlobalActions = await db.query.globalActions.findMany({
          where: (globalActions, { and, eq }) => and(
            eq(globalActions.projectId, project.id),
            inArray(globalActions.id, stage.globalActions)
          )
        });
        stageData.globalActions = selectedGlobalActions;
      }
    }

    // Initialize TTS provider if configured and client wants voice output
    const persona = await this.personaService.getPersonaById(stageData.stage.personaId);
    if (!persona) {
      throw new NotFoundError(`Persona with ID ${stageData.stage.personaId} not found`);
    }
    const voiceConfig = persona.voiceConfig;
    if (project.generateVoice && persona.ttsProviderId && this.session.sessionSettings.receiveVoiceOutput) {
      const voiceProviderEntity = await db.query.providers.findFirst({ where: (providers, { eq }) => eq(providers.id, persona.ttsProviderId) });
      if (voiceProviderEntity) {
        stageData.ttsProvider = this.ttsProviderFactory.createProvider(voiceProviderEntity);
        stageData.voiceConfig = voiceConfig;
      }
    }

    // Initialize ASR provider if configured and client wants to send voice input
    if (project.acceptVoice && project.asrConfig?.asrProviderId && project.asrConfig.settings && this.session.sessionSettings.sendVoiceInput) {
      const asrProviderEntity = await db.query.providers.findFirst({ where: (providers, { eq }) => eq(providers.id, project.asrConfig.asrProviderId) });
      if (asrProviderEntity) {
        stageData.asrProvider = this.asrProviderFactory.createProvider(asrProviderEntity, project.asrConfig.settings);
      } else {
        throw new NotFoundError(`ASR Provider with ID ${project.asrConfig.asrProviderId} not found`);
      }
    }

    return stageData;
  }

  private async wireUpProviders() {
    const conversationId = this.stageData.conversation.id;
    const { asrProvider, ttsProvider, completionLlmProvider } = this.stageData;

    // Initialize and wire up ASR provider
    if (asrProvider) {
      try {
        await asrProvider.init();

        let isRecognizing = false;
        let chunkOrdinal = 0;
        asrProvider.setOnRecognitionStarted(async () => {
          isRecognizing = true;
          chunkOrdinal = 0;
        });

        asrProvider.setOnRecognizing(async (chunkId, text) => {
          logger.debug({ conversationId, chunkId }, `ASR recognizing chunk for conversation ${conversationId}: "${text}"`);

          // Send interim recognition result to client through WebSocket if enabled
          if (this.session.sessionSettings.receiveTranscriptionUpdates) {
            const message = {
              type: 'user_transcribed_chunk',
              conversationId,
              chunkId,
              chunkText: text,
              ordinal: chunkOrdinal++,
              inputTurnId: this.stageData.inputTurnId,
              isFinal: false,
              sessionId: this.session.id,
              requestId: null
            } as UserTranscribedChunkMessage;
            this.ws.send(JSON.stringify(message));
          }
        });

        asrProvider.setOnRecognized(async (chunkId, text) => {
          logger.info({ conversationId, chunkId }, `ASR recognized chunk for conversation ${conversationId}: "${text}"`);

          // Send final recognition result to client through WebSocket if enabled
          if (this.session.sessionSettings.receiveTranscriptionUpdates) {
            const message = {
              type: 'user_transcribed_chunk',
              conversationId,
              chunkId,
              chunkText: text,
              ordinal: chunkOrdinal++,
              inputTurnId: this.stageData.inputTurnId,
              isFinal: true,
              sessionId: this.session.id,
              requestId: null
            } as UserTranscribedChunkMessage;
            this.ws.send(JSON.stringify(message));
          }

          chunkOrdinal = 0;
        });

        asrProvider.setOnRecognitionStopped(async () => {
          logger.info({ conversationId }, `ASR recognition stopped for conversation ${conversationId}`);

          isRecognizing = false;
          // Get all recognized text chunks and combine them
          const allTextChunks = asrProvider.getAllTextChunks();
          const fullText = allTextChunks.map(chunk => chunk.text).join(' ').trim();

          if (fullText) {
            logger.info({ conversationId, recognizedText: fullText, chunkCount: allTextChunks.length }, `ASR complete text for conversation ${conversationId}: "${fullText}"`);
            const context = await this.contextBuilder.buildContextForUserInput(this.stageData.conversation, this.stageData.stage, fullText, fullText);
            context.userInputSource = 'voice';
            await this.processUserInput(fullText, 'voice');
          } else {
            logger.warn({ conversationId }, `No text recognized for conversation ${conversationId}`);
            await this.processUserInput(this.stageData.project.asrConfig.unintelligiblePlaceholder ?? '**inaudible**', 'voice');
          }
        });

        asrProvider.setOnError(async (error: Error) => {
          logger.error({ conversationId, error: error.message, isRecognizing }, `ASR error for conversation ${conversationId}: ${error.message}`);
          if (isRecognizing) {
            isRecognizing = false;
            await this.markAsFailed(`ASR error: ${error.message}`);
          }
        });

        logger.info({ conversationId }, `ASR provider initialized for conversation ${conversationId}`);
      } catch (error) {
        logger.error({ conversationId, error: error instanceof Error ? error.message : String(error) }, `Failed to initialize ASR provider for conversation ${conversationId}`);
        throw error;
      }
    }

    // Initialize and wire up TTS provider
    if (ttsProvider) {
      try {
        await ttsProvider.init(this.stageData.voiceConfig);

        let firstTtsChunkGenerated = false;
        let isGenerating = false;

        ttsProvider.setOnGenerationStarted(async () => {
          logger.info({ conversationId }, `TTS generation started for conversation ${conversationId}`);
          isGenerating = true;
          firstTtsChunkGenerated = false;
        });

        ttsProvider.setOnGenerationEnded(async () => {
          logger.info({ conversationId }, `TTS generation ended for conversation ${conversationId}`);
          firstTtsChunkGenerated = false;
          isGenerating = false;

          // Send AI response end notification to client through WebSocket
          const message = {
            type: 'end_ai_generation_output',
            conversationId,
            outputTurnId: this.stageData.outputTurnId,
            sessionId: this.session.id,
            requestId: null,
            fullText: this.stageData.lastCompletionResult?.content || '' // TODO: we need a dedicated message for sending full text after TTS generation is complete, as end_ai_voice_output is more about signaling the end of audio output, not necessarily tied to the text content
          } as EndAiGenerationOutputMessage;
          this.ws.send(JSON.stringify(message));

          this.changeState('awaiting_user_input'); // TODO: handle end/aborted/failed states appropriately
        });

        ttsProvider.setOnSpeechGenerating(async (chunk) => {
          if (!firstTtsChunkGenerated) {
            logger.info({ conversationId, chunkId: chunk.chunkId }, `First TTS chunk generated for conversation ${conversationId}`);
            firstTtsChunkGenerated = true;
          }

          // Send TTS audio chunk to client through WebSocket
          const message = {
            type: 'send_ai_voice_chunk',
            conversationId,
            outputTurnId: this.stageData.outputTurnId,
            audioData: chunk.audio.toString('base64'),
            audioFormat: chunk.format,
            chunkId: chunk.chunkId,
            ordinal: chunk.ordinal,
            isFinal: chunk.isFinal,
            sessionId: this.session.id,
            requestId: null
          } as SendAiVoiceChunkMessage;
          this.ws.send(JSON.stringify(message));
          logger.debug({ conversationId, chunkId: chunk.chunkId, ordinal: chunk.ordinal, isFinal: chunk.isFinal }, `TTS chunk generated for conversation ${conversationId}`);

          if (chunk.isFinal) {
            logger.info({ conversationId }, `TTS generation completed for conversation ${conversationId}`);
            firstTtsChunkGenerated = false;
          }
        });

        ttsProvider.setOnError(async (error: Error) => {
          logger.error({ conversationId, error: error.message }, `TTS error for conversation ${conversationId}: ${error.message}`);
          if (isGenerating) {
            isGenerating = false;
            await this.markAsFailed(`TTS error: ${error.message}`);
          }
        });

        logger.info({ conversationId }, `TTS provider initialized for conversation ${conversationId}`);
      } catch (error) {
        logger.error({ conversationId, error: error instanceof Error ? error.message : String(error) }, `Failed to initialize TTS provider for conversation ${conversationId}`);
        throw error;
      }
    }

    // Initialize and wire up completion LLM provider
    if (completionLlmProvider) {
      let aiTextChunkOrdinal = 0;

      completionLlmProvider.setOnChunk(async (chunk: LlmChunk) => {
        logger.debug({ conversationId, chunkLength: chunk.content.length }, `LLM completion chunk for conversation ${conversationId}: ${chunk.content.length} characters`);
        if (ttsProvider) {
          // Pass chunk text to TTS provider for speech synthesis
          await ttsProvider.sendText(chunk.content);
        }

        // Send completion chunk to client through WebSocket if enabled
        if (this.session.sessionSettings.receiveTranscriptionUpdates) {
          const message = {
            type: 'ai_transcribed_chunk',
            conversationId,
            outputTurnId: this.stageData.outputTurnId,
            chunkId: generateId(ID_PREFIXES.CHUNK),
            chunkText: chunk.content,
            ordinal: aiTextChunkOrdinal++,
            isFinal: chunk.finishReason !== null,
            sessionId: this.session.id,
            requestId: null
          } as AiTranscribedChunkMessage;
          this.ws.send(JSON.stringify(message));
        }
      });

      completionLlmProvider.setOnGenerationCompleted(async (result) => {
        logger.info({ conversationId, totalTokens: result.usage?.totalTokens }, `LLM completion finished for conversation ${conversationId}: ${result.content.length} characters, ${result.usage?.totalTokens} tokens used`);
        this.stageData.lastCompletionResult = result;

        // Save AI message event with usage info
        const messageEventData: MessageEventData = {
          text: result.content,
          role: 'assistant',
          originalText: result.content,
          metadata: { llmUsage: result.usage || {} },
        }
        await this.conversationService.saveConversationEvent(this.stageData.conversation.id, 'message', messageEventData);

        if (!ttsProvider) {
          // send end generation message to client to signal that response is complete and change state to awaiting user input
          const message = {
            type: 'end_ai_generation_output',
            conversationId,
            outputTurnId: this.stageData.outputTurnId,
            sessionId: this.session.id,
            requestId: null,
            fullText: result.content
          } as EndAiGenerationOutputMessage;
          this.ws.send(JSON.stringify(message));

          await this.changeState('awaiting_user_input'); // In case of no TTS provider, change state to awaiting user input
        } else {
          await ttsProvider.end(); // Signal TTS provider that generation is complete so it can finalize audio output and notify client
        }
      });


      completionLlmProvider.setOnError(async (error: Error) => {
        logger.error({ conversationId, error: error.message }, `LLM completion error for conversation ${conversationId}: ${error.message}`);
        await this.markAsFailed(`LLM completion error: ${error.message}`);
      });

      logger.info({ conversationId, stageId: this.stageData.id }, `Completion LLM provider wired up for conversation ${conversationId}`);
    } else {
      logger.warn({ conversationId, stageId: this.stageData.id }, `No completion LLM provider available for conversation ${conversationId}`);
    }

    // Wire up classification LLM providers
    for (const classifierData of this.stageData.classifiers) {
      try {
        classifierData.llmProvider.setOnError(async (error: Error) => {
          logger.error({ conversationId, classifierId: classifierData.classifier.id, error: error.message }, `LLM classification error for conversation ${conversationId}: ${error.message}`);
          await this.markAsFailed(`LLM classification error: ${error.message}`);
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
          await this.markAsFailed(`LLM transformer error: ${error.message}`);
        });

        logger.info({ conversationId, transformerId: transformerData.transformer.id }, `Transformer LLM provider wired up for transformer ${transformerData.transformer.name}`);
      } catch (error) {
        logger.error({ conversationId, transformerId: transformerData.transformer.id, error: error instanceof Error ? error.message : String(error) }, `Failed to wire up transformer LLM provider for transformer ${transformerData.transformer.id}`);
      }
    }
  }

  async startConversation() {
    if (this.conversation.status !== 'initialized') {
      throw new Error(`Cannot start conversation in current state: ${this.conversation.status}`);
    }

    const eventData: ConversationStartEventData = {
      stageId: this.stageData.id,
      initialVariables: this.conversation.stageVars?.[this.stageData.id] || {},
    };
    await this.conversationService.saveConversationEvent(this.conversation.id, 'conversation_start', eventData);
    logger.info({ conversationId: this.conversation.id, stageId: this.stageData.id }, 'Conversation started');

    // Execute __on_enter lifecycle action if defined
    const onEnterAction = this.stageData.stage.actions[LIFECYCLE_ACTION_NAMES.ON_ENTER];
    if (onEnterAction) {
      const context = await this.contextBuilder.buildContextForConversationStart(this.conversation);
      const enterOutcome = await this.actionsExecutor.executeActions([onEnterAction], context, 'on_enter');
      await this.applyActionOutcome(context, enterOutcome);

      // Register action event
      const actionEventData: ActionEventData = {
        actionName: onEnterAction.name || '',
        stageId: this.stageData.id,
        effects: onEnterAction.effects,
      };
      await this.conversationService.saveConversationEvent(this.conversation.id, 'action', actionEventData);

      // If on_enter ended or aborted conversation, don't proceed
      if (enterOutcome.shouldEndConversation || enterOutcome.shouldAbortConversation) {
        return;
      }
    }

    if (this.stageData.stage.enterBehavior === 'generate_response') {
      const context = await this.contextBuilder.buildContextForConversationStart(this.conversation);
      const outcome: ActionsExecutionOutcome = {
        hasModifiedUserInput: false,
        hasModifiedUserProfile: false,
        hasModifiedVars: false,
        success: true,
        shouldAbortConversation: false,
        shouldEndConversation: false,
        shouldGenerateResponse: true
      }
      await this.generateResponse(context, outcome)
    } else {
      await this.changeState('awaiting_user_input');
    }
  }

  async resumeConversation() {
    const previousStatus = this.conversation.status;
    const eventData: ConversationResumeEventData = {
      previousStatus,
      stageId: this.stageData.id,
    };
    await this.conversationService.saveConversationEvent(this.conversation.id, 'conversation_resume', eventData);
    logger.info({ conversationId: this.conversation.id, previousStatus, stageId: this.stageData.id }, 'Conversation resumed');

    throw new Error("Method not implemented.");
  }

  async receiveUserTextInput(userInput: string): Promise<string> {
    if (this.conversation.status !== 'awaiting_user_input') {
      throw new Error(`Cannot receive user input in current state: ${this.conversation.status}`);
    }

    this.stageData.inputTurnId = generateId(ID_PREFIXES.INPUT);
    await this.processUserInput(userInput, 'text');
    return this.stageData.inputTurnId;
  }

  async startUserVoiceInput(): Promise<string> {
    if (this.conversation.status !== 'awaiting_user_input') {
      throw new Error(`Cannot start receiving user voice input in current state: ${this.conversation.status}`);
    }

    if (!this.stageData.asrProvider) {
      const errorMessage = `ASR provider not available for conversation ${this.stageData.conversation.id}`;
      await this.markAsFailed(errorMessage);
      throw new Error(errorMessage);
    }

    try {
      this.stageData.inputTurnId = generateId(ID_PREFIXES.INPUT);
      await this.stageData.asrProvider.start();
      await this.changeState('receiving_user_voice');
      logger.info({ conversationId: this.stageData.conversation.id }, `Started voice input for conversation ${this.stageData.conversation.id}`);
      return this.stageData.inputTurnId;
    } catch (error) {
      const errorMessage = `Failed to start voice input: ${error instanceof Error ? error.message : String(error)}`;
      await this.markAsFailed(errorMessage);
      logger.error({ conversationId: this.stageData.conversation.id, error: error instanceof Error ? error.message : String(error) }, `Failed to start voice input for conversation ${this.stageData.conversation.id}`);
      throw error;
    }
  }

  async receiveUserVoiceData(inputTurnId: string, voiceData: Buffer) {
    if (this.conversation.status !== 'receiving_user_voice') {
      throw new Error(`Cannot receive user voice data in current state: ${this.conversation.status}`);
    }

    if (this.stageData.inputTurnId !== inputTurnId) {
      throw new Error(`Input turn ID mismatch: expected ${this.stageData.inputTurnId}, got ${inputTurnId}`);
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

  async stopUserVoiceInput(inputTurnId: string) {
    if (this.conversation.status !== 'receiving_user_voice') {
      throw new Error(`Cannot stop receiving user voice input in current state: ${this.conversation.status}`);
    }
    if (this.stageData.inputTurnId !== inputTurnId) {
      throw new Error(`Input turn ID mismatch: expected ${this.stageData.inputTurnId}, got ${inputTurnId}`);
    }

    if (!this.stageData.asrProvider) {
      const errorMessage = `ASR provider not available for conversation ${this.stageData.conversation.id}`;
      await this.markAsFailed(errorMessage);
      throw new Error(errorMessage);
    }

    try {
      await this.stageData.asrProvider.stop();
      await this.changeState('processing_user_input');

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
   * Navigate to a specific stage in the conversation
   * @param stageId - ID of the stage to navigate to
   */
  async goToStage(stageId: string): Promise<void> {
    logger.info({ conversationId: this.conversation.id, currentStageId: this.stageData.id, targetStageId: stageId }, `Navigating to stage ${stageId}`);

    if (this.conversation.status !== 'awaiting_user_input' && this.conversation.status !== 'processing_user_input') {
      throw new Error(`Cannot navigate to stage in current state: ${this.conversation.status}`);
    }

    const fromStageId = this.stageData.id;
    const oldStageData = this.stageData;

    // Execute __on_leave lifecycle action if defined on current stage
    const onLeaveAction = oldStageData.stage.actions[LIFECYCLE_ACTION_NAMES.ON_LEAVE];
    if (onLeaveAction) {
      logger.debug({ conversationId: this.conversation.id, stageId: fromStageId }, 'Executing __on_leave lifecycle action');
      const context = await this.contextBuilder.buildContextForUserInput(oldStageData.conversation, oldStageData.stage, '-', '-');
      const leaveOutcome = await this.actionsExecutor.executeActions([onLeaveAction], context, 'on_leave');

      await this.applyActionOutcome(context, leaveOutcome);

      // Register action event
      const actionEventData: ActionEventData = {
        actionName: onLeaveAction.name || '',
        stageId: oldStageData.id,
        effects: onLeaveAction.effects,
      };
      await this.conversationService.saveConversationEvent(this.conversation.id, 'action', actionEventData);

      // If on_leave ended or aborted conversation, don't proceed
      if (leaveOutcome.shouldEndConversation || leaveOutcome.shouldAbortConversation) {
        return;
      }
    }

    // Load new stage data
    const newStageData = await this.buildStageData({ ...this.conversation, stageId });

    // Update stage data and conversation
    this.stageData = newStageData;
    this.conversation.stageId = stageId;

    // Update conversation in database
    await db.update(conversations)
      .set({ stageId, updatedAt: new Date() })
      .where(eq(conversations.id, this.conversation.id));

    // Re-wire providers for the new stage
    await this.wireUpProviders();

    const eventData: JumpToStageEventData = {
      fromStageId,
      toStageId: stageId,
    };
    await this.conversationService.saveConversationEvent(this.conversation.id, 'jump_to_stage', eventData);

    // Execute __on_enter lifecycle action if defined on new stage
    const onEnterAction = this.stageData.stage.actions[LIFECYCLE_ACTION_NAMES.ON_ENTER];
    if (onEnterAction) {
      logger.debug({ conversationId: this.conversation.id, stageId }, 'Executing __on_enter lifecycle action');
      const context = await this.contextBuilder.buildContextForUserInput(this.stageData.conversation, this.stageData.stage, '-', '-');
      const enterOutcome = await this.actionsExecutor.executeActions([onEnterAction], context, 'on_enter');

      await this.applyActionOutcome(context, enterOutcome);

      // Register action event
      const actionEventData: ActionEventData = {
        actionName: onEnterAction.name || '',
        stageId: this.stageData.id,
        effects: onEnterAction.effects,
      };
      await this.conversationService.saveConversationEvent(this.conversation.id, 'action', actionEventData);

      // If on_enter ended or aborted conversation, don't proceed
      if (enterOutcome.shouldEndConversation || enterOutcome.shouldAbortConversation) {
        return;
      }
    }

    // TODO: not sure if this is a good place
    if (this.stageData.stage.enterBehavior === 'generate_response') {
      const context = await this.contextBuilder.buildContextForUserInput(this.stageData.conversation, this.stageData.stage, '-', '-');
      const executionOutcome: ActionsExecutionOutcome = {
        hasModifiedUserInput: false,
        hasModifiedUserProfile: false,
        hasModifiedVars: false,
        success: true,
        shouldAbortConversation: false,
        shouldEndConversation: false,
        shouldGenerateResponse: true
      };
      this.generateResponse(context, executionOutcome);
    } else {
      await this.changeState('awaiting_user_input');
    }

    logger.info({ conversationId: this.conversation.id, stageId }, `Successfully navigated to stage ${stageId}`);
  }

  /**
   * Set a variable value in the conversation context
   * @param stageId - ID of the stage (for validation)
   * @param variableName - Name of the variable to set
   * @param variableValue - Value to set
   */
  async setVariable(stageId: string, variableName: string, variableValue: any): Promise<void> {
    if (this.stageData.id !== stageId) {
      throw new Error(`Stage ID mismatch: expected ${this.stageData.id}, got ${stageId}`);
    }
    if (this.conversation.status !== 'awaiting_user_input') {
      throw new Error(`Cannot set variable in current state: ${this.conversation.status}`);
    }


    logger.info({ conversationId: this.conversation.id, stageId, variableName }, `Setting variable ${variableName}`);

    // Initialize stageVars if it doesn't exist
    if (!this.conversation.stageVars) {
      this.conversation.stageVars = {};
    }

    // Initialize stage-specific vars if they don't exist
    if (!this.conversation.stageVars[stageId]) {
      this.conversation.stageVars[stageId] = {};
    }

    // Set the variable for this stage
    this.conversation.stageVars[stageId][variableName] = variableValue;

    // Update conversation in database
    const { conversations } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');
    await db.update(conversations)
      .set({ stageVars: this.conversation.stageVars, updatedAt: new Date() })
      .where(eq(conversations.id, this.conversation.id));

    logger.info({ conversationId: this.conversation.id, stageId, variableName }, `Successfully set variable ${variableName}`);
  }

  /**
   * Get a variable value from the conversation context
   * @param stageId - ID of the stage (for validation)
   * @param variableName - Name of the variable to retrieve
   * @returns The variable value or undefined if not found
   */
  async getVariable(stageId: string, variableName: string): Promise<any> {
    if (this.stageData.id !== stageId) {
      throw new Error(`Stage ID mismatch: expected ${this.stageData.id}, got ${stageId}`);
    }

    logger.info({ conversationId: this.conversation.id, stageId, variableName }, `Getting variable ${variableName}`);

    const value = this.conversation.stageVars?.[stageId]?.[variableName];

    logger.info({ conversationId: this.conversation.id, stageId, variableName, hasValue: value !== undefined }, `Retrieved variable ${variableName}`);

    return value;
  }

  /**
   * Get all variables from the conversation context
   * @param stageId - ID of the stage (for validation)
   * @returns Object containing all variables
   */
  async getAllVariables(stageId: string): Promise<Record<string, any>> {
    if (this.stageData.id !== stageId) {
      throw new Error(`Stage ID mismatch: expected ${this.stageData.id}, got ${stageId}`);
    }

    logger.info({ conversationId: this.conversation.id, stageId }, `Getting all variables`);

    const variables = this.conversation.stageVars?.[stageId] || {};

    logger.info({ conversationId: this.conversation.id, stageId, variableCount: Object.keys(variables).length }, `Retrieved all variables`);

    return variables;
  }

  /**
   * Set a user profile field value
   * @param fieldName - Name of the profile field to set
   * @param fieldValue - Value to set
   */
  async setUserProfileField(fieldName: string, fieldValue: any): Promise<void> {
    logger.info({ conversationId: this.conversation.id, fieldName }, `Setting user profile field ${fieldName}`);

    // Load current user from database
    const { users } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');

    const currentUser = await db.query.users.findFirst({
      where: eq(users.id, this.conversation.userId),
    });

    if (!currentUser) {
      throw new NotFoundError(`User with ID ${this.conversation.userId} not found`);
    }

    // Update profile field
    const updatedProfile = { ...currentUser.profile };
    if (fieldValue === undefined) {
      delete updatedProfile[fieldName];
    } else {
      updatedProfile[fieldName] = fieldValue;
    }

    // Update user in database
    await db.update(users)
      .set({ profile: updatedProfile, updatedAt: new Date() })
      .where(eq(users.id, this.conversation.userId));

    logger.info({ conversationId: this.conversation.id, fieldName }, `Successfully set user profile field ${fieldName}`);
  }

  /**
   * Get a user profile field value
   * @param fieldName - Name of the profile field to retrieve
   * @returns The field value or undefined if not found
   */
  async getUserProfileField(fieldName: string): Promise<any> {
    logger.info({ conversationId: this.conversation.id, fieldName }, `Getting user profile field ${fieldName}`);

    const { users } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');

    const user = await db.query.users.findFirst({
      where: eq(users.id, this.conversation.userId),
    });

    if (!user) {
      throw new NotFoundError(`User with ID ${this.conversation.userId} not found`);
    }

    const value = user.profile[fieldName];

    logger.info({ conversationId: this.conversation.id, fieldName, hasValue: value !== undefined }, `Retrieved user profile field ${fieldName}`);

    return value;
  }

  /**
   * Execute a global action
   * @param actionName - Name of the action to execute
   * @param parameters - Array of parameters to pass to the action
   * @returns Result of the action execution
   */
  async runAction(actionName: string, parameters: Record<string, any>): Promise<any> {
    logger.info({ conversationId: this.conversation.id, actionName, parameterCount: parameters.length }, `Running action ${actionName}`);

    if (this.conversation.status !== 'awaiting_user_input') {
      throw new Error(`Cannot run action in current state: ${this.conversation.status}`);
    }

    // Load the action from the database
    const globalAction = await db.query.globalActions.findFirst({
      where: (globalActions, { and, eq }) => and(
        eq(globalActions.projectId, this.stageData.project.id),
        eq(globalActions.name, actionName)
      )
    });

    const stageAction = this.stageData.stage.actions[actionName];

    if (!globalAction && !stageAction) {
      throw new NotFoundError(`Action ${actionName} not found in project ${this.stageData.project.id}`);
    }

    const actionToExecute = stageAction || globalAction;
    logger.info({ conversationId: this.conversation.id, actionName }, `Executing action ${actionName}`);
    const context = await this.contextBuilder.buildContextForAction(this.stageData.conversation, actionToExecute, parameters);
    const outcome = await this.actionsExecutor.executeActions([actionToExecute], context);
    if (await this.applyActionOutcome(context, outcome)) {
      // TODO: this needs more thought
      await this.generateResponse(context, outcome);
    }

    logger.info({ conversationId: this.conversation.id, actionName }, `Action ${actionName} executed`);
    return { status: 'completed', message: 'Action execution not yet implemented' };
  }

  /**
   * Execute a tool
   * @param toolId - ID of the tool to execute
   * @param parameters - Map of parameter names to their values
   * @returns Result of the tool execution
   */
  async callTool(toolId: string, parameters: Record<string, any>): Promise<any> {
    logger.info({ conversationId: this.conversation.id, toolId, parameterCount: Object.keys(parameters).length }, `Calling tool ${toolId}`);

    // Load the tool from the database
    const tool = await db.query.tools.findFirst({
      where: (tools, { eq }) => eq(tools.id, toolId)
    });

    if (!tool) {
      throw new NotFoundError(`Tool with id ${toolId} not found`);
    }

    // Verify tool belongs to the same project
    if (tool.projectId !== this.stageData.project.id) {
      throw new Error(`Tool ${toolId} does not belong to project ${this.stageData.project.id}`);
    }

    logger.info({ conversationId: this.conversation.id, toolId, toolName: tool.name }, `Executing tool ${tool.name}`);
    
    // Build conversation context for tool execution
    const context = await this.contextBuilder.buildContextForUserInput(this.stageData.conversation, this.stageData.stage);
    
    // Execute the tool
    const result = await this.toolExecutor.executeTool(tool, context, parameters);

    // Save tool call event
    const eventData: ToolCallEventData = {
      toolId: tool.id,
      toolName: tool.name,
      parameters,
      success: result.success,
      result: result.result,
      error: result.failureReason,
    };
    await this.conversationService.saveConversationEvent(this.conversation.id, 'tool_call', eventData);

    logger.info({ conversationId: this.conversation.id, toolId, success: result.success }, `Tool ${tool.name} executed`);
    
    return result;
  }

  /**
   * Applies the outcome of action execution to the conversation state
   * @param outcome Result from executing actions
   * @return True if continue execution, false if conversation failed, ended or aborted
   */
  private async applyActionOutcome(context: ConversationContext, outcome: ActionsExecutionOutcome): Promise<boolean> {
    const conversationId = this.conversation.id;

    if (!outcome.success) {
      logger.error({ conversationId, error: outcome.error }, `Action execution failed: ${outcome.error}`);
      await this.markAsFailed(`Action execution failed: ${outcome.error}`);
      return false;
    }

    // Apply variable modifications if any
    if (outcome.hasModifiedVars) {
      logger.debug({ conversationId, stageId: this.stageData.id }, `Variables were modified during action execution`);
      const updatedStageVars = { ...this.conversation.stageVars, [this.stageData.id]: context.vars };
      await db.update(conversations)
        .set({ stageVars: updatedStageVars, updatedAt: new Date() })
        .where(eq(conversations.id, this.conversation.id));
      this.conversation.stageVars = updatedStageVars;
    }

    // Apply user profile modifications if any
    if (outcome.hasModifiedUserProfile) {
      logger.debug({ conversationId, userId: this.conversation.userId }, `User profile was modified during action execution`);
      await db.update(users)
        .set({ profile: context.userProfile, updatedAt: new Date() })
        .where(eq(users.id, this.conversation.userId));
    }

    // Apply stage navigation if specified
    if (outcome.goToStageId && outcome.goToStageId !== this.stageData.id) {
      logger.info({ conversationId, currentStageId: this.stageData.id, targetStageId: outcome.goToStageId }, `Applying stage navigation`);
      await this.goToStage(outcome.goToStageId);
    }

    if (outcome.shouldAbortConversation) {
      logger.info({ conversationId }, `Conversation marked for abortion by action execution`);
      await db.update(conversations)
        .set({ status: 'aborted', updatedAt: new Date() })
        .where(eq(conversations.id, this.conversation.id));
      return false;
    }

    if (outcome.shouldEndConversation) {
      logger.info({ conversationId }, `Conversation marked for ending by action execution`);
      return true; // Let caller handle ending the conversation
    }

    logger.debug({ conversationId, hasModifiedVars: outcome.hasModifiedVars, hasModifiedUserInput: outcome.hasModifiedUserInput, hasModifiedUserProfile: outcome.hasModifiedUserProfile, shouldEndConversation: outcome.shouldEndConversation, shouldAbortConversation: outcome.shouldAbortConversation }, `Action outcome applied successfully`);
    return true;
  }

  /**
   * Marks the conversation as failed and stores the failure reason
   * @param reason Human-readable description of why the conversation failed
   */
  private async markAsFailed(reason: string): Promise<void> {
    this.conversation.status = 'failed';
    this.conversation.statusDetails = reason;
    await this.conversationService.saveConversationState(this.conversation.id, 'failed', reason);
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
  private async processUserInput(userInput: string, userInputSource: 'text' | 'voice') {
    await this.changeState('processing_user_input');
    const context = await this.contextBuilder.buildContextForUserInput(this.stageData.conversation, this.stageData.stage, userInput, userInput);
    context.userInputSource = userInputSource;
    const classificationResults = await this.userInputProcessor.processTextInput(this.session, context);

    // Filter out lifecycle actions from classification matching
    const lifecycleActionNames = Object.values(LIFECYCLE_ACTION_NAMES) as string[];
    const stageActions = Object.fromEntries(
      Object.entries(this.stageData.stage.actions)
        .filter(([name]) => !lifecycleActionNames.includes(name))
    );
    const globalActionsMap = new Map(this.stageData.globalActions.map(ga => [ga.name, ga]));

    // Deduplicate actions by name - if multiple classifiers detect the same action, only include it once
    const seenActionNames = new Set<string>();
    const actions = classificationResults.map(r => {
      // Skip if we've already processed this action
      if (seenActionNames.has(r.name)) {
        logger.debug({ conversationId: this.conversation.id, actionName: r.name }, `Skipping duplicate action ${r.name} detected by multiple classifiers`);
        return null;
      }
      seenActionNames.add(r.name);

      // First check stage actions
      const stageAction = stageActions[r.name];
      if (stageAction) {
        // inject action with parameters into context
        context.actions[stageAction.name] = {
          parameters: r.parameters,
        };
        return stageAction;
      }

      // Then check global actions
      const globalAction = globalActionsMap.get(r.name);
      if (globalAction) {
        // inject action with parameters into context
        context.actions[globalAction.name] = {
          parameters: r.parameters,
        };
        return globalAction;
      }

      logger.warn({ conversationId: this.conversation.id, actionName: r.name }, `No matching action found for classification result ${r.name}`);
      return null;
    }).filter(a => a !== null) as (StageAction | GlobalAction)[];

    // If no actions matched and __on_fallback is defined, execute it
    let executionOutcome: ActionsExecutionOutcome;
    const onFallbackAction = this.stageData.stage.actions[LIFECYCLE_ACTION_NAMES.ON_FALLBACK];
    if (actions.length === 0 && onFallbackAction) {
      logger.debug({ conversationId: this.conversation.id }, 'No actions matched - executing __on_fallback lifecycle action');
      executionOutcome = await this.actionsExecutor.executeActions([onFallbackAction], context, 'on_fallback');
      await this.applyActionOutcome(context, executionOutcome);

      // Register action event for __on_fallback
      const actionEventData: ActionEventData = {
        actionName: onFallbackAction.name || '',
        stageId: this.stageData.id,
        effects: onFallbackAction.effects,
      };
      await this.conversationService.saveConversationEvent(this.conversation.id, 'action', actionEventData);
    } else {
      executionOutcome = await this.actionsExecutor.executeActions(actions, context);
      await this.applyActionOutcome(context, executionOutcome);
    }

    // Register action events after execution
    for (const action of actions) {
      const actionEventData: ActionEventData = {
        actionName: action.name || '',
        stageId: this.stageData.id,
        effects: action.effects,
      };
      await this.conversationService.saveConversationEvent(this.conversation.id, 'action', actionEventData);
    }

    // Save event for user message
    const messageEventData: MessageEventData = {
      role: 'user',
      text: context.userInput || '',
      originalText: context.originalUserInput || context.userInput || '',
      metadata: {
        source: context.userInputSource,
      }
    };
    await this.conversationService.saveConversationEvent(this.stageData.conversation.id, 'message', messageEventData);
    await this.generateResponse(context, executionOutcome);
  }

  private async generateResponse(context: ConversationContext, executionOutcome: ActionsExecutionOutcome) {
    const shouldGenerateResponse = executionOutcome.success && !executionOutcome.shouldEndConversation && !executionOutcome.shouldAbortConversation && executionOutcome.shouldGenerateResponse;
    if (shouldGenerateResponse) {
      // Send AI response start notification to client through WebSocket
      this.stageData.outputTurnId = generateId(ID_PREFIXES.OUTPUT);
      const message = {
        type: 'start_ai_generation_output',
        conversationId: this.conversation.id,
        outputTurnId: this.stageData.outputTurnId,
        sessionId: this.session.id,
        requestId: null,
        expectVoice: this.stageData.ttsProvider !== undefined && this.stageData.ttsProvider !== null
      } as StartAiGenerationOutputMessage;
      this.ws.send(JSON.stringify(message));

      await this.changeState('generating_response');
      if (this.stageData.ttsProvider) {
        await this.stageData.ttsProvider.start();
      }
      await this.responseGenerator.generateResponse(context, this.stageData.stage, this.stageData.completionLlmProvider);
    } else if (executionOutcome.shouldEndConversation) { // TODO: this should generate response and end conversation afterwards
      const eventData: ConversationEndEventData = {
        stageId: this.stageData.id,
        reason: executionOutcome.endReason || 'Action execution completed conversation',
      };
      await this.conversationService.saveConversationEvent(this.conversation.id, 'conversation_end', eventData);
      await this.changeState('finished');
    } else if (executionOutcome.shouldAbortConversation) {
      const eventData: ConversationAbortedEventData = {
        stageId: this.stageData.id,
        reason: executionOutcome.abortReason || 'Conversation aborted by action',
      };
      await this.conversationService.saveConversationEvent(this.conversation.id, 'conversation_aborted', eventData);
      await this.changeState('finished');
    } else {
      // If no response generation, go back to awaiting user input
      await this.changeState('awaiting_user_input');
    }
  }

  /**
   * Gets the current state of the conversation
   */
  getState(): ConversationState {
    return this.conversation.status;
  }

  /**
   * Gets the failure reason if the conversation has failed
   */
  getFailureReason(): string | undefined {
    return this.conversation.statusDetails;
  }

  private async changeState(newState: ConversationState) {
    this.conversation.status = newState;
    await this.conversationService.saveConversationState(this.conversation.id, newState);
  }
}