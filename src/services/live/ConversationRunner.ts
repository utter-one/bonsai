import { inject } from "tsyringe";
import { ConversationService } from "../ConversationService";
import { NotFoundError } from "../../errors";
import { StageService } from "../StageService";
import { ClassifierService } from "../ClassifierService";
import { ContextTransformerService } from "../ContextTransformerService";
import { Classifier, ContextTransformer, Conversation } from "../../types/models";
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
  classifiers: ClassifierData[];
  transformers: TransformerData[];
}

export class ConversationRunner {
  private conversation: Conversation;
  private stageData: StageData;

  constructor(@inject(LlmProviderFactory) private llmProviderFactory: LlmProviderFactory) {}

  async prepareConversation(conversationId: string): Promise<void> {
    // load conversation data
    this.conversation = await db.query.conversations.findFirst({ where: (conversations, { eq }) => eq(conversations.id, conversationId) });
    if (!this.conversation) {
      throw new NotFoundError(`Conversation with ID ${conversationId} not found`);
    }

    // check if conversation is active
    if (this.conversation.status !== 'active') {
      throw new Error(`Conversation with ID ${conversationId} is not active`);
    }

    this.stageData = await this.loadStageData(this.conversation.stageId);

  }

  private async loadStageData(stageId: string): Promise<StageData> {
    const stageData: StageData = {
      id: stageId,
      classifiers: [],
      transformers: [],
    };

    // load current stage data
    this.stageData = {} as StageData;
    this.stageData.id = this.conversation.stageId;
    const stage = await db.query.stages.findFirst({ where: (stages, { eq }) => eq(stages.id, this.stageData.id) });
    if (!stage) {
      throw new NotFoundError(`Stage with ID ${this.stageData.id} not found`);
    }

    // load classifiers for the stage
    for (const classifierId of stage.classifierIds) {
      const classifier = await db.query.classifiers.findFirst({ where: (classifiers, { eq }) => eq(classifiers.id, classifierId) });
      if (!classifier) {
        throw new NotFoundError(`Classifier with ID ${classifierId} not found`);
      }
      const llmProviderEntity = await db.query.providers.findFirst({ where: (providers, { eq }) => eq(providers.id, classifier.llmProviderId) });
      const llmProvider = this.llmProviderFactory.createProvider(llmProviderEntity);
      this.stageData.classifiers.push({ classifier, llmProvider });
    }

    // load transformers for the stage
    this.stageData.transformers = [];
    for (const transformerId of stage.transformerIds) {
      const transformer = await db.query.contextTransformers.findFirst({ where: (contextTransformers, { eq }) => eq(contextTransformers.id, transformerId) });
      if (!transformer) {
        throw new NotFoundError(`Transformer with ID ${transformerId} not found`);
      }
      const llmProviderEntity = await db.query.providers.findFirst({ where: (providers, { eq }) => eq(providers.id, transformer.llmProviderId) });
      const llmProvider = this.llmProviderFactory.createProvider(llmProviderEntity);
      this.stageData.transformers.push({ transformer, llmProvider });
    }

    return stageData;
  }

  async runConversation(conversationId: string): Promise<void> { }
}