import { inject } from "tsyringe";
import { NotFoundError } from "../../errors";
import { Classifier, ContextTransformer, Conversation, Stage } from "../../types/models";
import { db } from "../../db";
import { ILlmProvider, LlmProviderFactory } from "../providers/llm";

type ClassifierData = {
  classifier: Classifier;
  llmProvider: ILlmProvider;
}

type TransformerData = {
  transformer: ContextTransformer;
  llmProvider: ILlmProvider;
}

type StageData = {
  id: string;
  stage: Stage;
  classifiers: ClassifierData[];
  transformers: TransformerData[];
}

type ConversationState = 'awaiting_user_input' // Runner is waiting for user input (text or voice)
  | 'receiving_user_voice' // Runner is receiving voice input from user (ASR in progress)
  | 'processing_user_input' // Runner is processing user input (classification/transformation)
  | 'generating_response' // Runner is generating a response  
  | 'finished'; // Runner has finished

/** 
 * Manages the lifecycle and state of a conversation. Runners are hosted by the SessionManager.
 */
export class ConversationRunner {
  private conversation: Conversation;
  private stageData: StageData;
  private state: ConversationState = 'awaiting_user_input';

  constructor(@inject(LlmProviderFactory) private llmProviderFactory: LlmProviderFactory) { }

  async prepareConversation(conversationId: string): Promise<void> {
    // Load conversation data
    this.conversation = await db.query.conversations.findFirst({ where: (conversations, { eq }) => eq(conversations.id, conversationId) });
    if (!this.conversation) {
      throw new NotFoundError(`Conversation with ID ${conversationId} not found`);
    }

    // Check if conversation is active
    if (this.conversation.status !== 'active') {
      throw new Error(`Conversation with ID ${conversationId} is not active`);
    }

    this.stageData = await this.buildStageData(this.conversation.stageId);
    this.state = this.stageData.stage.enterBehavior === 'await_user_input' ? 'awaiting_user_input' : 'generating_response';
    await this.wireUpProviders();
  }

  private async buildStageData(stageId: string): Promise<StageData> {
    // Load current stage data
    const stage = await db.query.stages.findFirst({ where: (stages, { eq }) => eq(stages.id, stageId) });
    if (!stage) {
      throw new NotFoundError(`Stage with ID ${stageId} not found`);
    }

    const stageData: StageData = {
      id: stageId,
      stage: stage,
      classifiers: [],
      transformers: [],
    };

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

    return stageData;
  }

  private async wireUpProviders() {
    // TODO: wire up ASR, TTS, and other providers as needed

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

    this.state = 'processing_user_input';

    throw new Error("Method not implemented.");
  }

  async startUserVoiceInput() {
    if (this.state !== 'awaiting_user_input') {
      throw new Error(`Cannot start receiving user voice input in current state: ${this.state}`);
    }

    this.state = 'receiving_user_voice';

    throw new Error("Method not implemented.");
  }

  async receiveUserVoiceData(voiceData: Buffer) {
    if (this.state !== 'receiving_user_voice') {
      throw new Error(`Cannot receive user voice data in current state: ${this.state}`);
    }
    
    throw new Error("Method not implemented.");
  }

  async stopUserVoiceInput() {
    if (this.state !== 'receiving_user_voice') {
      throw new Error(`Cannot stop receiving user voice input in current state: ${this.state}`);
    }

    this.state = 'processing_user_input';

    throw new Error("Method not implemented.");
  }

  async receiveCommand(command: string, data: any) {    
    throw new Error("Method not implemented.");
  }
}