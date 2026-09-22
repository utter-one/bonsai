import { inject, singleton } from "tsyringe";
import { Session, getEffectiveChannelType } from "../../channels/SessionManager";
import { ClassifierRuntimeData } from "./ConversationRunner";
import logger from "../../utils/logger";
import { ConversationContext, ConversationContextBuilder } from "./ConversationContextBuilder";
import { TemplatingEngine } from "./TemplatingEngine";
import { ConversationService } from "../ConversationService";
import { MAX_LIST_LIMIT } from "../../utils/pagination";
import { InvalidOperationError } from "../../errors";
import { KnowledgeService } from "../KnowledgeService";
import { ClassificationEventData, SampleCopySelectionEventData } from "../../types/conversationEvents";
import { parseJsonFromMarkdown } from "../../utils/jsonParser";
import { classificationResultSchema, ActionClassificationResult, ActionClassificationResultWithClassifier, SampleCopyClassificationResult, sampleCopyClassificationResultSchema } from "../../types/classification";
import { extractTextFromContent } from "../../utils/llm";
import { MonitoringContext } from "../monitoring/MonitoringContext";
import type { KnowledgeCategoryResponse } from "../../http/contracts/knowledge";
import { ContextTransformerExecutor } from "./ContextTransformerExecutor";
import { buildLlmUsage, type LlmUsageMetadata } from '../../utils/llmUsage';
import { resolveProviderModelLimits, resolveOutputCap } from '../../utils/costManagement';
import { truncateMessagesToTokenBudget } from '../../utils/contextTruncation';
import type { Guardrail, Stage, GlobalAction } from "../../types/models";

