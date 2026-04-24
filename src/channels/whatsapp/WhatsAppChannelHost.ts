import { createHmac, timingSafeEqual } from 'crypto';
import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index';
import { providers, apiKeys } from '../../db/schema';
import { SessionManager } from '../SessionManager';
import { isFeatureAllowed } from '../SessionManager';
import { ChannelHandlerDispatcher } from '../ChannelHandlerDispatcher';
import { IpRateLimiter } from '../../IpRateLimiter';
import { WhatsAppConnection } from './WhatsAppConnection';
import { whatsAppChannelProviderConfigSchema } from '../../services/providers/channel/WhatsAppChannelProvider';
import { sessionSettingsSchema } from '../websocket/contracts/auth';
import { logger } from '../../utils/logger';
import { asyncHandler } from '../../utils/asyncHandler';
import type { CALInputMessage } from '../messages';
import type { ClientMessageHandlerContext } from '../ClientMessageHandlerContext';

/** Default inactivity session timeout in milliseconds (30 minutes). */
const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/** Query param schema shared by both GET (verification) and POST (webhook) endpoints. */
const webhookQuerySchema = z.object({
  apiKey: z.string().min(1).describe('API key used to authenticate and identify the project'),
  stageId: z.string().min(1).optional().describe('Stage ID to start new conversations at. When omitted, falls back to the project-level default starting stage.'),
  agentId: z.string().optional().describe('Optional agent ID override'),
  channelProviderId: z.string().min(1).describe('ID of the WhatsApp channel provider record'),
});

/** Meta webhook verification query params (GET request). */
const verifyQuerySchema = z.object({
  'hub.mode': z.literal('subscribe'),
  'hub.verify_token': z.string().min(1),
  'hub.challenge': z.string().min(1),
});

/** Shape of a Meta WhatsApp Cloud API incoming text message. */
type WhatsAppIncomingMessage = {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
};

/** Top-level shape of the Meta webhook POST payload. */
type WhatsAppWebhookBody = {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: WhatsAppIncomingMessage[];
        metadata?: { phone_number_id?: string };
      };
    }>;
  }>;
};

/** Discriminated result of slash-command parsing. */
type SlashCommandResult =
  | { action: 'text' }
  | { action: 'reset' }
  | { action: 'go_to_stage'; stageId: string };

/**
 * HTTP host for the WhatsApp channel via the Meta WhatsApp Cloud API.
 *
 * Handles incoming webhooks from Meta, maintaining a virtual session per sender phone number
 * with an inactivity timeout. Supports a slash-command interface for control operations:
 * - `/reset` — ends the current conversation and immediately starts a fresh one
 * - `/stage <stageId>` — navigates to a specific stage (requires `stage_control` feature)
 * - Any other `/xxx` message — treated as regular text input
 *
 * Webhook URL format:
 * `GET/POST /api/whatsapp/webhook?apiKey=xxx&stageId=yyy&channelProviderId=zzz[&agentId=aaa]`
 *
 * Configure this URL in the Meta App Dashboard under WhatsApp > Configuration > Webhook.
 */
@singleton()
export class WhatsAppChannelHost {
  /** Maps `${projectId}:${senderNumber}` → sessionId for active virtual sessions. */
  private readonly phoneSessionMap = new Map<string, string>();
  /** Maps sessionId → active inactivity timer handle. */
  private readonly sessionTimeoutMap = new Map<string, NodeJS.Timeout>();

  private readonly timeoutMs = parseInt(process.env.WHATSAPP_SESSION_TIMEOUT_MS ?? String(DEFAULT_SESSION_TIMEOUT_MS), 10);

  constructor(
    @inject(SessionManager) private readonly sessionManager: SessionManager,
    @inject(ChannelHandlerDispatcher) private readonly dispatcher: ChannelHandlerDispatcher,
    @inject(IpRateLimiter) private readonly rateLimiter: IpRateLimiter,
  ) {}

  /**
   * Registers the WhatsApp webhook routes on the Express router.
   * GET is used for the one-time Meta webhook challenge/verification.
   * POST handles all inbound messages.
   * @param router - The Express application or router to attach to.
   */
  registerRoutes(router: Router): void {
    router.get('/api/whatsapp/webhook', asyncHandler(this.handleVerification.bind(this)));
    router.post('/api/whatsapp/webhook', asyncHandler(this.handleWebhook.bind(this)));
  }

