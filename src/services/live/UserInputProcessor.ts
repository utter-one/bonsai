import { inject, singleton } from "tsyringe";
import { z } from "zod";
import { Connection } from "../../websocket/ConnectionManager";
import { ClassifierRuntimeData } from "./ConversationRunner";
import logger from "../../utils/logger";
import { ConversationContext, ConversationContextBuilder } from "./ConversationContextBuilder";
import { TemplatingEngine } from "./TemplatingEngine";
import { ConversationService } from "../ConversationService";
import { ClassificationEventData } from "../../db/schema";

const actionClassificationResultSchema = z.object({
  actionName: z.string(),
  entities: z.record(z.string(), z.any())
});

const classificationResultSchema = z.object({
  actions: z.array(actionClassificationResultSchema)
});

type ActionClassificationResult = z.infer<typeof actionClassificationResultSchema>;
type ClassificationResult = z.infer<typeof classificationResultSchema>;

export type ClassificationResultWithClassifier = {
  classifierId: string;
  classifierName: string;
  actions: ActionClassificationResult[];
};


/**
 * Service responsible for processing user input during live sessions.
 */
@singleton()
export class UserInputProcessor {
  constructor(
    @inject(ConversationContextBuilder) private llmContextBuilder: ConversationContextBuilder,
    @inject(TemplatingEngine) private templatingEngine: TemplatingEngine,
    @inject(ConversationService) private conversationService: ConversationService
  ) {}

  /** Processes text input from the user within a session.
   * @param session - The session in which the input was received.
   * @param text - The text input from the user.
   * @returns A promise that resolves to an array of stage actions resulting from processing the input.
   */
  async processTextInput(session: Connection, context: ConversationContext): Promise<ActionClassificationResult[]> {
    // How to process:
    // - Get all classifiers for the current stage.
    // - For each classifier, run the text through it to determine actions. Do this in parallel.
    // - Collect and return all detected actions from classifiers.

    try {
      const classifiers = session.runner.getRuntimeData().classifiers;
      const actionPromises = classifiers.map(async (classifier) => {
        return this.classifyTextInput(session, classifier, context);
      });

      const classificationResultsWithClassifiers = await Promise.all(actionPromises);
      
      // Register classification events for each classifier
      for (const result of classificationResultsWithClassifiers) {
        const eventData: ClassificationEventData = {
          classifierId: result.classifierId,
          input: context.userInput,
          actions: result.actions.map(action => ({
            name: action.actionName,
            operations: [],
          })) as any,
          metadata: {
            classifierName: result.classifierName,
            actionCount: result.actions.length,
          },
        };
        await this.conversationService.saveConversationEvent(context.conversationId, 'classification', eventData);
      }

      return classificationResultsWithClassifiers.map(x => x.actions).flat();
    } catch (error) {
      logger.error({ error, sessionId: session.id }, 'Error processing text input using classifiers');
      throw error;
    } 
  }

  private async classifyTextInput(session: Connection, classifierData: ClassifierRuntimeData, context: ConversationContext): Promise<ClassificationResultWithClassifier> {
    try {
      logger.debug({ sessionId: session.id, classifierId: classifierData.classifier.id }, 'Classifying text input using classifier');
      const llmProvider = classifierData.llmProvider;
      const classifier = classifierData.classifier;
      const text = context.userInput || '';

      const messages = [
        {
          role: 'system' as const,
          content: await this.templatingEngine.render(classifier.prompt, context)
        },
        {
          role: 'user' as const,
          content: text
        }
      ];

      const result = await llmProvider.generate(messages);
      const classificationResult = classificationResultSchema.parse(result.content);
      
      return {
        classifierId: classifier.id,
        classifierName: classifier.name,
        actions: classificationResult.actions,
      };
    } catch (error) {
      logger.error({ error, sessionId: session.id, classifierId: classifierData.classifier.id }, 'Error classifying text input');
      return {
        classifierId: classifierData.classifier.id,
        classifierName: classifierData.classifier.name,
        actions: [],
      };
    }
  }
}