import type { Session, SessionManager } from '../SessionManager';
import type { IClientConnection } from '../IClientConnection';
import type { CALOutputMessage } from '../messages';
import { logger } from '../../utils/logger';

/**
 * Twilio Messaging-backed implementation of {@link IClientConnection}.
 *
 * Each instance represents a virtual session for a single phone number (or WhatsApp sender)
 * communicating via the Twilio Messaging REST API.
 *
 * Of the full CAL output surface only `end_ai_generation_output` is actionable:
 * the `fullText` of the completed AI turn is sent as an outbound SMS/WhatsApp message.
 * All other output types (voice, images, events, transcription) are silently dropped
 * because Twilio Messaging is a text-only channel.
 */
export class TwilioMessagingConnection implements IClientConnection {
  readonly connectionType = 'twilio_messaging' as const;

  private session: Session;

  constructor(
    /** The originating phone number (E.164), used as the "To" address for outbound messages. */
    private readonly fromNumber: string,
    /** The Twilio phone number (E.164) that receives inbound and sends outbound messages. */
    private readonly toNumber: string,
    private readonly accountSid: string,
    private readonly authToken: string,
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
   * Sends a CAL output message to the user.
   *
   * Only `end_ai_generation_output` results in an outbound Twilio message.
   * All other message types are silently ignored.
   * @param msg - The CAL output message to transmit.
   */
  async sendMessage(msg: CALOutputMessage): Promise<void> {
    if (msg.type !== 'end_ai_generation_output') return;

    const body = msg.fullText?.trim();
    if (!body) return;

    try {
      // Lazy import to avoid loading the Twilio SDK unless this channel is actually used.
      const { Twilio } = await import('twilio');
      const client = new Twilio(this.accountSid, this.authToken);
      await client.messages.create({ body, from: this.toNumber, to: this.fromNumber });
      logger.info({ to: this.fromNumber, sessionId: this.session?.id }, 'Twilio message sent');
    } catch (error) {
      logger.error({ error, to: this.fromNumber, sessionId: this.session?.id }, 'Failed to send Twilio message');
    }
  }
}
