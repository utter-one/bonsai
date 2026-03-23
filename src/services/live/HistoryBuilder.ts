import { injectable, inject } from 'tsyringe';
import { logger } from '../../utils/logger';
import { IsolatedScriptExecutor } from './IsolatedScriptExecutor';
import type { ConversationContext } from './ConversationContextBuilder';
import type { MessageEventData, MessageVisibility } from '../../types/conversationEvents';
import type { ScriptEvent } from './ConversationContextBuilder';

/**
 * A single entry in the conversation history passed to the LLM.
 */
export type HistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
};

/**
 * Service responsible for building the filtered conversation history array used in LLM prompts.
 * Evaluates message visibility settings (always, stage, never, conditional) and excludes messages
 * that should not be visible to the LLM given the current conversation state.
 */
@injectable()
export class HistoryBuilder {
  constructor(@inject(IsolatedScriptExecutor) private readonly scriptExecutor: IsolatedScriptExecutor) {}

  /**
   * Builds the conversation history from a list of all raw events, applying visibility rules.
   *
   * Events are sorted by timestamp first, then a single O(n) pass tracks the current stage ID
   * as `conversation_start` and `jump_to_stage` events are encountered, so `stage` visibility
   * can be evaluated without a nested scan per message.
   *
   * Visibility rules (evaluated per message event):
   * - No visibility field or `always`: always included.
   * - `never`: always excluded.
   * - `stage`: included only if the message was recorded in the current stage.
   * - `conditional`: the `condition` expression is evaluated in an isolated script VM against
   *   the current context; the message is included only if the expression returns truthy.
   *
   * @param allEvents - All conversation events (order not assumed; sorted internally).
   * @param context - Current conversation context used for condition evaluation.
   * @returns Filtered array of history messages for LLM consumption.
   */
  async buildHistory(allEvents: ScriptEvent[], context: ConversationContext): Promise<HistoryMessage[]> {
    const sorted = [...allEvents].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    const history: HistoryMessage[] = [];
    let currentStageId: string | undefined;

    for (const event of sorted) {
      if (event.eventType === 'conversation_start') {
        const data = event.eventData as { stageId?: string };
        if (data.stageId) currentStageId = data.stageId;
        continue;
      }

      if (event.eventType === 'jump_to_stage') {
        const data = event.eventData as { toStageId?: string };
        if (data.toStageId) currentStageId = data.toStageId;
        continue;
      }

      if (event.eventType !== 'message') continue;

      const eventData = event.eventData as MessageEventData;
      const isVisible = await this.isMessageVisible(event, eventData, currentStageId, context);
      if (isVisible) {
        history.push({ role: eventData.role, content: eventData.text });
      }
    }

    return history;
  }

  /**
   * Determines whether a single message event should appear in conversation history.
   *
   * @param event - The script event wrapper.
   * @param eventData - Typed message event data.
   * @param messageStageId - Stage ID that was active when this message was recorded.
   * @param context - Current conversation context.
   */
  private async isMessageVisible(event: ScriptEvent, eventData: MessageEventData, messageStageId: string | undefined, context: ConversationContext): Promise<boolean> {
    const visibility: MessageVisibility | undefined = eventData.visibility;

    if (!visibility || visibility.visibility === 'always') {
      return true;
    }

    if (visibility.visibility === 'never') {
      return false;
    }

    if (visibility.visibility === 'stage') {
      return messageStageId === context.stage?.id;
    }

    if (visibility.visibility === 'conditional') {
      if (!visibility.condition) {
        logger.warn({ conversationId: context.conversationId, eventId: event.id }, 'Message visibility is "conditional" but no condition is set; defaulting to visible');
        return true;
      }

      try {
        const result = await this.scriptExecutor.executeScript(visibility.condition, context);
        return !!result.value;
      } catch (error) {
        logger.error({ conversationId: context.conversationId, eventId: event.id, error: error instanceof Error ? error.message : String(error) }, 'Failed to evaluate message visibility condition; defaulting to visible');
        return true;
      }
    }

    return true;
  }
}
