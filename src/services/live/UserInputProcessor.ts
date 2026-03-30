import { inject, singleton } from "tsyringe";
import { Session } from "../../channels/SessionManager";
import { ClassifierRuntimeData } from "./ConversationRunner";
import logger from "../../utils/logger";
import { ConversationContext, ConversationContextBuilder } from "./ConversationContextBuilder";
import { TemplatingEngine } from "./TemplatingEngine";
import { ConversationService } from "../ConversationService";
import { KnowledgeService } from "../KnowledgeService";
import { ClassificationEventData, SampleCopySelectionEventData } from "../../types/conversationEvents";
import { parseJsonFromMarkdown } from "../../utils/jsonParser";
import { classificationResultSchema, ActionClassificationResult, ActionClassificationResultWithClassifier, SampleCopyClassificationResult, sampleCopyClassificationResultSchema } from "../../types/classification";
import { extractTextFromContent } from "../../utils/llm";
import type { KnowledgeCategoryResponse } from "../../http/contracts/knowledge";
import { ContextTransformerExecutor } from "./ContextTransformerExecutor";
import { buildLlmUsage, type LlmUsageMetadata } from '../../utils/llmUsage';

/** Result of processing user input, including actions and timing metadata */
export type ProcessTextInputResult = {
  actions: ActionClassificationResult[];
  /** Duration of the knowledge category retrieval in milliseconds; undefined when knowledge is not used */
  knowledgeRetrievalDurationMs?: number;
  /** Unix timestamp (ms) when knowledge retrieval started; undefined when knowledge is not used */
  knowledgeRetrievalStartMs?: number;
  /** Unix timestamp (ms) when knowledge retrieval completed; undefined when knowledge is not used */
  knowledgeRetrievalEndMs?: number;
  /** Result of the sample copy classification; undefined when sample copy is not configured for this stage */
  sampleCopyResult?: SampleCopyClassificationResult;
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
    @inject(KnowledgeService) private knowledgeService: KnowledgeService,
    @inject(ContextTransformerExecutor) private transformerExecutor: ContextTransformerExecutor,
  ) { }

  /** Processes text input from the user within a session.
   * @param session - The session in which the input was received.
   * @param text - The text input from the user.
   * @returns A promise that resolves to the processing result with actions and timing metadata.
   */
  async processTextInput(session: Session, userInput: string, originalUserInput: string): Promise<ProcessTextInputResult> {
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
      const sampleCopies = session.runner.getRuntimeData().sampleCopies;
      const sampleCopyClassifier = session.runner.getRuntimeData().sampleCopyClassifier;

      // Fetch knowledge categories for the default classifier when knowledge is enabled
      let knowledgeCategories: KnowledgeCategoryResponse[] = [];
      let knowledgeRetrievalDurationMs: number | undefined;
      let knowledgeRetrievalStartMs: number | undefined;
      let knowledgeRetrievalEndMs: number | undefined;
      if (stage.useKnowledge && stage.defaultClassifierId) {
        const knowledgeStartMs = Date.now();
        knowledgeCategories = stage.knowledgeTags.length > 0
          ? await this.knowledgeService.getCategoriesByTags(conversation.projectId, stage.knowledgeTags)
          : (await this.knowledgeService.listKnowledgeCategories(conversation.projectId, { offset: 0, limit: 100 })).items;
        const knowledgeEndMs = Date.now();
        knowledgeRetrievalDurationMs = knowledgeEndMs - knowledgeStartMs;
        knowledgeRetrievalStartMs = knowledgeStartMs;
        knowledgeRetrievalEndMs = knowledgeEndMs;
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

      // Build sample copy classification promise if a classifier is configured and there are applicable sample copies for this stage
      const sampleCopyPromise = sampleCopyClassifier && sampleCopies.length > 0
        ? (async () => {
          const sampleCopyContext = await this.contextBuilder.buildContextForSampleCopyClassifier(conversation, stage, sampleCopies, userInput, originalUserInput);
          return this.classifyCopyForInput(session, sampleCopyContext);
        })()
        : Promise.resolve(null);

      // Run all classifiers, guardrail classifier, sample copy classifier, and context transformers in parallel
      const [classificationResultsWithClassifiers, guardrailResult, sampleCopyResult, transformerTriggeredActions] = await Promise.all([
        Promise.all(actionPromises),
        guardrailPromise,
        sampleCopyPromise,
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
            llmUsage: result.llmUsage,
            currentVariables: conversation?.stageVars[stage.id] || {},
            durationMs: result.durationMs,
            startMs: result.startMs,
            endMs: result.endMs,
          },
        };
        await this.conversationService.saveConversationEvent(conversation.projectId, conversation.id, 'classification', eventData);
        await session.clientConnection.sendMessage({ type: 'conversation_event', conversationId: conversation.id, eventType: 'classification', eventData });
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
            llmUsage: guardrailResult.llmUsage,
            currentVariables: conversation?.stageVars[stage.id] || {},
            durationMs: guardrailResult.durationMs,
            startMs: guardrailResult.startMs,
            endMs: guardrailResult.endMs,
          },
        };
        await this.conversationService.saveConversationEvent(conversation.projectId, conversation.id, 'classification', eventData);
        await session.clientConnection.sendMessage({ type: 'conversation_event', conversationId: conversation.id, eventType: 'classification', eventData });
      }

      // Register sample copy selection event
      if (sampleCopyResult) {
        const eventData: SampleCopySelectionEventData = {
          classifierId: sampleCopyClassifier!.classifier.id,
          input: userInput || '',
          sampleCopy: sampleCopyResult.sampleCopy,
          metadata: {
            classifierName: sampleCopyClassifier!.classifier.name,
            systemPrompt: sampleCopyResult.renderedPrompt,
            result: sampleCopyResult.result,
            llmUsage: sampleCopyResult.llmUsage,
            currentVariables: conversation?.stageVars[stage.id] || {},
            durationMs: sampleCopyResult.durationMs,
            startMs: sampleCopyResult.startMs,
            endMs: sampleCopyResult.endMs,
          },
        };
        await this.conversationService.saveConversationEvent(conversation.projectId, conversation.id, 'sample_copy_selection', eventData);
        await session.clientConnection.sendMessage({ type: 'conversation_event', conversationId: conversation.id, eventType: 'sample_copy_selection', eventData });
      }

      const allActions = [
        ...classificationResultsWithClassifiers.map(x => x.actions).flat(),
        ...(guardrailResult?.actions ?? []),
        ...transformerTriggeredActions,
      ];
      const globalActionsMap = new Map(session.runner.getRuntimeData().globalActions.map(ga => [ga.name, ga]));
      const guardrailsMap = new Map(session.runner.getRuntimeData().guardrails.map(g => [g.name, g]));
      const knowledgeCategoryIds = new Set(knowledgeCategories.map(c => `__knowledge_${c.id}`));
      const stageActionsMap = new Map(Object.values(stage.actions).map(a => [a.name, a]));
      const filteredActions = allActions.filter(action => {
        // Allow synthetic knowledge actions to pass through without looking them up in stage or global actions
        if (knowledgeCategoryIds.has(action.name)) {
          return true;
        }

        let actionDef = guardrailsMap.get(action.name)
          ?? globalActionsMap.get(action.name)
          ?? stageActionsMap.get(action.name);

        if (!actionDef) {
          logger.warn({ actions: stage.actions, conversationId: session.id, actionName: action.name }, `Received action ${action.name} from classifier which does not exist in global actions, guardrails, or stage actions. Ignoring.`);
          return false;
        }

        // Check if we have all required parameters for the action
        if ('parameters' in actionDef) {
          const missingRequiredParams = (actionDef.parameters || []).filter(p => p.required && action.parameters[p.name] == null).map(p => p.name);
          if (missingRequiredParams.length > 0) {
            logger.warn({ conversationId: session.id, actionName: action.name, missingParameters: missingRequiredParams }, `Received incomplete action ${action.name} from classifier. Missing required parameters: ${missingRequiredParams.join(', ')}. Ignoring.`);
            return false;
          }
        }

        return true;
      });

      return { actions: filteredActions, knowledgeRetrievalDurationMs, knowledgeRetrievalStartMs, knowledgeRetrievalEndMs, sampleCopyResult: sampleCopyResult ?? undefined };
    } catch (error) {
      logger.error({ error, sessionId: session.id }, 'Error processing text input using classifiers');
      throw error;
    }
  }

  private async classifyCopyForInput(session: Session, context: ConversationContext): Promise<SampleCopyClassificationResult & { renderedPrompt: string; result: string; llmUsage?: LlmUsageMetadata; durationMs: number; startMs: number; endMs: number }> {
    const classifyStartMs = Date.now();
    try {
      const classifierData = session.runner.getRuntimeData().sampleCopyClassifier;
      if (!classifierData) {
        throw new Error('No sample copy classifier configured for this stage');
      }
      logger.debug({ sessionId: session.id, classifierId: classifierData.classifier.id }, 'Classifying sample copy for text input using sample copy classifier');
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

      logger.info({ sessionId: session.id, classifierId: classifier.id }, `Received sample copy classification result from LLM provider: ${textContent}`);
      const classificationResult = sampleCopyClassificationResultSchema.parse(parseJsonFromMarkdown(textContent));

      const endMs = Date.now();
      return {
        ...classificationResult,
        renderedPrompt,
        result: textContent,
        llmUsage: buildLlmUsage(result.usage, classifierData.llmProviderInfo, classifierData.classifier.llmSettings?.model),
        durationMs: endMs - classifyStartMs,
        startMs: classifyStartMs,
        endMs,
      };
    } catch (error) {
      logger.error({ error, sessionId: session.id }, 'Error classifying sample copy for text input');
      const endMs = Date.now();
      return {
        sampleCopy: null,
        renderedPrompt: null,
        result: null,
        durationMs: endMs - classifyStartMs,
        startMs: classifyStartMs,
        endMs,
      };
    }
  }

  private async classifyTextInput(session: Session, classifierData: ClassifierRuntimeData, context: ConversationContext): Promise<ActionClassificationResultWithClassifier & { renderedPrompt: string; llmUsage?: LlmUsageMetadata; durationMs: number; startMs: number; endMs: number }> {
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

      const endMs = Date.now();
      return {
        classifierId: classifier.id,
        classifierName: classifier.name,
        actions,
        renderedPrompt,
        llmUsage: buildLlmUsage(result.usage, classifierData.llmProviderInfo, classifierData.classifier.llmSettings?.model),
        durationMs: endMs - classifyStartMs,
        startMs: classifyStartMs,
        endMs,
      };
    } catch (error) {
      logger.error({ error, sessionId: session.id, classifierId: classifierData.classifier.id }, 'Error classifying text input');
      const endMs = Date.now();
      return {
        classifierId: classifierData.classifier.id,
        classifierName: classifierData.classifier.name,
        actions: [],
        renderedPrompt: null,
        durationMs: endMs - classifyStartMs,
        startMs: classifyStartMs,
        endMs,
      };
    }
  }
}