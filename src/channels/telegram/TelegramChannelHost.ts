import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index';
import { providers, apiKeys } from '../../db/schema';
import { SessionManager } from '../SessionManager';
import { isFeatureAllowed } from '../SessionManager';
import { ChannelHandlerDispatcher } from '../ChannelHandlerDispatcher';
import { IpRateLimiter } from '../../IpRateLimiter';
import { TelegramConnection } from './TelegramConnection';
import { telegramChannelProviderConfigSchema } from '../../services/providers/channel/TelegramChannelProvider';
import { sessionSettingsSchema } from '../websocket/contracts/auth';
import { logger } from '../../utils/logger';
import { asyncHandler } from '../../utils/asyncHandler';
import type { CALInputMessage, CALStartConversationResponse } from '../messages';
import type { ClientMessageHandlerContext } from '../ClientMessageHandlerContext';
import { SecretRefUtils } from '../../services/secrets/SecretRefUtils';
import { PERMISSIONS } from '../../permissions';
import { checkPermissions } from '../../utils/permissions';
import { NotFoundError, RemoteConnectionError } from '../../errors';
import { DeferredProcessingService } from '../../services/DeferredProcessingService';
import { randomBetween } from '../../utils/randomBetween';
import { deployTelegramWebhookSchema, deployTelegramWebhookResponseSchema } from '../../http/contracts/telegram';

/** Default inactivity session timeout in milliseconds (30 minutes). */
const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/** Telegram Bot API base URL. */
const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

/** Query param schema shared by both GET and POST webhook endpoints. */
const webhookQuerySchema = z.object({
  apiKey: z.string().min(1).describe('API key used to authenticate and identify the project'),
  stageId: z.string().min(1).optional().describe('Stage ID to start new conversations at. When omitted, falls back to the project-level default starting stage.'),
  agentId: z.string().optional().describe('Optional agent ID override'),
  channelProviderId: z.string().min(1).describe('ID of the Telegram channel provider record'),
});

/** Shape of a Telegram incoming text message. */
type TelegramIncomingMessage = {
  message_id: number;
  from?: { id: number };
  chat?: { id: number; type: string };
  text?: string;
  entities?: Array<{ type: string; offset: number; length: number }>;
};

/** Top-level shape of a Telegram webhook POST payload (Update object). */
type TelegramWebhookBody = {
  update_id: number;
  message?: TelegramIncomingMessage;
  edited_message?: TelegramIncomingMessage;
};

/** Discriminated result of slash-command parsing. */
type SlashCommandResult =
  | { action: 'text' }
  | { action: 'start' }
  | { action: 'reset' }
  | { action: 'go_to_stage'; stageId: string };

/** Parsed data from the webhook preamble (validation + extraction). */
type WebhookContext = {
  apiKey: string;
  stageId?: string;
  agentId?: string;
  channelProviderId: string;
  projectId: string;
  keySettings: Record<string, unknown> | undefined;
  botToken: string;
  senderId: number;
  messageText: string;
  processingDelayMinMs: number;
  processingDelayMaxMs: number;
};

/**
 * HTTP host for the Telegram channel via the Telegram Bot API.
 *
 * Handles incoming webhooks from Telegram, maintaining a virtual session per user ID
 * with an inactivity timeout. Conversations are only initiated on `/start` — all other
 * messages from users without an active session are silently ignored. Supports a slash-command
 * interface for control operations:
 * - `/start` — initiates a new conversation (sent automatically by Telegram on first interaction)
 * - `/reset` — ends the current conversation and immediately starts a fresh one
 * - `/stage <stageId>` — navigates to a specific stage (requires `stage_control` feature)
 * - Any other `/xxx` message — treated as regular text input
 *
 * Webhook URL format:
 * `GET/POST /api/telegram/webhook?apiKey=xxx&stageId=yyy&channelProviderId=zzz[&agentId=aaa]`
 *
 * After saving the bot token in the provider config, call the `deploy-webhook` endpoint
 * to register this URL as the webhook target.
 */
@singleton()
export class TelegramChannelHost {
  /** Maps `${projectId}:${userId}` → sessionId for active virtual sessions. */
  private readonly userSessionMap = new Map<string, string>();
  /** Maps sessionId → active inactivity timer handle. */
  private readonly sessionTimeoutMap = new Map<string, NodeJS.Timeout>();

  private readonly timeoutMs = parseInt(process.env.TELEGRAM_SESSION_TIMEOUT_MS ?? String(DEFAULT_SESSION_TIMEOUT_MS), 10) || DEFAULT_SESSION_TIMEOUT_MS;

