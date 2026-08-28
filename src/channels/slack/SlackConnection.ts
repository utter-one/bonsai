import type { Session, SessionManager } from '../SessionManager';
import type { IClientConnection } from '../IClientConnection';
import type { CALOutputMessage } from '../messages';
import { logger } from '../../utils/logger';

/** Slack Web API base URL. */
const SLACK_API_BASE = 'https://slack.com/api/';

/**
 * Slack-backed implementation of {@link IClientConnection}.
 *
 * Each instance represents a virtual session for a single Slack conversation.
 * Outbound messages are sent via the Slack Web API `chat.postMessage` endpoint,
 * threaded under the message that initiated the conversation.
 *
 * Of the full CAL output surface only `end_ai_generation_output` is actionable:
 * the `fullText` of the completed AI turn is posted as a Slack reply.
 * All other output types (voice, images, events, transcription) are silently dropped
 * because Slack is a text-only channel in this integration.
 */
export class SlackConnection implements IClientConnection {
  readonly connectionType = 'slack' as const;

  private session: Session;

  constructor(
    /** The Slack user ID (U...) of the conversation participant whose replies we target. */
    private readonly slackUserId: string,
    /** The Slack conversation ID (D... for DMs, C... for channels) to post into. */
    private readonly channelId: string,
    /** The `ts` of the triggering message. When set, replies are threaded under it. Null for un-threaded posts. */
    private readonly threadTs: string | null,
    /** Bot token (xoxb-) for authenticating Web API calls. */
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
   * Sends a CAL output message to the Slack conversation.
   *
   * Only `end_ai_generation_output` results in an outbound Slack message.
   * All other message types are silently ignored.
   * @param msg - The CAL output message to transmit.
   */
  async sendMessage(msg: CALOutputMessage): Promise<void> {
    if (msg.type !== 'end_ai_generation_output') return;

    const body = msg.fullText?.trim();
    if (!body) return;

    await this.postToSlack(body);
  }

  /**
   * Sends an informational message to the user (e.g. when a conversation cannot
   * be started). Posted like a normal reply: into the channel, threaded under
   * the triggering message when a thread is set.
   * @param text - The message text to post.
   */
  async sendError(text: string): Promise<void> {
    const body = text.trim();
    if (!body) return;
    await this.postToSlack(body);
  }

  /**
   * Posts text to the Slack channel via the Web API `chat.postMessage` endpoint,
   * threaded under {@link threadTs} when set. Logs (rather than throws) on
   * failure so a single failed post cannot break the caller.
   * @param text - The message text to post.
   */
  private async postToSlack(text: string): Promise<void> {
    const payload: Record<string, unknown> = {
      channel: this.channelId,
      text,
    };
    if (this.threadTs) {
      payload.thread_ts = this.threadTs;
    }

    try {
      const response = await fetch(`${SLACK_API_BASE}chat.postMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.botToken}`,
        },
        body: JSON.stringify(payload),
      });

      const data: { ok?: boolean; error?: string } = await response.json().catch(() => ({}));

      if (!response.ok || data.ok === false) {
        throw new Error(`Slack Web API responded with ${response.status}: ${data.error ?? response.statusText}`);
      }

      logger.info({ channelId: this.channelId, slackUserId: this.slackUserId, sessionId: this.session?.id }, 'Slack message sent');
    } catch (error) {
      logger.error({ error, channelId: this.channelId, slackUserId: this.slackUserId, sessionId: this.session?.id }, 'Failed to send Slack message');
    }
  }
}
