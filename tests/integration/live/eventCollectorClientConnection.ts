import type { IClientConnection } from '../../../src/channels/IClientConnection';
import type { CALOutputMessage, CALConversationEventMessage, CALEndAiGenerationOutputMessage, CALStartAiGenerationOutputMessage, CALSendAiVoiceChunkMessage } from '../../../src/channels/messages';
import type { ApiKeyChannel } from '../../../src/apiKeyFeatures';

/** Terminal conversation event types that signal the conversation can no longer produce AI responses. */
const TERMINAL_EVENT_TYPES = new Set(['conversation_end', 'conversation_aborted', 'conversation_failed']);

/**
 * Full-featured IClientConnection for integration tests.
 * Captures ALL CALOutputMessage types for assertions.
 *
 * Usage:
 *   const collector = new EventCollectorClientConnection();
 *   // After conversation runs:
 *   expect(collector.aiResponses).to.include('Hello!');
 *   expect(collector.conversationEvents).to.include.satisfy(e => e.eventType === 'conversation_start');
 *   expect(collector.terminalEvent).to.equal('conversation_end');
 */
export class EventCollectorClientConnection implements IClientConnection {
  readonly connectionType: ApiKeyChannel = 'testing';

  /** All CAL output messages in order. */
  public messages: CALOutputMessage[] = [];

  /**
   * AI response texts from end_ai_generation_output messages.
   */
  get aiResponses(): string[] {
    return this.messages
      .filter((m): m is CALEndAiGenerationOutputMessage => m.type === 'end_ai_generation_output')
      .map(m => m.fullText);
  }

  /**
   * Conversation event messages (classification, execution_plan, jump_to_stage, etc.)
   */
  get conversationEvents(): CALConversationEventMessage[] {
    return this.messages.filter((m): m is CALConversationEventMessage => m.type === 'conversation_event');
  }

  /**
   * Start AI generation output messages.
   */
  get startAiGenerationOutputs(): CALStartAiGenerationOutputMessage[] {
    return this.messages.filter((m): m is CALStartAiGenerationOutputMessage => m.type === 'start_ai_generation_output');
  }

  /**
   * AI voice chunk messages (for TTS testing).
   */
  get aiVoiceChunks(): CALSendAiVoiceChunkMessage[] {
    return this.messages.filter((m): m is CALSendAiVoiceChunkMessage => m.type === 'send_ai_voice_chunk');
  }

  /**
   * Terminal event type if the conversation has ended, or null if still active.
   */
  get terminalEvent(): string | null {
    const terminal = this.conversationEvents.find(e => TERMINAL_EVENT_TYPES.has(e.eventType));
    return terminal ? terminal.eventType : null;
  }

  /**
   * Get all conversation events of a specific type.
   */
  getEventsByType(eventType: string): CALConversationEventMessage[] {
    return this.conversationEvents.filter(e => e.eventType === eventType);
  }

  /**
   * Get the latest conversation event of a specific type, or undefined.
   */
  getLatestEventByType(eventType: string): CALConversationEventMessage | undefined {
    const events = this.getEventsByType(eventType);
    return events.length > 0 ? events[events.length - 1] : undefined;
  }

  async sendMessage(message: CALOutputMessage): Promise<void> {
    this.messages.push(message);
  }

  async close(): Promise<void> {
    // No-op
  }

  /** Reset all captured messages. */
  reset(): void {
    this.messages = [];
  }
}