  constructor(
    @inject(SessionManager) private readonly sessionManager: SessionManager,
    @inject(ChannelHandlerDispatcher) private readonly dispatcher: ChannelHandlerDispatcher,
    @inject(IpRateLimiter) private readonly rateLimiter: IpRateLimiter,
    @inject(SecretRefUtils) private readonly secretRefUtils: SecretRefUtils,
    @inject(DeferredProcessingService) private readonly deferredProcessingService: DeferredProcessingService,
  ) {}

  /**
   * Returns OpenAPI path definitions for the Telegram endpoints.
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/telegram/webhook',
        tags: ['Telegram'],
        summary: 'Receive incoming Telegram messages',
        description: 'Webhook endpoint for receiving inbound text messages from Telegram users. The webhook URL must be registered with the Bot API via the `setupWebhook` endpoint.',
        security: [],
        request: { query: webhookQuerySchema },
        responses: {
          200: { description: 'Message received and processed' },
          400: { description: 'Missing or invalid query parameters' },
          401: { description: 'Invalid or inactive API key' },
          403: { description: 'API key does not permit telegram channel' },
        },
      },
      {
        method: 'post',
        path: '/api/telegram/deploy-webhook',
        tags: ['Telegram'],
        summary: 'Deploy Telegram webhook',
        description: 'Registers the server webhook URL with the Telegram Bot API so incoming messages are forwarded to this instance. Called from the admin UI after configuring a Telegram channel provider.',
        request: {
          body: {
            content: {
              'application/json': {
                schema: deployTelegramWebhookSchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Webhook deployed successfully',
            content: {
              'application/json': {
                schema: deployTelegramWebhookResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          401: { description: 'Authentication required' },
          403: { description: 'Missing PROVIDER_WRITE permission' },
          404: { description: 'Channel provider not found or not a Telegram provider' },
          502: { description: 'Failed to communicate with the Telegram Bot API' },
        },
      },
    ];
  }

  /**
   * Registers the Telegram webhook routes on the Express router.
   * POST handles all inbound messages (Telegram does not use GET challenge verification).
   * @param router - The Express application or router to attach to.
   */
  registerRoutes(router: Router): void {
    router.post('/api/telegram/webhook', asyncHandler(this.handleWebhook.bind(this)));
    router.post('/api/telegram/deploy-webhook', asyncHandler(this.handleDeployWebhook.bind(this)));
  }

