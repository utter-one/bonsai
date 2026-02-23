import { eq } from 'drizzle-orm';
import { inject, singleton } from 'tsyringe';
import { conversations, db } from '../../db';
import { parseJsonFromMarkdown } from '../../utils/jsonParser';
import logger from '../../utils/logger';
import { extractTextFromContent } from '../../utils/llm';
import { TransformationEventData } from '../../types/conversationEvents';
import { Connection, ConnectionManager } from '../../websocket/ConnectionManager';
import { ConversationService } from '../ConversationService';
import { ConversationContextBuilder, ConversationContext } from './ConversationContextBuilder';
import { TransformerRuntimeData } from './ConversationRunner';
import { TemplatingEngine } from './TemplatingEngine';

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
  /** Error message if the transformer failed, undefined otherwise */
  error?: string;
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
    @inject(ConnectionManager) private readonly connectionManager: ConnectionManager,
  ) {}

  /**
   * Executes all context transformers for the current stage in parallel.
   * Results are applied sequentially to stage variables after all transformers complete,
   * then flushed to the database in a single update.
   * A `transformation` conversation event is saved and broadcast over WebSocket per transformer.
   *
   * @param session - The active connection/session
   * @param userInput - The processed user input text
   * @param originalUserInput - The original user input before any processing
   */
  async executeTransformers(session: Connection, userInput: string, originalUserInput: string): Promise<void> {
    const { transformers, stage, conversation, globalActions } = session.runner.getRuntimeData();

    if (transformers.length === 0) {
      return;
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

    // Apply results sequentially to stage variables (respects order of transformers)
    const stageVars = { ...(conversation.stageVars[stage.id] || {}) };
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
          llmSettings: transformerData?.transformer.llmSettings,
          updatedVariables: stageVars,
          ...(result.error ? { error: result.error } : {}),
        },
      };
      await this.conversationService.saveConversationEvent(conversation.id, 'transformation', eventData);
      this.connectionManager.sendConversationEvent(conversation.id, 'transformation', eventData);
    }
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
  private async executeTransformer(session: Connection, transformerData: TransformerRuntimeData, context: ConversationContext): Promise<TransformerExecutionResult> {
    const { transformer, llmProvider } = transformerData;

    try {
      logger.debug({ sessionId: session.id, transformerId: transformer.id }, 'Executing context transformer');

      const renderedPrompt = await this.templatingEngine.render(transformer.prompt, context);
      const text = context.userInput || '';

      logger.info({ sessionId: session.id, transformerId: transformer.id }, `Rendering prompt for transformer:\n${renderedPrompt}\nWith input:\n${text}`);

      const messages = [
        { role: 'system' as const, content: renderedPrompt },
        { role: 'user' as const, content: text },
      ];

      const result = await llmProvider.generate(messages);
      const textContent = extractTextFromContent(result.content);

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

      return { transformerId: transformer.id, transformerName: transformer.name, appliedFields, parsedValues, renderedPrompt };
    } catch (error) {
      logger.error({ error, sessionId: session.id, transformerId: transformer.id }, 'Error executing context transformer');
      return { transformerId: transformer.id, transformerName: transformer.name, appliedFields: [], parsedValues: {}, renderedPrompt: null, error: String(error) };
    }
  }
}
