import type { Session, SessionManager } from '../SessionManager';
import type { IClientConnection } from '../IClientConnection';
import type { CALOutputMessage } from '../messages';
import { logger } from '../../utils/logger';

/** Meta Graph API base URL. */
const GRAPH_API_BASE = 'https://graph.facebook.com/v17.0';

/**
 * WhatsApp-backed implementation of {@link IClientConnection}.
 *
 * Each instance represents a virtual session for a single WhatsApp sender.
 * Outbound messages are sent via the Meta WhatsApp Cloud API (Graph API).
 *
 * Of the full CAL output surface only `end_ai_generation_output` is actionable:
 * the `fullText` of the completed AI turn is sent as a WhatsApp text message.
 * All other output types (voice, images, events, transcription) are silently dropped
 * because WhatsApp is a text-only channel in this integration.
 */
export class WhatsAppConnection implements IClientConnection {
  readonly connectionType = 'whatsapp' as const;

  private session: Session;

  constructor(
    /** The sender's WhatsApp number in E.164 format, used as the recipient for outbound messages. */
    private readonly senderNumber: string,
    /** The Meta phone number ID used in the Graph API URL. */
    private readonly phoneNumberId: string,
    /** Bearer access token for the Meta Graph API. */
    private readonly accessToken: string,
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
   * Sends a CAL output message to the WhatsApp user.
   *
   * Only `end_ai_generation_output` results in an outbound WhatsApp message.
   * All other message types are silently ignored.
   * @param msg - The CAL output message to transmit.
   */
  async sendMessage(msg: CALOutputMessage): Promise<void> {
    if (msg.type !== 'end_ai_generation_output') return;

    const body = msg.fullText?.trim();
    if (!body) return;

    const url = `${GRAPH_API_BASE}/${this.phoneNumberId}/messages`;
    const payload = {
      messaging_product: 'whatsapp',
      to: this.senderNumber,
      type: 'text',
      text: { body },
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Graph API responded with ${response.status}: ${errorText}`);
      }

      logger.info({ to: this.senderNumber, sessionId: this.session?.id }, 'WhatsApp message sent');
    } catch (error) {
      logger.error({ error, to: this.senderNumber, sessionId: this.session?.id }, 'Failed to send WhatsApp message');
    }
  }
}
