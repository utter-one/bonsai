import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index';
import { providers, apiKeys } from '../../db/schema';
import { SessionManager } from '../SessionManager';
import { ChannelHandlerDispatcher } from '../ChannelHandlerDispatcher';
import { IpRateLimiter } from '../../IpRateLimiter';
import { TwilioMessagingConnection } from './TwilioMessagingConnection';
import { twilioMessagingChannelProviderConfigSchema } from '../../services/providers/channel/TwilioMessagingChannelProvider';
import { sessionSettingsSchema } from '../websocket/contracts/auth';
import { logger } from '../../utils/logger';
import { asyncHandler } from '../../utils/asyncHandler';
import type { CALInputMessage } from '../messages';
import type { ClientMessageHandlerContext } from '../ClientMessageHandlerContext';

/** Default inactivity session timeout in milliseconds (30 minutes). */
const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/** Query param schema for the incoming webhook. */
const webhookQuerySchema = z.object({
  apiKey: z.string().min(1).describe('API key used to authenticate and identify the project'),
  stageId: z.string().min(1).describe('Stage ID to start new conversations at'),
  agentId: z.string().optional().describe('Optional agent ID override'),
  channelProviderId: z.string().min(1).describe('ID of the Twilio Messaging channel provider record'),
});

/** Twilio-posted form body fields we care about. */
type TwilioWebhookBody = {
  From?: string;
  To?: string;
  Body?: string;
};

/**
 * HTTP host for the Twilio Messaging channel.
 *
 * Handles inbound SMS/WhatsApp webhooks from Twilio. Each unique sender phone number
 * gets its own virtual session. Sessions are auto-started (no separate auth step) and
 * expire after a configurable inactivity period.
 *
 * Webhook URL format:
 * `POST /api/twilio/messaging/webhook?apiKey=xxx&stageId=yyy&channelProviderId=zzz[&agentId=aaa]`
 *
 * Configure this URL in the Twilio console for the target phone number / Messaging Service.
 */
@singleton()
export class TwilioMessagingChannelHost {
  /** Maps `${projectId}:${fromNumber}` → sessionId for active virtual sessions. */
  private readonly phoneSessionMap = new Map<string, string>();
  /** Maps sessionId → active inactivity timer handle. */
  private readonly sessionTimeoutMap = new Map<string, NodeJS.Timeout>();

  private readonly timeoutMs = parseInt(process.env.TWILIO_MESSAGING_SESSION_TIMEOUT_MS ?? String(DEFAULT_SESSION_TIMEOUT_MS), 10);

  constructor(
    @inject(SessionManager) private readonly sessionManager: SessionManager,
    @inject(ChannelHandlerDispatcher) private readonly dispatcher: ChannelHandlerDispatcher,
    @inject(IpRateLimiter) private readonly rateLimiter: IpRateLimiter,
  ) {}

  /**
   * Registers the Twilio Messaging webhook route on the Express router.
   * @param router - The Express application or router to attach to.
   */
  registerRoutes(router: Router): void {
    router.post('/api/twilio/messaging/webhook', asyncHandler(this.handleWebhook.bind(this)));
  }

  /**
   * Handles an inbound Twilio Messaging webhook.
   *
   * Flow:
   * 1. Rate-limit check on caller IP.
   * 2. Parse and validate query params (apiKey, stageId, channelProviderId).
   * 3. Validate API key → resolve projectId + keySettings.
   * 4. Load channel provider → parse Twilio credentials.
   * 5. Validate the Twilio request signature.
   * 6. Look up or create a virtual session for the sender phone number.
   * 7. Dispatch `start_conversation` for new sessions, then `send_user_text_input`.
   * 8. Return an empty TwiML response so Twilio does not attempt any further action.
   */
  private async handleWebhook(req: Request, res: Response): Promise<void> {
    const ip = (req.ip ?? req.socket.remoteAddress ?? '');

    if (!this.rateLimiter.tryConsume(ip)) {
      const retryAfter = this.rateLimiter.getRetryAfterSeconds(ip);
      logger.warn({ ip, retryAfter }, 'Twilio webhook rate limit exceeded');
      res.status(429).set('Retry-After', String(retryAfter)).send();
      return;
    }

    // Validate query params
    const queryResult = webhookQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      logger.warn({ issues: queryResult.error.issues }, 'Twilio webhook missing/invalid query params');
      res.status(400).send();
      return;
    }
    const { apiKey: rawApiKey, stageId, agentId, channelProviderId } = queryResult.data;

    // Validate API key
    const apiKeyRecord = await db.query.apiKeys.findFirst({ where: eq(apiKeys.key, rawApiKey) });
    if (!apiKeyRecord || !apiKeyRecord.isActive) {
      logger.warn('Twilio webhook: invalid or inactive API key');
      res.status(401).send();
      return;
    }

    const { projectId, keySettings } = apiKeyRecord;

    // Verify channel permission
    if (keySettings?.allowedChannels && !keySettings.allowedChannels.includes('twilio_messaging')) {
      logger.warn({ projectId }, 'Twilio webhook: API key does not permit twilio_messaging channel');
      res.status(403).send();
      return;
    }

