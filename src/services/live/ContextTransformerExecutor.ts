import { inject, singleton } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { conversations, db } from '../../db';
import { parseJsonFromMarkdown } from '../../utils/jsonParser';
import logger from '../../utils/logger';
import { extractTextFromContent } from '../../utils/llm';
import { isActionActive } from '../../utils/actions';
import { TransformationEventData } from '../../types/conversationEvents';
import { Session } from '../../channels/SessionManager';
import { ConversationService } from '../ConversationService';
import { ConversationContextBuilder, ConversationContext } from './ConversationContextBuilder';
import { IsolatedScriptExecutor } from './IsolatedScriptExecutor';
import { TransformerRuntimeData } from './ConversationRunner';
import { TemplatingEngine } from './TemplatingEngine';
import type { ActionClassificationResult } from '../../types/classification';
import { StageAction } from '../../types/actions';

/**
 * Map of variable names to their change event type after a transformer run.
 */
type VariableChangeEvents = Record<string, 'new' | 'changed' | 'removed'>;

/**
 * Internal result of a single context transformer execution.
 * Contains only the fields that were recognized (declared in contextFields) and their parsed values.
 */
type TransformerExecutionResult = {
  transformerId: string;
  transformerName: string;
  /** Stage variable fields successfully written by this transformer */
  appliedFields: string[];
  /** Key-value pairs of the recognized fields and their parsed values */
  parsedValues: Record<string, any>;
  /** The rendered LLM prompt, or null on error */
  renderedPrompt: string | null;
  /** The raw response from the LLM */
  rawResponse: string;
  /** Error message if the transformer failed, undefined otherwise */
  error?: string;
  /** Total duration of the transformer execution in milliseconds, including LLM call */
  durationMs: number;
};

/**
 * Service responsible for executing context transformers during live sessions.
 * Transformers run in parallel and write their results into the stage variables of the current conversation.
 */
@singleton()
export class ContextTransformerExecutor {
  constructor(
    @inject(TemplatingEngine) private readonly templatingEngine: TemplatingEngine,
    @inject(ConversationContextBuilder) private readonly contextBuilder: ConversationContextBuilder,
    @inject(ConversationService) private readonly conversationService: ConversationService,
    @inject(IsolatedScriptExecutor) private readonly scriptExecutor: IsolatedScriptExecutor,
  ) {}

  /**
   * Executes all context transformers for the current stage in parallel.
   * Results are applied sequentially to stage variables after all transformers complete,
   * then flushed to the database in a single update.
   * A `transformation` conversation event is saved and broadcast over WebSocket per transformer.
   * After updating variables, any stage actions with `triggerOnTransformation: true` whose
   * `watchedVariables` conditions are satisfied are returned for upstream processing.
   *
   * @param session - The active connection/session
   * @param userInput - The processed user input text
   * @param originalUserInput - The original user input before any processing
   * @returns Triggered stage actions based on variable changes
   */
  async executeTransformers(session: Session, userInput: string, originalUserInput: string): Promise<ActionClassificationResult[]> {
    const { transformers, stage, conversation, globalActions } = session.runner.getRuntimeData();

    if (transformers.length === 0) {
      return [];
    }

    logger.debug({ sessionId: session.id, conversationId: conversation.id, transformerCount: transformers.length }, 'Executing context transformers');

    // Build a context per transformer and run all in parallel
    const transformerPromises = transformers.map(async (transformerData) => {
      const context = await this.contextBuilder.buildContextForTransformer(
        conversation,
        stage,
        globalActions,
        transformerData.transformer.id,
        transformerData.transformer.contextFields ?? [],
        userInput,
        originalUserInput,
      );
      return this.executeTransformer(session, transformerData, context);
    });

    const results = await Promise.all(transformerPromises);

    // Snapshot variables before applying transformer results
    const prevStageVars = { ...(conversation.stageVars[stage.id] || {}) };

    // Apply results sequentially to stage variables (respects order of transformers)
    const stageVars = { ...prevStageVars };
    for (const result of results) {
      for (const [key, value] of Object.entries(result.parsedValues)) {
        stageVars[key] = value;
      }
    }

    // Update in-memory state and flush all writes to DB in one batch
    conversation.stageVars[stage.id] = stageVars;
    await db.update(conversations)
      .set({ stageVars: conversation.stageVars, updatedAt: new Date() })
      .where(eq(conversations.id, conversation.id));

    logger.debug({ sessionId: session.id, conversationId: conversation.id, updatedFields: Object.keys(stageVars) }, 'Stage variables updated after context transformer execution');

    // Compute variable change events (new / changed / removed)
    const variableChangeEvents = this.computeVariableChangeEvents(prevStageVars, stageVars);

    // Save a transformation event and notify over WebSocket for each transformer
    for (const result of results) {
      const transformerData = transformers.find(t => t.transformer.id === result.transformerId);
      const eventData: TransformationEventData = {
        transformerId: result.transformerId,
        input: userInput || '',
        appliedFields: result.appliedFields,
        metadata: {
          transformerName: result.transformerName,
          systemPrompt: result.renderedPrompt,
          rawResponse: result.rawResponse,
          llmSettings: transformerData?.transformer.llmSettings,
          updatedVariables: stageVars,
          durationMs: result.durationMs,
          ...(result.error ? { error: result.error } : {}),
        },
      };
      await this.conversationService.saveConversationEvent(conversation.projectId, conversation.id, 'transformation', eventData);
      await session.clientConnection.sendMessage({ type: 'conversation_event', conversationId: conversation.id, eventType: 'transformation', eventData });
    }

    // Build a raw context with the updated stage vars for condition evaluation
    const conditionContext = this.contextBuilder.buildRawContext(conversation, stage, {}, {});

    // Find and return stage actions triggered by variable changes
    const triggeredActions = await this.findTriggeredActions(session, variableChangeEvents, stage.actions || {}, conditionContext);
    logger.info({ sessionId: session.id, conversationId: conversation.id, triggeredActions }, 'Context transformer execution completed with variable changes triggering stage actions');
    return triggeredActions;
  }

