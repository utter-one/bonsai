import type { IClientConnection } from '../../channels/IClientConnection';
import type { CALOutputMessage } from '../../channels/messages';
import type { ApiKeyChannel } from '../../apiKeyFeatures';
import { ConversationTerminatedError } from '../../errors';

type PendingResolver = {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
};

/** Terminal conversation event types that signal the conversation can no longer produce AI responses. */
const TERMINAL_EVENT_TYPES = new Set(['conversation_end', 'conversation_aborted', 'conversation_failed']);

/**
 * Synthetic IClientConnection used during automated test execution.
 * Captures AI responses from end_ai_generation_output messages and surfaces them
 * to the TestRunner via waitForAiResponse(). Rejects waiting callers when a terminal
 * conversation event is received.
 */
export class TesterClientConnection implements IClientConnection {
  readonly connectionType: ApiKeyChannel = 'testing';

  private bufferedAiText: string | null = null;
  private terminalEventType: string | null = null;
  private pendingResolver: PendingResolver | null = null;

  /**
   * Receives CAL output messages from ConversationRunner.
   * Handles end_ai_generation_output and terminal conversation_event messages.
   * @param message - Outbound CAL message emitted by the conversation engine
   */
  async sendMessage(message: CALOutputMessage): Promise<void> {
    if (message.type === 'end_ai_generation_output') {
      const text = message.fullText;
      if (this.pendingResolver) {
        const resolver = this.pendingResolver;
        this.pendingResolver = null;
        resolver.resolve(text);
      } else {
        this.bufferedAiText = text;
      }
      return;
    }

    if (message.type === 'conversation_event' && TERMINAL_EVENT_TYPES.has(message.eventType)) {
      this.terminalEventType = message.eventType;
      if (this.pendingResolver) {
        const resolver = this.pendingResolver;
        this.pendingResolver = null;
        resolver.reject(new ConversationTerminatedError(message.eventType));
      }
    }
  }

  /**
   * Waits for the next complete AI response text.
   * Returns immediately if a response is already buffered.
   * Rejects immediately if the conversation has already terminated.
   * @returns The full AI response text from the most recent end_ai_generation_output message
   * @throws {ConversationTerminatedError} When a terminal conversation event was received
   */
  waitForAiResponse(): Promise<string> {
    if (this.terminalEventType !== null) {
      return Promise.reject(new ConversationTerminatedError(this.terminalEventType));
    }

    if (this.bufferedAiText !== null) {
      const text = this.bufferedAiText;
      this.bufferedAiText = null;
      return Promise.resolve(text);
    }

    return new Promise<string>((resolve, reject) => {
      this.pendingResolver = { resolve, reject };
    });
  }

  /**
   * Returns true if an AI response is already buffered and ready to be consumed by waitForAiResponse().
   */
  hasPendingResponse(): boolean {
    return this.bufferedAiText !== null;
  }

  /**
   * Returns the terminal event type if the conversation has ended, or null if still active.
   */
  getTerminalEventType(): string | null {
    return this.terminalEventType;
  }

  /** No-op — testing connections have no underlying transport to close. */
  async close(): Promise<void> {}
}