  /**
   * Handles the one-time Meta webhook verification challenge (GET).
   *
   * Meta sends a GET request with hub.mode, hub.verify_token, and hub.challenge
   * when the webhook URL is first configured in the Meta App Dashboard.
   * We validate the verify_token against the stored channel provider config and
   * echo back hub.challenge to confirm ownership.
   */
  private async handleVerification(req: Request, res: Response): Promise<void> {
    const queryResult = verifyQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(403).send();
      return;
    }

    const webhookQuery = webhookQuerySchema.safeParse(req.query);
    if (!webhookQuery.success) {
      res.status(400).send();
      return;
    }

    const { channelProviderId } = webhookQuery.data;
    const providerRecord = await db.query.providers.findFirst({ where: eq(providers.id, channelProviderId) });
    if (!providerRecord || providerRecord.providerType !== 'channel') {
      res.status(400).send();
      return;
    }

    const configResult = whatsAppChannelProviderConfigSchema.safeParse(providerRecord.config);
    if (!configResult.success) {
      logger.error({ channelProviderId, issues: configResult.error.issues }, 'WhatsApp webhook verification: channel provider config is invalid');
      res.status(500).send();
      return;
    }

    if (queryResult.data['hub.verify_token'] !== configResult.data.verifyToken) {
      logger.warn({ channelProviderId }, 'WhatsApp webhook verification: verify_token mismatch');
      res.status(403).send();
      return;
    }

