import type { Session, SessionManager } from '../SessionManager';
import type { IClientConnection } from '../IClientConnection';
import type { CALOutputMessage } from '../messages';
import { logger } from '../../utils/logger';

/** Telegram Bot API base URL. */
const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

/**
 * Telegram-backed implementation of {@link IClientConnection}.
 *
 * Each instance represents a virtual session for a single Telegram user.
 * Outbound messages are sent via the Telegram Bot API `sendMessage` endpoint.
 *
 * Of the full CAL output surface only `end_ai_generation_output` is actionable:
 * the `fullText` of the completed AI turn is sent as a Telegram text message.
 * All other output types (voice, images, events, transcription) are silently dropped
 * because Telegram is a text-only channel in this integration.
 */
export class TelegramConnection implements IClientConnection {
  readonly connectionType = 'telegram' as const;

  private session: Session;

  constructor(
    /** The Telegram user ID (integer), used as the recipient for outbound messages. */
    private readonly userId: number,
    /** Bot token for authenticating Bot API calls. */
    private readonly botToken: string,
    private readonly sessionManager: SessionManager,
  ) {}

  /**
   * Attaches the session record to this connection instance.
   * Must be called immediately after {@link SessionManager.registerSession}.
   * @param session - The session to attach.
   */
  attachSession(session: Session): void {
    this.session = session;
  }

  /**
   * Closes the connection and unregisters the associated session.
   */
  async close(): Promise<void> {
    await this.sessionManager.unregisterSession(this.session.id);
  }

  /**
   * Sends a CAL output message to the Telegram user.
   *
   * Only `end_ai_generation_output` results in an outbound Telegram message.
   * All other message types are silently ignored.
   * @param msg - The CAL output message to transmit.
   */
  async sendMessage(msg: CALOutputMessage): Promise<void> {
    if (msg.type !== 'end_ai_generation_output') return;

    const body = msg.fullText?.trim();
    if (!body) return;

    const url = `${TELEGRAM_API_BASE}${this.botToken}/sendMessage`;
    const payload = {
      chat_id: this.userId,
      text: body,
      parse_mode: 'Markdown',
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Telegram Bot API responded with ${response.status}: ${errorText}`);
      }

      logger.info({ chatId: this.userId, sessionId: this.session?.id }, 'Telegram message sent');
    } catch (error) {
      logger.error({ error, chatId: this.userId, sessionId: this.session?.id }, 'Failed to send Telegram message');
    }
  }
}
