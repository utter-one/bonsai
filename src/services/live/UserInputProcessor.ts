import { inject, singleton } from "tsyringe";
import { Connection, ConnectionManager } from "../../websocket/ConnectionManager";
import { ClassifierRuntimeData } from "./ConversationRunner";
import logger from "../../utils/logger";
import { ConversationContext, ConversationContextBuilder } from "./ConversationContextBuilder";
import { TemplatingEngine } from "./TemplatingEngine";
import { ConversationService } from "../ConversationService";
import { KnowledgeService } from "../KnowledgeService";
import { ClassificationEventData } from "../../types/conversationEvents";
import { parseJsonFromMarkdown } from "../../utils/jsonParser";
import { classificationResultSchema, ActionClassificationResult, ClassificationResultWithClassifier } from "../../types/classification";
import { Conversation, GlobalAction } from "../../types/models";
import { extractTextFromContent } from "../../utils/llm";
import { StageAction } from "../../types/actions";
import type { KnowledgeCategoryResponse } from "../../http/contracts/knowledge";
import { ContextTransformerExecutor } from "./ContextTransformerExecutor";

/**
 * Service responsible for processing user input during live sessions.
 */
@singleton()
export class UserInputProcessor {
  constructor(
    @inject(TemplatingEngine) private templatingEngine: TemplatingEngine,
    @inject(ConversationContextBuilder) private contextBuilder: ConversationContextBuilder,
    @inject(ConversationService) private conversationService: ConversationService,
    @inject(ConnectionManager) private connectionManager: ConnectionManager,
    @inject(KnowledgeService) private knowledgeService: KnowledgeService,
    @inject(ContextTransformerExecutor) private transformerExecutor: ContextTransformerExecutor,
  ) {}

