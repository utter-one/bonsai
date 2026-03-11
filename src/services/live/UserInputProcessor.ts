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
import { Conversation, GlobalAction, Guardrail } from "../../types/models";
import { extractTextFromContent } from "../../utils/llm";
import { StageAction } from "../../types/actions";
import type { KnowledgeCategoryResponse } from "../../http/contracts/knowledge";
import { ContextTransformerExecutor } from "./ContextTransformerExecutor";

/** Result of processing user input, including actions and timing metadata */
export type ProcessTextInputResult = {
  actions: ActionClassificationResult[];
  /** Duration of the knowledge category retrieval in milliseconds; undefined when knowledge is not used */
  knowledgeRetrievalDurationMs?: number;
};

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
   * @returns A promise that resolves to the processing result with actions and timing metadata.
   */
  async processTextInput(session: Connection, userInput: string, originalUserInput: string): Promise<ProcessTextInputResult> {
    // How to process:
    // - Get all classifiers for the current stage.
    // - For each classifier, run the text through it to determine actions with filtered actions based on overrideClassifierId. Do this in parallel.
    // - Collect and return all detected actions from classifiers.

    try {
      const classifiers = session.runner.getRuntimeData().classifiers;
      const stage = session.runner.getRuntimeData().stage;
      const conversation = session.runner.getRuntimeData().conversation;
      const globalActions = session.runner.getRuntimeData().globalActions.filter(ga => !ga.id.startsWith('__'));
      const guardrails = session.runner.getRuntimeData().guardrails;
      const guardrailClassifier = session.runner.getRuntimeData().guardrailClassifier;

      // Fetch knowledge categories for the default classifier when knowledge is enabled
      let knowledgeCategories: KnowledgeCategoryResponse[] = [];
      let knowledgeRetrievalDurationMs: number | undefined;
      if (stage.useKnowledge && stage.defaultClassifierId) {
        const knowledgeStartMs = Date.now();
        knowledgeCategories = stage.knowledgeTags.length > 0
          ? await this.knowledgeService.getCategoriesByTags(conversation.projectId, stage.knowledgeTags)
          : (await this.knowledgeService.listKnowledgeCategories(conversation.projectId, { offset: 0, limit: 100 })).items;
        knowledgeRetrievalDurationMs = Date.now() - knowledgeStartMs;
        logger.debug({ conversationId: conversation.id, categoryCount: knowledgeCategories.length, classifierId: stage.defaultClassifierId, knowledgeRetrievalDurationMs }, 'Fetched knowledge categories for default classifier');
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

      // Build guardrail classification promise if a guardrail classifier is configured and there are active guardrails
      const guardrailPromise = guardrailClassifier && guardrails.length > 0
        ? (async () => {
            const guardrailContext = await this.contextBuilder.buildContextForGuardrailClassifier(conversation, stage, guardrails, userInput, originalUserInput);
            return this.classifyTextInput(session, guardrailClassifier, guardrailContext);
          })()
        : Promise.resolve(null);

      // Run all classifiers, guardrail classifier, and context transformers in parallel
      const [classificationResultsWithClassifiers, guardrailResult, transformerTriggeredActions] = await Promise.all([
        Promise.all(actionPromises),
        guardrailPromise,
        this.transformerExecutor.executeTransformers(session, userInput, originalUserInput),
      ]);

      // Register classification events for stage classifiers
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
            durationMs: result.durationMs,
          },
        };
        await this.conversationService.saveConversationEvent(conversation.projectId, conversation.id, 'classification', eventData);
        this.connectionManager.sendConversationEvent(conversation.id, 'classification', eventData);
      }

      // Register classification event for guardrail classifier
      if (guardrailResult) {
        const eventData: ClassificationEventData = {
          classifierId: guardrailResult.classifierId,
          input: userInput || '',
          actions: [guardrailResult],
          metadata: {
            classifierName: guardrailResult.classifierName,
            actionCount: guardrailResult.actions.length,
            systemPrompt: guardrailResult.renderedPrompt,
            llmSettings: guardrailClassifier?.classifier.llmSettings,
            currentVariables: conversation?.stageVars[stage.id] || {},
            durationMs: guardrailResult.durationMs,
          },
        };
        await this.conversationService.saveConversationEvent(conversation.projectId, conversation.id, 'classification', eventData);
        this.connectionManager.sendConversationEvent(conversation.id, 'classification', eventData);
      }

      const allActions = [
        ...classificationResultsWithClassifiers.map(x => x.actions).flat(),
        ...(guardrailResult?.actions ?? []),
        ...transformerTriggeredActions,
      ];
      const globalActionsMap = new Map(session.runner.getRuntimeData().globalActions.map(ga => [ga.id, ga]));
      const guardrailsMap = new Map(session.runner.getRuntimeData().guardrails.map(g => [g.id, g]));

      const knowledgeCategoryIds = new Set(knowledgeCategories.map(c => `__knowledge_${c.id}`));

      const filteredActions = allActions.filter(action => {
        // Allow synthetic knowledge actions to pass through without looking them up in stage or global actions
        if (knowledgeCategoryIds.has(action.name)) {
          return true;
        }

        // Check guardrails map first (guardrail actions use their ID as the action name)
        if (guardrailsMap.has(action.name)) {
          return true;
        }

        let actionDef : GlobalAction | StageAction = globalActionsMap.get(action.name);
        if (!actionDef) {
          actionDef = stage.actions[action.name];
        } 

        if (!actionDef) {
          logger.warn({ conversationId: session.id, actionName: action.name }, `Received action ${action.name} from classifier which does not exist in global actions, guardrails, or stage actions. Ignoring.`);
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

      return { actions: filteredActions, knowledgeRetrievalDurationMs };
    } catch (error) {
      logger.error({ error, sessionId: session.id }, 'Error processing text input using classifiers');
      throw error;
    } 
  }

  private async classifyTextInput(session: Connection, classifierData: ClassifierRuntimeData, context: ConversationContext): Promise<ClassificationResultWithClassifier & { renderedPrompt: string; durationMs: number }> {
    const classifyStartMs = Date.now();
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
        durationMs: Date.now() - classifyStartMs,
      };
    } catch (error) {
      logger.error({ error, sessionId: session.id, classifierId: classifierData.classifier.id }, 'Error classifying text input');
      return {
        classifierId: classifierData.classifier.id,
        classifierName: classifierData.classifier.name,
        actions: [],
        renderedPrompt: null,
        durationMs: Date.now() - classifyStartMs,
      };
    }
  }
}