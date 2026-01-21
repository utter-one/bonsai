import { inject, singleton } from "tsyringe";
import { z } from "zod";
import { Connection } from "../../websocket/ConnectionManager";
import { StageAction } from "../../http/contracts/stage";
import { ClassifierRuntimeData } from "./ConversationRunner";
import logger from "../../utils/logger";
import { ConversationContext, ConversationContextBuilder } from "./ConversationContextBuilder";
import { TemplatingEngine } from "./TemplatingEngine";

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
  constructor(@inject(ConversationContextBuilder) private llmContextBuilder: ConversationContextBuilder,
    @inject(TemplatingEngine) private templatingEngine: TemplatingEngine) {}

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

      const actionsArrays = await Promise.all(actionPromises);
      return actionsArrays.map(x => x.actions).flat();
    } catch (error) {
      logger.error({ error, sessionId: session.id }, 'Error processing text input using classifiers');
      throw error;
    } 
  }

  private async classifyTextInput(session: Connection, classifierData: ClassifierRuntimeData, context: ConversationContext): Promise<ClassificationResult> {
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
      return classificationResult;
    } catch (error) {
      logger.error({ error, sessionId: session.id, classifierId: classifierData.classifier.id }, 'Error classifying text input');
      return { actions: [] };
    }
  }
}