    logger.info({ channelProviderId }, 'WhatsApp webhook verified successfully');
    res.status(200).send(queryResult.data['hub.challenge']);
  }

  /**
   * Handles an inbound Meta WhatsApp webhook (POST).
   *
   * Flow:
   * 1. Rate-limit check on caller IP.
   * 2. Parse and validate query params (apiKey, stageId, channelProviderId).
   * 3. Validate API key → resolve projectId + keySettings.
   * 4. Load channel provider → parse credentials.
   * 5. Validate X-Hub-Signature-256 header using HMAC-SHA256 of the raw body.
   * 6. Extract first text message from the Meta payload; ACK silently if none.
   * 7. Parse slash commands from message text.
   * 8. Look up or create a virtual session for the sender.
   * 9. Dispatch appropriate CAL messages based on command type.
   * 10. Return HTTP 200 immediately (Meta requires a response within 20 s).
   */
  private async handleWebhook(req: Request, res: Response): Promise<void> {
    // Meta requires an immediate 200 — send it before heavy processing
    res.status(200).json({});

    const ip = req.ip ?? req.socket.remoteAddress ?? '';

    if (!this.rateLimiter.tryConsume(ip)) {
      logger.warn({ ip }, 'WhatsApp webhook rate limit exceeded');
      return;
    }

    const queryResult = webhookQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      logger.warn({ issues: queryResult.error.issues }, 'WhatsApp webhook missing/invalid query params');
      return;
    }
    const { apiKey: rawApiKey, stageId, agentId, channelProviderId } = queryResult.data;

    const apiKeyRecord = await db.query.apiKeys.findFirst({ where: eq(apiKeys.key, rawApiKey) });
    if (!apiKeyRecord || !apiKeyRecord.isActive) {
      logger.warn('WhatsApp webhook: invalid or inactive API key');
      return;
    }

    const { projectId, keySettings } = apiKeyRecord;

    if (keySettings?.allowedChannels && !keySettings.allowedChannels.includes('whatsapp')) {
      logger.warn({ projectId }, 'WhatsApp webhook: API key does not permit whatsapp channel');
      return;
    }

    const providerRecord = await db.query.providers.findFirst({ where: eq(providers.id, channelProviderId) });
    if (!providerRecord || providerRecord.providerType !== 'channel') {
      logger.warn({ channelProviderId }, 'WhatsApp webhook: channel provider not found or wrong type');
      return;
    }

    const configResult = whatsAppChannelProviderConfigSchema.safeParse(providerRecord.config);
    if (!configResult.success) {
      logger.error({ channelProviderId, issues: configResult.error.issues }, 'WhatsApp webhook: channel provider config is invalid');
      return;
    }
    const { phoneNumberId, accessToken, appSecret } = configResult.data;

    // Validate X-Hub-Signature-256
    const rawBody: Buffer | undefined = (req as any).rawBody;
    if (!rawBody) {
      logger.error({ projectId }, 'WhatsApp webhook: raw body not available for signature validation');
      return;
    }

    const hubSignature = req.headers['x-hub-signature-256'] as string | undefined;
    if (!this.isValidSignature(appSecret, rawBody, hubSignature)) {
      logger.warn({ ip, projectId }, 'WhatsApp webhook: invalid X-Hub-Signature-256');
      return;
    }

    // Extract the first text message from the Meta payload
    const payload = req.body as WhatsAppWebhookBody;
    const value = payload?.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];

    if (!message) {
      // Status updates, delivery receipts, etc. — acknowledge silently
      return;
    }

    if (message.type !== 'text' || !message.text?.body) {
      logger.debug({ projectId, messageType: message.type }, 'WhatsApp webhook: unsupported message type, ignoring');
      return;
    }

    const senderNumber = message.from;
    const messageText = message.text.body.trim();

    if (!senderNumber || !messageText) {
      logger.warn({ projectId }, 'WhatsApp webhook: missing sender or text body');
      return;
    }

    const cmd = this.parseSlashCommand(messageText);
    const phoneKey = `${projectId}:${senderNumber}`;
    let existingSessionId = this.phoneSessionMap.get(phoneKey);

    // Handle /reset: tear down existing session so a fresh one is created below
    if (cmd.action === 'reset' && existingSessionId) {
      if (keySettings?.allowedFeatures && !keySettings.allowedFeatures.includes('conversation_control')) {
        logger.warn({ projectId }, 'WhatsApp /reset command: conversation_control feature not permitted by API key');
        return;
      }
      await this.terminateSession(existingSessionId, phoneKey);
      existingSessionId = undefined;
    }

    if (existingSessionId) {
      this.scheduleTimeout(existingSessionId, phoneKey);
      await this.dispatchCommand(existingSessionId, cmd, messageText);
    } else {
      const connection = new WhatsAppConnection(senderNumber, phoneNumberId, accessToken, this.sessionManager);
      const defaultSettings = sessionSettingsSchema.parse({ sendVoiceInput: false, receiveVoiceOutput: false, receiveTranscriptionUpdates: false, receiveEvents: false });
      const sessionId = this.sessionManager.registerSession(connection);
      const session = this.sessionManager.getSession(sessionId);
      connection.attachSession(session);
      this.sessionManager.setSessionProjectAndSettings(sessionId, projectId, defaultSettings, keySettings ?? null);
      this.phoneSessionMap.set(phoneKey, sessionId);
      this.scheduleTimeout(sessionId, phoneKey);

      logger.info({ sessionId, projectId, from: senderNumber }, 'WhatsApp: new virtual session created');

      const startMsg: CALInputMessage = { type: 'start_conversation', userId: senderNumber, stageId, agentId, correlationId: undefined };
      await this.dispatcher.dispatch(startMsg, this.buildContext(sessionId));

      // After reset we only start the conversation; don't re-send the /reset text as input
      if (cmd.action !== 'reset') {
        await this.dispatchCommand(sessionId, cmd, messageText);
      }
    }
  }

  /**
   * Dispatches the appropriate CAL message for a parsed slash command or plain text.
   * Feature permissions are checked against the session's API key settings before dispatching;
   * disallowed commands are silently ignored.
   * @param sessionId - The target session.
   * @param cmd - The parsed command result.
   * @param rawText - Original message text (used for plain text fall-through).
   */
  private async dispatchCommand(sessionId: string, cmd: SlashCommandResult, rawText: string): Promise<void> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session?.conversationId) {
      logger.warn({ sessionId }, 'WhatsApp: cannot dispatch message — no active conversation');
      return;
    }

    if (cmd.action === 'go_to_stage') {
      if (!isFeatureAllowed(session, 'stage_control')) {
        logger.warn({ sessionId }, 'WhatsApp /stage command: stage_control feature not permitted by API key');
        return;
      }
      const msg: CALInputMessage = { type: 'go_to_stage', stageId: cmd.stageId, conversationId: session.conversationId, correlationId: undefined };
      await this.dispatcher.dispatch(msg, this.buildContext(sessionId));
      return;
    }

    // Default: plain text input (including unknown slash commands which fall through)
    if (!isFeatureAllowed(session, 'text_input')) {
      logger.warn({ sessionId }, 'WhatsApp text input: text_input feature not permitted by API key');
      return;
    }
    const msg: CALInputMessage = { type: 'send_user_text_input', conversationId: session.conversationId, text: rawText, correlationId: undefined };
    await this.dispatcher.dispatch(msg, this.buildContext(sessionId));
  }

  /**
   * Parses the message text for slash commands.
   * - `/reset` → reset action
   * - `/stage <stageId>` → go_to_stage action
   * - Everything else (including unknown `/xxx`) → text fall-through
   * @param text - The trimmed message text.
   */
  private parseSlashCommand(text: string): SlashCommandResult {
    if (!text.startsWith('/')) return { action: 'text' };

    const parts = text.split(/\s+/);
    const cmd = parts[0].toLowerCase();

    if (cmd === '/reset') return { action: 'reset' };
    if (cmd === '/stage' && parts[1]) return { action: 'go_to_stage', stageId: parts[1] };

    // Unknown slash command — fall through as regular text so the AI handles it
    return { action: 'text' };
  }

  /**
   * Validates the X-Hub-Signature-256 header against the raw request body
   * using HMAC-SHA256 with the app secret.
   * @param appSecret - The Meta app secret.
   * @param rawBody - The raw request body buffer.
   * @param signature - The value of the X-Hub-Signature-256 header.
   */
  private isValidSignature(appSecret: string, rawBody: Buffer, signature: string | undefined): boolean {
    if (!signature) return false;

    const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
    try {
      return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
      return false;
    }
  }

  /**
   * Terminates an existing session: dispatches end_conversation if one is active,
   * cleans up timers, removes the phone map entry, and unregisters the session.
   * @param sessionId - The session to terminate.
   * @param phoneKey - The phone map key to remove.
   */
  private async terminateSession(sessionId: string, phoneKey: string): Promise<void> {
    const existing = this.sessionTimeoutMap.get(sessionId);
    if (existing) clearTimeout(existing);
    this.sessionTimeoutMap.delete(sessionId);
    this.phoneSessionMap.delete(phoneKey);

    const session = this.sessionManager.getSession(sessionId);
    if (session?.conversationId) {
      const endMsg: CALInputMessage = { type: 'end_conversation', conversationId: session.conversationId, correlationId: undefined };
      const context = this.buildContext(sessionId);
      try {
        await this.dispatcher.dispatch(endMsg, context);
      } catch (error) {
        logger.warn({ error, sessionId }, 'WhatsApp /reset: error dispatching end_conversation, continuing with session teardown');
      }
    }

    await this.sessionManager.unregisterSession(sessionId);
    logger.info({ sessionId }, 'WhatsApp: session terminated by /reset command');
  }

  /**
   * Schedules (or resets) the inactivity timeout for a session.
   * When the timer fires the session is cleaned up and the phone map entry removed.
   * @param sessionId - The session to schedule the timeout for.
   * @param phoneKey - The phone map key (`${projectId}:${senderNumber}`).
   */
  private scheduleTimeout(sessionId: string, phoneKey: string): void {
    const existing = this.sessionTimeoutMap.get(sessionId);
    if (existing) clearTimeout(existing);

    const handle = setTimeout(async () => {
      logger.info({ sessionId }, 'WhatsApp: session timed out due to inactivity');
      this.phoneSessionMap.delete(phoneKey);
      this.sessionTimeoutMap.delete(sessionId);
      await this.sessionManager.unregisterSession(sessionId);
    }, this.timeoutMs);

    handle.unref?.();
    this.sessionTimeoutMap.set(sessionId, handle);
  }

  /**
   * Builds a minimal {@link ClientMessageHandlerContext} for a given session.
   * @param sessionId - The session to build context for.
   */
  private buildContext(sessionId: string): ClientMessageHandlerContext {
    const session = this.sessionManager.getSession(sessionId);
    return {
      session,
      send: () => { /* outbound messages flow through WhatsAppConnection.sendMessage */ },
      sendError: (error: string) => { logger.warn({ sessionId, error }, 'WhatsApp dispatcher error'); },
    };
  }
}
