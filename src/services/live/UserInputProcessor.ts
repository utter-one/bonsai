import { singleton } from "tsyringe";
import { z } from "zod";
import { Session } from "./SessionManager";
import { StageAction } from "../../contracts/rest/stage";
import { ClassifierRuntimeData } from "./ConversationRunner";
import logger from "../../utils/logger";

const actionClassificationResultSchema = z.object({
  actionName: z.string(),
  entities: z.record(z.string(), z.any())
});

const classificationResultSchema = z.object({
  actions: z.array(actionClassificationResultSchema)
});

type ActionClassificationResult = z.infer<typeof actionClassificationResultSchema>;
type ClassificationResult = z.infer<typeof classificationResultSchema>;


/**
 * Service responsible for processing user input during live sessions.
 */
@singleton()
export class UserInputProcessor {
  /** Processes text input from the user within a session.
   * @param session - The session in which the input was received.
   * @param text - The text input from the user.
   * @returns A promise that resolves to an array of stage actions resulting from processing the input.
   */
  async processTextInput(session: Session, text: string): Promise<ActionClassificationResult[]> {
    // How to process:
    // 1. Get all classifiers for the current stage.
    // 2. For each classifier, run the text through it to determine actions. Do this in parallel.
    // 3. Collect and return all detected actions from classifiers.

    try {
      const classifiers = session.runner.getRuntimeData().classifiers;
      const actionPromises = classifiers.map(async (classifier) => {
        return this.classifyTextInput(session, classifier, text);
      });

      const actionsArrays = await Promise.all(actionPromises);
      return actionsArrays.map(x => x.actions).flat();
    } catch (error) {
      logger.error({ error, sessionId: session.id }, 'Error processing text input using classifiers');
      throw error;
    } 
  }

  private async classifyTextInput(session: Session, classifierData: ClassifierRuntimeData, text: string): Promise<ClassificationResult> {
    try {
      logger.debug({ sessionId: session.id, classifierId: classifierData.classifier.id }, 'Classifying text input using classifier');
      const llmProvider = classifierData.llmProvider;
      const classifier = classifierData.classifier;

      const messages = [
        {
          role: 'system' as const,
          content: classifier.prompt
        },
        {
          role: 'user' as const,
          content: text
        }
      ];

      const result = await llmProvider.generate(messages);
      const classificationResult = classificationResultSchema.parse(result.content);
      return classificationResult;
    } catch (error) {
      logger.error({ error, sessionId: session.id, classifierId: classifierData.classifier.id }, 'Error classifying text input');
      return { actions: [] };
    }
  }
}