import { inject } from "tsyringe";
import { ConversationService } from "../ConversationService";
import { NotFoundError } from "../../errors";
import { StageService } from "../StageService";
import { ClassifierService } from "../ClassifierService";
import { ContextTransformerService } from "../ContextTransformerService";
import { Conversation } from "../../types/models";
import { db } from "../../db";

export class ConversationRunner {
  private conversation: Conversation;

  async prepareConversation(conversationId: string): Promise<void> {
    // load conversation data
    this.conversation = await db.query.conversations.findFirst({ where: (conversations, { eq }) => eq(conversations.id, conversationId) });
    if (!this.conversation) {
      throw new NotFoundError(`Conversation with ID ${conversationId} not found`);
    }

    // load current stage data
    const currentStageId = this.conversation.stageId;
    const stage = await db.query.stages.findFirst({ where: (stages, { eq }) => eq(stages.id, currentStageId) });
    if (!stage) {
      throw new NotFoundError(`Stage with ID ${currentStageId} not found`);
    }

    // load classifiers for the stage
    const classifiers = [];
    for (const classifierId of stage.classifierIds) {
      const classifier = await db.query.classifiers.findFirst({ where: (classifiers, { eq }) => eq(classifiers.id, classifierId) });
      if (!classifier) {
        throw new NotFoundError(`Classifier with ID ${classifierId} not found`);
      }
      classifiers.push(classifier);
    }

    // load transformers for the stage
    const transformers = [];
    for (const transformerId of stage.transformerIds) {
      const transformer = await db.query.contextTransformers.findFirst({ where: (contextTransformers, { eq }) => eq(contextTransformers.id, transformerId) });
      if (!transformer) {
        throw new NotFoundError(`Transformer with ID ${transformerId} not found`);
      }
      transformers.push(transformer);
    }

    // initialize resources  

  }

  async runConversation(conversationId: string): Promise<void> { }
}