    // Load channel provider
    const providerRecord = await db.query.providers.findFirst({ where: eq(providers.id, channelProviderId) });
    if (!providerRecord || providerRecord.providerType !== 'channel') {
      logger.warn({ channelProviderId }, 'Twilio webhook: channel provider not found or wrong type');
      res.status(400).send();
      return;
    }

    const configResult = twilioMessagingChannelProviderConfigSchema.safeParse(providerRecord.config);
    if (!configResult.success) {
      logger.error({ channelProviderId, issues: configResult.error.issues }, 'Twilio webhook: channel provider config is invalid');
      res.status(500).send();
      return;
    }
    const { accountSid, authToken, fromNumber } = configResult.data;

    // Validate Twilio request signature
    const { validateRequest } = await import('twilio');
    const twilioSignature = req.headers['x-twilio-signature'] as string | undefined;
    const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const isValid = validateRequest(authToken, twilioSignature ?? '', fullUrl, req.body as Record<string, string>);
    if (!isValid) {
      logger.warn({ ip, projectId }, 'Twilio webhook: invalid request signature');
      res.status(403).send();
      return;
    }

    const body = req.body as TwilioWebhookBody;
    const senderNumber = body.From;
    const recipientNumber = body.To ?? fromNumber;
    const messageText = body.Body?.trim() ?? '';

    if (!senderNumber || !messageText) {
      logger.warn({ projectId }, 'Twilio webhook: missing From or Body');
      res.status(400).send();
      return;
    }

    const phoneKey = `${projectId}:${senderNumber}`;
    const existingSessionId = this.phoneSessionMap.get(phoneKey);

    if (existingSessionId) {
      this.scheduleTimeout(existingSessionId, phoneKey);
      await this.dispatchTextInput(existingSessionId, messageText);
    } else {
      const connection = new TwilioMessagingConnection(senderNumber, recipientNumber, accountSid, authToken, this.sessionManager);
      const defaultSettings = sessionSettingsSchema.parse({ sendVoiceInput: false, receiveVoiceOutput: false, receiveTranscriptionUpdates: false, receiveEvents: false });
      const sessionId = this.sessionManager.registerSession(connection);
      const session = this.sessionManager.getSession(sessionId);
      connection.attachSession(session);
      this.sessionManager.setSessionProjectAndSettings(sessionId, projectId, defaultSettings, keySettings ?? null);
      this.phoneSessionMap.set(phoneKey, sessionId);
      this.scheduleTimeout(sessionId, phoneKey);

      logger.info({ sessionId, projectId, from: senderNumber }, 'Twilio Messaging: new virtual session created');

      const startMsg: CALInputMessage = { type: 'start_conversation', userId: senderNumber, stageId, agentId, correlationId: undefined };
      const startContext = this.buildContext(sessionId);
      await this.dispatcher.dispatch(startMsg, startContext);

      await this.dispatchTextInput(sessionId, messageText);
    }

    res.set('Content-Type', 'text/xml').send('<Response/>');
  }

  /**
   * Dispatches a `send_user_text_input` CAL message for the given session.
   * @param sessionId - The target session ID.
   * @param text - The message text to deliver.
   */
  private async dispatchTextInput(sessionId: string, text: string): Promise<void> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session?.conversationId) {
      logger.warn({ sessionId }, 'Twilio Messaging: cannot dispatch text input — no active conversation');
      return;
    }
    const msg: CALInputMessage = { type: 'send_user_text_input', conversationId: session.conversationId, text, correlationId: undefined };
    const context = this.buildContext(sessionId);
    await this.dispatcher.dispatch(msg, context);
  }

  /**
   * Builds a minimal {@link ClientMessageHandlerContext} for a given session.
   * @param sessionId - The session to build context for.
   */
  private buildContext(sessionId: string): ClientMessageHandlerContext {
    const session = this.sessionManager.getSession(sessionId);
    return {
      session,
      send: () => { /* outbound messages flow through TwilioMessagingConnection.sendMessage */ },
      sendError: (error: string) => { logger.warn({ sessionId, error }, 'Twilio Messaging dispatcher error'); },
    };
  }

  /**
   * Schedules (or resets) the inactivity timeout for a session.
   * When the timer fires the session is cleaned up and the phone map entry removed.
   * @param sessionId - The session to schedule the timeout for.
   * @param phoneKey - The phone map key (`${projectId}:${fromNumber}`).
   */
  private scheduleTimeout(sessionId: string, phoneKey: string): void {
    const existing = this.sessionTimeoutMap.get(sessionId);
    if (existing) clearTimeout(existing);

    const handle = setTimeout(async () => {
      logger.info({ sessionId }, 'Twilio Messaging: session timed out due to inactivity');
      this.phoneSessionMap.delete(phoneKey);
      this.sessionTimeoutMap.delete(sessionId);
      await this.sessionManager.unregisterSession(sessionId);
    }, this.timeoutMs);

    handle.unref?.();
    this.sessionTimeoutMap.set(sessionId, handle);
  }
}