  /**
   * Computes which variables were created, changed, or removed between two stage variable snapshots.
   *
   * @param prev - Variable map before transformer execution
   * @param next - Variable map after transformer execution
   * @returns Map of variable name to change event type
   */
  private computeVariableChangeEvents(prev: Record<string, any>, next: Record<string, any>): VariableChangeEvents {
    const events: VariableChangeEvents = {};
    const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)]);

    for (const key of allKeys) {
      const prevVal = prev[key];
      const nextVal = next[key];
      const prevExists = prevVal !== undefined && prevVal !== null;
      const nextExists = nextVal !== undefined && nextVal !== null;

      if (!prevExists && nextExists) {
        events[key] = 'new';
      } else if (prevExists && !nextExists) {
        events[key] = 'removed';
      } else if (prevExists && nextExists && JSON.stringify(prevVal) !== JSON.stringify(nextVal)) {
        events[key] = 'changed';
      }
    }

    return events;
  }

  /**
   * Determines which stage actions should be triggered based on variable change events.
   * An action is triggered when `triggerOnTransformation` is true, at least one of its
   * `watchedVariables` entries matches the corresponding change event type, and its
   * optional `condition` expression evaluates to truthy.
   *
   * @param session - The active connection/session (used for logging)
   * @param changeEvents - Map of variable name to change event type
   * @param stageActions - Map of action ID to action definition
   * @param conditionContext - Conversation context used to evaluate action conditions (has updated stage vars)
   * @returns Array of triggered action classification results
   */
  private async findTriggeredActions(session: Session, changeEvents: VariableChangeEvents, stageActions: Record<string, StageAction>, conditionContext: ConversationContext): Promise<ActionClassificationResult[]> {
    logger.info({ changeEvents }, 'Finding triggered actions based on variable change events');
    if (Object.keys(changeEvents).length === 0) {
      return [];
    }

    const triggered: ActionClassificationResult[] = [];

    for (const [actionId, action] of Object.entries(stageActions)) {
      if (!action.triggerOnTransformation) continue;
      if (!action.watchedVariables || Object.keys(action.watchedVariables).length === 0) continue;

      const isTriggered = Object.entries(action.watchedVariables).some(
        ([varName, expectedEvent]) => changeEvents[varName] === expectedEvent || expectedEvent === 'any',
      );

      if (!isTriggered) continue;

      const conditionMet = await isActionActive(action, conditionContext, this.scriptExecutor);
      if (!conditionMet) {
        logger.debug({ sessionId: session.id, actionId }, 'Transformer-triggered action skipped: condition evaluated to false');
        continue;
      }

      logger.debug({ sessionId: session.id, actionId: action.name, changeEvents }, 'Action triggered by context transformer variable change');
      triggered.push({ name: action.name, parameters: {} });
    }

    return triggered;
  }

  /**
   * Executes a single context transformer: renders its prompt, calls the LLM, and parses the response.
   * Only fields declared in `transformer.contextFields` are applied; unrecognized fields are logged and discarded.
   * Never throws — errors are caught and returned as an empty result.
   *
   * @param session - The active connection/session
   * @param transformerData - Runtime data containing the transformer config and its LLM provider
   * @param context - The conversation context built for this transformer
   */
  private async executeTransformer(session: Session, transformerData: TransformerRuntimeData, context: ConversationContext): Promise<TransformerExecutionResult> {
    const { transformer, llmProvider } = transformerData;
    const startMs = Date.now();

    let renderedPrompt: string = null;
    let rawResponse: string = null;

    try {
      logger.debug({ sessionId: session.id, transformerId: transformer.id }, 'Executing context transformer');

      renderedPrompt = await this.templatingEngine.render(transformer.prompt, context);
      const text = context.userInput || '';

      logger.info({ sessionId: session.id, transformerId: transformer.id }, `Rendering prompt for transformer:\n${renderedPrompt}\nWith input:\n${text}`);

      const messages = [
        { role: 'system' as const, content: renderedPrompt },
        { role: 'user' as const, content: text },
      ];

      const result = await llmProvider.generate(messages);
      const textContent = extractTextFromContent(result.content);
      rawResponse = JSON.stringify(result, null, 2);

      logger.info({ sessionId: session.id, transformerId: transformer.id }, `Received transformation result from LLM: ${textContent}`);

      const parsed = parseJsonFromMarkdown(textContent);
      const declaredFields = transformer.contextFields ?? [];
      const appliedFields: string[] = [];
      const parsedValues: Record<string, any> = {};

      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed)) {
          if (declaredFields.includes(key)) {
            parsedValues[key] = value;
            appliedFields.push(key);
          } else {
            logger.warn({ sessionId: session.id, transformerId: transformer.id, field: key }, `Transformer returned unrecognized field "${key}" not listed in contextFields — ignoring`);
          }
        }
      }

      return { transformerId: transformer.id, transformerName: transformer.name, appliedFields, parsedValues, renderedPrompt, rawResponse, durationMs: Date.now() - startMs };
    } catch (error) {
      logger.error({ error, sessionId: session.id, transformerId: transformer.id }, 'Error executing context transformer');
      return { transformerId: transformer.id, transformerName: transformer.name, appliedFields: [], parsedValues: {}, renderedPrompt, rawResponse, error: String(error), durationMs: Date.now() - startMs };
    }
  }
}
