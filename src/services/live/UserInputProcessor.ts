import { inject, singleton } from "tsyringe";
import { Connection } from "../../websocket/ConnectionManager";
import { ClassifierRuntimeData } from "./ConversationRunner";
import logger from "../../utils/logger";
import { ConversationContext } from "./ConversationContextBuilder";
import { TemplatingEngine } from "./TemplatingEngine";
import { ConversationService } from "../ConversationService";
import { ClassificationEventData } from "../../types/conversationEvents";
import { parseJsonFromMarkdown } from "../../utils/jsonParser";
import { classificationResultSchema, ActionClassificationResult, ClassificationResultWithClassifier } from "../../types/classification";


/**
 * Service responsible for processing user input during live sessions.
 */
@singleton()
export class UserInputProcessor {
  constructor(
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
          input: context.userInput || '',
          actions: [result],
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
      logger.info({ sessionId: session.id, classifierId: classifier.id }, `Received classification result from LLM provider: ${result.content}`);
      const classificationResult = classificationResultSchema.parse(parseJsonFromMarkdown(result.content));
      
      // Convert actions object to array format
      const actions: ActionClassificationResult[] = Object.entries(classificationResult.actions).map(([name, parameters]) => ({
        name,
        parameters,
      }));
      
      return {
        classifierId: classifier.id,
        classifierName: classifier.name,
        actions,
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