/** A classifier result enriched with the rendered prompt and per-call timing/usage metadata. */
type ClassifierResultWithMeta = ActionClassificationResultWithClassifier & {
  renderedPrompt: string;
  llmUsage?: LlmUsageMetadata;
  durationMs: number;
  startMs: number;
  endMs: number;
};

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
          : (await this.knowledgeService.listKnowledgeCategories(conversation.projectId, { offset: 0, limit: MAX_LIST_LIMIT })).items;
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
          classifierKnowledgeCategories,
          getEffectiveChannelType(session),
        );
        return this.classifyTextInput(session, classifier, classifierContext);
      });

      // Build guardrail classification promise if a guardrail classifier is configured and there are active guardrails
      const guardrailPromise = guardrailClassifier && guardrails.length > 0
        ? (async () => {
          const guardrailContext = await this.contextBuilder.buildContextForGuardrailClassifier(conversation, stage, guardrails, userInput, originalUserInput, getEffectiveChannelType(session));
          const guardrailResult = await this.classifyTextInput(session, guardrailClassifier, guardrailContext);
          return this.bindJevGuardrailAction(guardrailResult, guardrailClassifier, guardrails);
        })()
        : Promise.resolve(null);

      // Build sample copy classification promise if a classifier is configured and there are applicable sample copies for this stage
      const sampleCopyPromise = sampleCopyClassifier && sampleCopies.length > 0
        ? (async () => {
          const sampleCopyContext = await this.contextBuilder.buildContextForSampleCopyClassifier(conversation, stage, sampleCopies, userInput, originalUserInput, getEffectiveChannelType(session));
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

      // Jev (TypeSafe) classifiers emit a fixed "match" sentinel instead of an action name.
      // Bind that sentinel to the stage/global action(s) that reference the classifier via
      // overrideClassifierId; non-TypeSafe results pass through unchanged.
      const boundClassificationResults = this.bindJevStageResults(
        classificationResultsWithClassifiers,
        classifiers,
        stage,
        globalActions,
      );

      // Register classification events for stage classifiers
      for (const result of boundClassificationResults) {
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
            stageName: stage.name,
            durationMs: result.durationMs,
            startMs: result.startMs,
            endMs: result.endMs,
          },
        };
        await this.conversationService.saveConversationEvent(conversation.projectId, conversation.id, 'classification', eventData, stage.id);
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
            stageName: stage.name,
            durationMs: guardrailResult.durationMs,
            startMs: guardrailResult.startMs,
            endMs: guardrailResult.endMs,
          },
        };
        await this.conversationService.saveConversationEvent(conversation.projectId, conversation.id, 'classification', eventData, stage.id);
        await session.clientConnection.sendMessage({ type: 'conversation_event', conversationId: conversation.id, eventType: 'classification', eventData });
      }

      // Register sample copy selection event
      if (sampleCopyResult && sampleCopyClassifier) {
        const eventData: SampleCopySelectionEventData = {
          classifierId: sampleCopyClassifier.classifier.id,
          input: userInput || '',
          sampleCopy: sampleCopyResult.sampleCopy,
          metadata: {
            classifierName: sampleCopyClassifier.classifier.name,
            systemPrompt: sampleCopyResult.renderedPrompt,
            result: sampleCopyResult.result,
            llmUsage: sampleCopyResult.llmUsage,
            currentVariables: conversation?.stageVars[stage.id] || {},
            stageName: stage.name,
            durationMs: sampleCopyResult.durationMs,
            startMs: sampleCopyResult.startMs,
            endMs: sampleCopyResult.endMs,
          },
        };
        await this.conversationService.saveConversationEvent(conversation.projectId, conversation.id, 'sample_copy_selection', eventData, stage.id);
        await session.clientConnection.sendMessage({ type: 'conversation_event', conversationId: conversation.id, eventType: 'sample_copy_selection', eventData });
      }

      const allActions = [
        ...boundClassificationResults.map(x => x.actions).flat(),
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
          logger.warn({ actions: stage.actions, conversationId: conversation.id, actionName: action.name }, `Received action ${action.name} from classifier which does not exist in global actions, guardrails, or stage actions. Ignoring.`);
          return false;
        }

        // Check if we have all required parameters for the action
        if ('parameters' in actionDef) {
          const missingRequiredParams = (actionDef.parameters || []).filter(p => p.required && action.parameters[p.name] == null).map(p => p.name);
          if (missingRequiredParams.length > 0) {
            logger.warn({ conversationId: conversation.id, actionName: action.name, missingParameters: missingRequiredParams }, `Received incomplete action ${action.name} from classifier. Missing required parameters: ${missingRequiredParams.join(', ')}. Ignoring.`);
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
        throw new InvalidOperationError('No sample copy classifier configured for this stage');
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

      const copyModel = classifierData.classifier.llmSettings?.model;
      const copyLimits = resolveProviderModelLimits(session.runner.getRuntimeData().costManagementConfig, classifierData.llmProviderInfo.id, copyModel);
      const copyMaxTokens = resolveOutputCap(classifierData.classifier.llmSettings?.defaultMaxTokens, copyLimits, 'classification');
      const copyInputCap = copyLimits?.inputTokensLimits?.classification;
      const { messages: truncatedCopyMessages, ...copyTruncation } = truncateMessagesToTokenBudget(messages, copyInputCap, copyModel);
      // P1-03: tag the call as llm.classify (nested in the turn context, which supplies attribution)
      const result = await MonitoringContext.run({ operation: 'llm.classify' }, () => llmProvider.generate(truncatedCopyMessages, copyMaxTokens !== undefined ? { maxTokens: copyMaxTokens } : undefined));
      const textContent = extractTextFromContent(result.content);

      logger.info({ sessionId: session.id, classifierId: classifier.id }, `Received sample copy classification result from LLM provider: ${textContent}`);
      const classificationResult = sampleCopyClassificationResultSchema.parse(parseJsonFromMarkdown(textContent));

      const endMs = Date.now();
      return {
        ...classificationResult,
        renderedPrompt,
        result: textContent,
        llmUsage: buildLlmUsage(result.usage, classifierData.llmProviderInfo, classifierData.classifier.llmSettings?.model, copyTruncation),
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

      const classifyModel = classifierData.classifier.llmSettings?.model;
      const classifyLimits = resolveProviderModelLimits(session.runner.getRuntimeData().costManagementConfig, classifierData.llmProviderInfo.id, classifyModel);
      const classifyMaxTokens = resolveOutputCap(classifierData.classifier.llmSettings?.defaultMaxTokens, classifyLimits, 'classification');
      const classifyInputCap = classifyLimits?.inputTokensLimits?.classification;
      const { messages: truncatedClassifyMessages, ...classifyTruncation } = truncateMessagesToTokenBudget(messages, classifyInputCap, classifyModel);
      // P1-03: tag the call as llm.classify (nested in the turn context, which supplies attribution)
      const result = await MonitoringContext.run({ operation: 'llm.classify' }, () => llmProvider.generate(truncatedClassifyMessages, classifyMaxTokens !== undefined ? { maxTokens: classifyMaxTokens } : undefined));
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
        llmUsage: buildLlmUsage(result.usage, classifierData.llmProviderInfo, classifierData.classifier.llmSettings?.model, classifyTruncation),
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
  /**
   * For a Jev (TypeSafe) guardrail classifier, bind the emitted `match` action to the first guardrail's name so the
   * classifier triggers that guardrail when its probability exceeds the threshold. The classifier and the first
   * guardrail form a pair; the classifier does not carry an action name of its own.
   * @param result - the raw classification result from the guardrail classifier
   * @param guardrailClassifier - the guardrail classifier runtime data
   * @param guardrails - all project guardrails
   * @returns the result, with the emitted action name remapped to the first guardrail's name
   */
  private bindJevGuardrailAction(result: ClassifierResultWithMeta, guardrailClassifier: ClassifierRuntimeData, guardrails: Guardrail[]): ClassifierResultWithMeta {
    if (guardrailClassifier.llmProviderInfo.apiType !== 'typesafe') return result;
    if (guardrails.length === 0) return result;
    const targetName = guardrails[0].name;
    logger.info({ classifierId: guardrailClassifier.classifier.id, targetName }, 'Jev guardrail classifier: binding emitted action to the first guardrail');
    return { ...result, actions: result.actions.map((a) => (a.name === 'match' ? { ...a, name: targetName } : a)) };
  }
  /**
   * For a Jev (TypeSafe) stage classifier, bind the emitted `match` action to the name(s) of the stage or global
   * action(s) that reference this classifier via `overrideClassifierId`. A classifier does not own an action name;
   * the action references the classifier, and when the classifier's probability exceeds the threshold, those actions fire.
   * @param result - the raw classification result from the classifier
   * @param classifier - the classifier runtime data
   * @param classifierActionMap - map of classifier ID to the action names that reference it
   * @returns the result, with `match` remapped to the referencing action name(s)
   */
  private bindJevStageAction(result: ClassifierResultWithMeta, classifier: ClassifierRuntimeData, classifierActionMap: Record<string, string[]>): ClassifierResultWithMeta {
    if (classifier.llmProviderInfo.apiType !== 'typesafe') return result;
    const actionNames = classifierActionMap[result.classifierId];
    if (!actionNames || actionNames.length === 0) return result;
    logger.info({ classifierId: result.classifierId, actionNames }, 'Jev stage classifier: binding emitted action to the referencing action(s)');
    return { ...result, actions: result.actions.flatMap((a) => (a.name === 'match' ? actionNames.map((name) => ({ name, parameters: a.parameters })) : [a])) };
  }
  /**
   * Bind the `match` sentinel emitted by Jev (TypeSafe) stage classifiers to the stage/global
   * action(s) that reference the classifier via `overrideClassifierId`. A Jev classifier does not
   * own an action name — the action references the classifier, and when the classifier fires,
   * those actions trigger. Non-TypeSafe results are returned unchanged (by reference).
   *
   * @param results - raw classification results from all stage classifiers
   * @param classifiers - the stage's classifier runtime data
   * @param stage - the current stage (provides its stage actions)
   * @param globalActions - the stage's loaded non-meta global actions
   * @returns the results, with each Jev `match` remapped to the referencing action name(s)
   */
  private bindJevStageResults(
    results: ClassifierResultWithMeta[],
    classifiers: ClassifierRuntimeData[],
    stage: Stage,
    globalActions: GlobalAction[],
  ): ClassifierResultWithMeta[] {
    // Nothing to bind when no Jev classifier is in play — return the input as-is.
    if (!classifiers.some((c) => c.llmProviderInfo.apiType === 'typesafe')) {
      return results;
    }

    const classifierActionMap = this.buildJevClassifierActionMap(stage, globalActions);
    const classifierById = new Map(classifiers.map((c) => [c.classifier.id, c]));

    return results.map((result) => {
      const classifier = classifierById.get(result.classifierId);
      return classifier ? this.bindJevStageAction(result, classifier, classifierActionMap) : result;
    });
  }

  /**
   * Build a map from classifier ID to the names of the stage/global actions that reference it via
   * `overrideClassifierId`. A single classifier can gate multiple actions. Used to resolve where a
   * Jev classifier's `match` sentinel should be bound.
   *
   * @param stage - the current stage (provides its stage actions)
   * @param globalActions - the stage's loaded non-meta global actions
   * @returns classifierId → referencing action names
   */
  private buildJevClassifierActionMap(stage: Stage, globalActions: GlobalAction[]): Record<string, string[]> {
    const map: Record<string, string[]> = {};
    for (const action of Object.values(stage.actions)) {
      if (action.overrideClassifierId) {
        (map[action.overrideClassifierId] ??= []).push(action.name);
      }
    }
    if (stage.useGlobalActions) {
      for (const globalAction of globalActions) {
        if (globalAction.overrideClassifierId) {
          (map[globalAction.overrideClassifierId] ??= []).push(globalAction.name);
        }
      }
    }
    return map;
  }
}