  /** Processes text input from the user within a session.
   * @param session - The session in which the input was received.
   * @param text - The text input from the user.
   * @returns A promise that resolves to an array of stage actions resulting from processing the input.
   */
  async processTextInput(session: Connection, userInput: string, originalUserInput: string): Promise<ActionClassificationResult[]> {
    // How to process:
    // - Get all classifiers for the current stage.
    // - For each classifier, run the text through it to determine actions with filtered actions based on overrideClassifierId. Do this in parallel.
    // - Collect and return all detected actions from classifiers.

    try {
      const classifiers = session.runner.getRuntimeData().classifiers;
      const stage = session.runner.getRuntimeData().stage;
      const conversation = session.runner.getRuntimeData().conversation;
      const globalActions = session.runner.getRuntimeData().globalActions;

      // Fetch knowledge categories for the default classifier when knowledge is enabled
      let knowledgeCategories: KnowledgeCategoryResponse[] = [];
      if (stage.useKnowledge && stage.defaultClassifierId) {
        knowledgeCategories = stage.knowledgeTags.length > 0
          ? await this.knowledgeService.getCategoriesByTags(stage.knowledgeTags)
          : (await this.knowledgeService.listKnowledgeCategories({ filters: { projectId: session.runner.getRuntimeData().conversation.projectId } , offset: 0, limit: 100 })).items;
        logger.debug({ conversationId: conversation.id, categoryCount: knowledgeCategories.length, classifierId: stage.defaultClassifierId }, 'Fetched knowledge categories for default classifier');
      }
      
      const actionPromises = classifiers.map(async (classifier) => {
        // Inject knowledge categories only for the default classifier
        const classifierKnowledgeCategories = classifier.classifier.id === stage.defaultClassifierId ? knowledgeCategories : [];
        // Build context specific to this classifier with filtered actions
        const classifierContext = await this.contextBuilder.buildContextForClassifier(
          conversation,
          stage,
          globalActions,
          classifier.classifier.id,
          userInput,
          originalUserInput,
          classifierKnowledgeCategories
        );
        return this.classifyTextInput(session, classifier, classifierContext);
      });

      // Run all classifiers and all context transformers in parallel
      const [classificationResultsWithClassifiers, transformerTriggeredActions] = await Promise.all([
        Promise.all(actionPromises),
        this.transformerExecutor.executeTransformers(session, userInput, originalUserInput),
      ]);
      
      // Register classification events for each classifier
      for (const result of classificationResultsWithClassifiers) {
        const classifier = classifiers.find(c => c.classifier.id === result.classifierId);
        const eventData: ClassificationEventData = {
          classifierId: result.classifierId,
          input: userInput || '',
          actions: [result],
          metadata: {
            classifierName: result.classifierName,
            actionCount: result.actions.length,
            systemPrompt: result.renderedPrompt,
            llmSettings: classifier?.classifier.llmSettings,
            currentVariables: conversation?.stageVars[stage.id] || {},
          },
        };
        await this.conversationService.saveConversationEvent(conversation.id, 'classification', eventData);
        this.connectionManager.sendConversationEvent(conversation.id, 'classification', eventData);
      }

      const allActions = [
        ...classificationResultsWithClassifiers.map(x => x.actions).flat(),
        ...transformerTriggeredActions,
      ];
      const globalActionsMap = new Map(session.runner.getRuntimeData().globalActions.map(ga => [ga.id, ga]));

      const knowledgeCategoryIds = new Set(knowledgeCategories.map(c => `__knowledge_${c.id}`));

      const filteredActions = allActions.filter(action => {
        // Allow synthetic knowledge actions to pass through without looking them up in stage or global actions
        if (knowledgeCategoryIds.has(action.name)) {
          return true;
        }

        let actionDef : GlobalAction | StageAction = globalActionsMap.get(action.name);
        if (!actionDef) {
          actionDef = stage.actions[action.name];
        } 

        if (!actionDef) {
          logger.warn({ conversationId: session.id, actionName: action.name }, `Received action ${action.name} from classifier which does not exist in global actions or stage actions. Ignoring.`);
          return false;
        }

        // Check if we have all required parameters for the action
        const missingRequiredParams = (actionDef.parameters || []).filter(p => p.required && action.parameters[p.name] == null).map(p => p.name);
        if (missingRequiredParams.length > 0) {
          logger.warn({ conversationId: session.id, actionName: action.name, missingParameters: missingRequiredParams }, `Received incomplete action ${action.name} from classifier. Missing required parameters: ${missingRequiredParams.join(', ')}. Ignoring.`);
          return false;
        }

        return true;
      });

      return filteredActions;
    } catch (error) {
      logger.error({ error, sessionId: session.id }, 'Error processing text input using classifiers');
      throw error;
    } 
  }

  private async classifyTextInput(session: Connection, classifierData: ClassifierRuntimeData, context: ConversationContext): Promise<ClassificationResultWithClassifier & { renderedPrompt: string }> {
    try {
      logger.debug({ sessionId: session.id, classifierId: classifierData.classifier.id }, 'Classifying text input using classifier');
      const llmProvider = classifierData.llmProvider;
      const classifier = classifierData.classifier;
      const text = context.userInput || '';
      const renderedPrompt = await this.templatingEngine.render(classifier.prompt, context);

      const messages = [
        {
          role: 'system' as const,
          content: renderedPrompt
        },
        {
          role: 'user' as const,
          content: text
        }
      ];

      const result = await llmProvider.generate(messages);
      const textContent = extractTextFromContent(result.content);
      
      logger.info({ sessionId: session.id, classifierId: classifier.id }, `Received classification result from LLM provider: ${textContent}`);
      const classificationResult = classificationResultSchema.parse(parseJsonFromMarkdown(textContent));
      
      // Convert actions object to array format
      const actions: ActionClassificationResult[] = Object.entries(classificationResult.actions).map(([name, parameters]) => ({
        name,
        parameters,
      }));
      
      return {
        classifierId: classifier.id,
        classifierName: classifier.name,
        actions,
        renderedPrompt,
      };
    } catch (error) {
      logger.error({ error, sessionId: session.id, classifierId: classifierData.classifier.id }, 'Error classifying text input');
      return {
        classifierId: classifierData.classifier.id,
        classifierName: classifierData.classifier.name,
        actions: [],
        renderedPrompt: null,
      };
    }
  }
}