  /**
   * Sets up the Telegram webhook URL for a given provider.
   *
   * Calls the Bot API `setWebhook` endpoint to register this server's webhook URL
   * as the destination for updates from the specified bot.
   *
   * Called after a provider is saved, or manually via the Bot API.
   * @param botToken - The bot token to configure.
   * @param webhookUrl - The full webhook URL to register.
   */
  public async deployWebhook(botToken: string, webhookUrl: string): Promise<{ ok: boolean; response?: unknown; error?: string }> {
    const url = `${TELEGRAM_API_BASE}${botToken}/setWebhook`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: webhookUrl }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ botToken, error: errorText }, 'Telegram: failed to set webhook');
        return { ok: false, error: errorText };
      }

      const data = await response.json();
      logger.info({ botToken, webhookUrl }, 'Telegram: webhook set successfully');
      return { ok: true, response: data };
    } catch (error) {
      logger.error({ error, botToken }, 'Telegram: error setting webhook');
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Handles the admin UI request to deploy a Telegram webhook.
   * Validates the provider, resolves the bot token, constructs the webhook URL,
   * and registers it with the Telegram Bot API.
   */
  private async handleDeployWebhook(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.PROVIDER_WRITE]);

    const body = deployTelegramWebhookSchema.parse(req.body);
    const { channelProviderId, apiKey, origin } = body;

    const providerRecord = await db.query.providers.findFirst({ where: eq(providers.id, channelProviderId) });
    if (!providerRecord || providerRecord.providerType !== 'channel' || providerRecord.apiType !== 'telegram') {
      throw new NotFoundError('Telegram channel provider not found');
    }

    const rawConfig = await this.secretRefUtils.resolveObject(providerRecord.config as Record<string, unknown>);
    const configResult = telegramChannelProviderConfigSchema.safeParse(rawConfig);
    if (!configResult.success) {
      throw new NotFoundError('Channel provider config is invalid');
    }
    const { botToken } = configResult.data;

    const protocol = origin ? new URL(origin).protocol.slice(0, -1) : req.protocol;
    const host = origin ? new URL(origin).host : req.get('host');
    const webhookUrl = `${protocol}://${host}/api/telegram/webhook?apiKey=${apiKey}&channelProviderId=${channelProviderId}`;

    const result = await this.deployWebhook(botToken, webhookUrl);

    if (!result.ok) {
      throw new RemoteConnectionError(`Failed to deploy Telegram webhook: ${result.error}`);
    }

    res.status(200).json({
      success: true,
      webhookUrl,
      telegramResponse: result.response,
    });
  }

  /**
   * Handles an inbound Telegram webhook (POST).
   *
   * Flow:
   * 1. Validate query params, API key, rate limit, provider config, and message via extractWebhookData.
   * 2. Parse slash commands from message text.
   * 3. Look up or create a virtual session for the user.
   * 4. Dispatch appropriate CAL messages based on command type.
   * 5. Return HTTP 200 immediately.
   */
  private async handleWebhook(req: Request, res: Response): Promise<void> {
    const ctx = await this.extractWebhookData(req, res);
    if (!ctx) return;

    const userKey = `${ctx.projectId}:${ctx.senderId}`;
    const existingSessionId = this.userSessionMap.get(userKey);
    const cmd = this.parseSlashCommand(ctx.messageText);

    // Handle /reset: tear down existing session so a fresh one is created below
    if (cmd.action === 'reset' && existingSessionId) {
      const allowedFeatures = ctx.keySettings?.allowedFeatures as string[] | undefined;
      if (!allowedFeatures || !allowedFeatures.includes('conversation_control')) {
        logger.warn({ projectId: ctx.projectId }, 'Telegram /reset command: conversation_control feature not permitted by API key');
        res.status(200).json({ ok: true });
        return;
      }
      await this.terminateSession(existingSessionId, userKey);
    }

    if (existingSessionId) {
      const existing = this.sessionManager.getSession(existingSessionId);
      // If the session exists but has no active conversation (e.g. previous start_conversation failed),
      // tear it down so a fresh session is created below.
      if (!existing?.conversationId) {
        logger.info({ sessionId: existingSessionId }, 'Telegram: existing session has no active conversation, recreating');
        await this.terminateSession(existingSessionId, userKey);
      } else {
        if (cmd.action === 'start') {
          res.status(200).json({ ok: true });
          return;
        }
        this.scheduleTimeout(existingSessionId, userKey);
        await this.dispatchCommand(existingSessionId, cmd, ctx.messageText, ctx.channelProviderId, ctx.processingDelayMinMs, ctx.processingDelayMaxMs);
        res.status(200).json({ ok: true });
        return;
      }
    }

    // Only initiate a conversation on /start or after /reset; ignore all other messages from unknown users
    if (cmd.action !== 'start' && cmd.action !== 'reset') {
      logger.debug({ projectId: ctx.projectId, userId: ctx.senderId, text: ctx.messageText }, 'Telegram: ignoring non-/start message from user without active session');
      res.status(200).json({ ok: true });
      return;
    }

    await this.createNewSession(ctx, userKey);

    res.status(200).json({ ok: true });
  }

  /**
   * Validates query params, API key, rate limit, provider config, and extracts message data.
   * Sends an HTTP response and returns undefined on any validation failure.
   */
  private async extractWebhookData(req: Request, res: Response): Promise<WebhookContext | undefined> {
    const queryResult = webhookQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({ error: 'Missing or invalid query parameters' });
      return;
    }
    const { apiKey, stageId, agentId, channelProviderId } = queryResult.data;

    const apiKeyRecord = await db.query.apiKeys.findFirst({ where: eq(apiKeys.key, apiKey) });
    if (!apiKeyRecord || !apiKeyRecord.isActive) {
      logger.warn('Telegram webhook: invalid or inactive API key');
      res.status(401).json({ error: 'Invalid or inactive API key' });
      return;
    }

    const { projectId, keySettings } = apiKeyRecord;

    if (keySettings?.allowedChannels && !keySettings.allowedChannels.includes('telegram')) {
      logger.warn({ projectId }, 'Telegram webhook: API key does not permit telegram channel');
      res.status(403).json({ error: 'API key does not permit telegram channel' });
      return;
    }

    const ip = req.ip ?? req.socket.remoteAddress ?? '';
    if (!this.rateLimiter.tryConsume(ip)) {
      logger.warn({ ip }, 'Telegram webhook rate limit exceeded');
      res.status(429).json({ error: 'Rate limit exceeded' });
      return;
    }

    const providerRecord = await db.query.providers.findFirst({ where: eq(providers.id, channelProviderId) });
    if (!providerRecord || providerRecord.providerType !== 'channel') {
      logger.warn({ channelProviderId }, 'Telegram webhook: channel provider not found or wrong type');
      res.status(400).json({ error: 'Channel provider not found or wrong type' });
      return;
    }

    const rawConfig = await this.secretRefUtils.resolveObject(providerRecord.config as Record<string, unknown>);
    const configResult = telegramChannelProviderConfigSchema.safeParse(rawConfig);
    if (!configResult.success) {
      logger.error({ channelProviderId, issues: configResult.error.issues }, 'Telegram webhook: channel provider config is invalid');
      res.status(500).json({ error: 'Channel provider config is invalid' });
      return;
    }
    const { botToken } = configResult.data;

    // Extract message from the Telegram payload
    const payload = req.body as TelegramWebhookBody;

    if (!payload.message && !payload.edited_message) {
      res.status(200).json({ ok: true });
      return;
    }

    const message = payload.message ?? payload.edited_message;
    if (!message?.text) {
      logger.debug({ projectId, messageType: message?.message_id }, 'Telegram webhook: non-text message, ignoring');
      res.status(200).json({ ok: true });
      return;
    }

    const senderId = message.from?.id;
    if (!senderId) {
      logger.warn({ projectId }, 'Telegram webhook: missing sender ID');
      res.status(200).json({ ok: true });
      return;
    }

    return {
      apiKey,
      stageId,
      agentId,
      channelProviderId,
      projectId,
      keySettings: keySettings as Record<string, unknown> | undefined,
      botToken,
      senderId,
      messageText: message.text.trim(),
      processingDelayMinMs: configResult.data.processingDelayMinMs,
      processingDelayMaxMs: configResult.data.processingDelayMaxMs,
    };
  }

  /**
   * Creates a new virtual session and starts a conversation for the user.
   */
  private async createNewSession(ctx: WebhookContext, userKey: string): Promise<void> {
    const connection = new TelegramConnection(ctx.senderId, ctx.botToken, this.sessionManager);
    const defaultSettings = sessionSettingsSchema.parse({ sendVoiceInput: false, receiveVoiceOutput: false, receiveTranscriptionUpdates: false, receiveEvents: false });
    const sessionId = this.sessionManager.registerSession(connection);
    const session = this.sessionManager.getSession(sessionId);
    connection.attachSession(session);
    this.sessionManager.setSessionProjectAndSettings(sessionId, ctx.projectId, defaultSettings, ctx.keySettings ?? null, null);
    this.userSessionMap.set(userKey, sessionId);
    this.scheduleTimeout(sessionId, userKey);

    logger.info({ sessionId, projectId: ctx.projectId, userId: ctx.senderId }, 'Telegram: new virtual session created');

    const startMsg: CALInputMessage = { type: 'start_conversation', userId: String(ctx.senderId), stageId: ctx.stageId, agentId: ctx.agentId, correlationId: undefined };

    // Capture the handler's response to detect failures (dispatcher silently swallows errors)
    let startResponse: CALStartConversationResponse | undefined;
    const captureContext: ClientMessageHandlerContext = {
      ...this.buildContext(sessionId),
      send: (msg: unknown) => {
        if ((msg as CALStartConversationResponse).type === 'start_conversation') {
          startResponse = msg as CALStartConversationResponse;
        }
      },
    };
    await this.dispatcher.dispatch(startMsg, captureContext);

    if (startResponse?.success !== true) {
      logger.error({ sessionId, error: startResponse?.error, projectId: ctx.projectId, userId: ctx.senderId }, 'Telegram: start_conversation failed');
      await this.terminateSession(sessionId, userKey);
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
  private async dispatchCommand(sessionId: string, cmd: SlashCommandResult, rawText: string, providerId: string, processingDelayMinMs: number, processingDelayMaxMs: number): Promise<void> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session?.conversationId) {
      logger.warn({ sessionId }, 'Telegram: cannot dispatch message — no active conversation');
      return;
    }

    if (cmd.action === 'go_to_stage') {
      if (!isFeatureAllowed(session, 'stage_control')) {
        logger.warn({ sessionId }, 'Telegram /stage command: stage_control feature not permitted by API key');
        return;
      }
      const msg: CALInputMessage = { type: 'go_to_stage', stageId: cmd.stageId, conversationId: session.conversationId, correlationId: undefined };
      await this.dispatcher.dispatch(msg, this.buildContext(sessionId));
      return;
    }

    // Default: plain text input (including unknown slash commands which fall through)
    if (!isFeatureAllowed(session, 'text_input')) {
      logger.warn({ sessionId }, 'Telegram text input: text_input feature not permitted by API key');
      return;
    }
    const msg: CALInputMessage = { type: 'send_user_text_input', conversationId: session.conversationId, text: rawText, correlationId: undefined };

    // Check deferral config
    if (processingDelayMinMs > 0 && processingDelayMaxMs > 0) {
      const delayMs = randomBetween(processingDelayMinMs, processingDelayMaxMs);
      const processAt = new Date(Date.now() + delayMs);

      await this.deferredProcessingService.queue({
        sessionId,
        providerId,
        projectId: session.projectId ?? '',
        conversationId: session.conversationId,
        channelType: 'telegram',
        processAt,
        message: msg,
      });

      logger.info({
        sessionId,
        projectId: session.projectId,
        conversationId: session.conversationId,
        delayMs,
        processAt,
      }, 'Telegram: incoming message queued for deferred processing');
      return;
    }

    await this.dispatcher.dispatch(msg, this.buildContext(sessionId));
  }

  /**
   * Parses the message text for slash commands.
   * - `/start` → start action
   * - `/reset` → reset action
   * - `/stage <stageId>` → go_to_stage action
   * - Everything else (including unknown `/xxx`) → text fall-through
   * @param text - The trimmed message text.
   */
  private parseSlashCommand(text: string): SlashCommandResult {
    if (!text.startsWith('/')) return { action: 'text' };

    const parts = text.split(/\s+/);
    const cmd = parts[0].toLowerCase();

    if (cmd === '/start') return { action: 'start' };
    if (cmd === '/reset') return { action: 'reset' };
    if (cmd === '/stage' && parts[1]) return { action: 'go_to_stage', stageId: parts[1] };

    // Unknown slash command — fall through as regular text so the AI handles it
    return { action: 'text' };
  }

  /**
   * Terminates an existing session: dispatches end_conversation if one is active,
   * cleans up timers, removes the user map entry, and unregisters the session.
   * @param sessionId - The session to terminate.
   * @param userKey - The user map key to remove.
   */
  private async terminateSession(sessionId: string, userKey: string): Promise<void> {
    const existing = this.sessionTimeoutMap.get(sessionId);
    if (existing) clearTimeout(existing);
    this.sessionTimeoutMap.delete(sessionId);
    this.userSessionMap.delete(userKey);

    const session = this.sessionManager.getSession(sessionId);
    if (session?.conversationId) {
      const endMsg: CALInputMessage = { type: 'end_conversation', conversationId: session.conversationId, correlationId: undefined };
      const context = this.buildContext(sessionId);
      try {
        await this.dispatcher.dispatch(endMsg, context);
      } catch (error) {
        logger.warn({ error, sessionId }, 'Telegram /reset: error dispatching end_conversation, continuing with session teardown');
      }
    }

    // Cancel any pending deferred messages for this session
    try {
      await this.deferredProcessingService.cancelBySessionId(sessionId);
    } catch (error) {
      logger.warn({ error, sessionId }, 'Telegram /reset: error cancelling deferred messages, continuing with session teardown');
    }

    await this.sessionManager.unregisterSession(sessionId);
    logger.info({ sessionId }, 'Telegram: session terminated by /reset command');
  }

  /**
   * Schedules (or resets) the inactivity timeout for a session.
   * When the timer fires the session is cleaned up and the user map entry removed.
   * @param sessionId - The session to schedule the timeout for.
   * @param userKey - The user map key (`${projectId}:${userId}`).
   */
  private scheduleTimeout(sessionId: string, userKey: string): void {
    const existing = this.sessionTimeoutMap.get(sessionId);
    if (existing) clearTimeout(existing);

    const handle = setTimeout(() => {
      (async () => {
        logger.info({ sessionId }, 'Telegram: session timed out due to inactivity');

        // Cancel any pending deferred messages for this session
        await this.deferredProcessingService.cancelBySessionId(sessionId);

        this.userSessionMap.delete(userKey);
        this.sessionTimeoutMap.delete(sessionId);
        await this.sessionManager.unregisterSession(sessionId);
      })().catch((err) => {
        logger.error({ error: err, sessionId }, 'Telegram session timeout unhandled rejection');
      });
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
      send: () => { /* outbound messages flow through TelegramConnection.sendMessage */ },
      sendError: (error: string) => { logger.warn({ sessionId, error }, 'Telegram dispatcher error'); },
    };
  }
}
