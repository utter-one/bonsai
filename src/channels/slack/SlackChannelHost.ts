import { inject, singleton } from 'tsyringe';
import { SocketModeClient, LogLevel } from '@slack/socket-mode';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index';
import { providers, projects, apiKeys } from '../../db/schema';
import { SessionManager } from '../SessionManager';
import { isFeatureAllowed } from '../SessionManager';
import { ChannelHandlerDispatcher } from '../ChannelHandlerDispatcher';
import { IpRateLimiter } from '../../IpRateLimiter';
import { SlackConnection } from './SlackConnection';
import { slackChannelProviderConfigSchema } from '../../services/providers/channel/SlackChannelProvider';
import { sessionSettingsSchema } from '../websocket/contracts/auth';
import { logger } from '../../utils/logger';
import { asyncHandler } from '../../utils/asyncHandler';
import type { CALInputMessage, CALStartConversationResponse } from '../messages';
import type { ClientMessageHandlerContext } from '../ClientMessageHandlerContext';
import { SecretRefUtils } from '../../services/secrets/SecretRefUtils';
import { DeferredProcessingService } from '../../services/DeferredProcessingService';
import { randomBetween } from '../../utils/randomBetween';

/** Default inactivity session timeout in milliseconds (30 minutes). */
const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/** Maximum allowed age of X-Slack-Request-Timestamp in seconds (±5 minutes). */
const SIGNATURE_MAX_DRIFT_SECONDS = 5 * 60;

/** Slack Web API base URL. */
const SLACK_API_BASE = 'https://slack.com/api/';

/** TTL (ms) for processed event ids kept for retry de-duplication. */
const EVENT_DEDUP_TTL_MS = 10 * 60 * 1000;

/** Query param schema for the webhook endpoint. */
const webhookQuerySchema = z.object({
  apiKey: z.string().min(1).describe('API key used to authenticate and identify the project'),
  stageId: z.string().min(1).optional().describe('Stage ID to start new conversations at. When omitted, falls back to the project-level default starting stage.'),
  agentId: z.string().optional().describe('Optional agent ID override'),
  channelProviderId: z.string().min(1).describe('ID of the Slack channel provider record'),
});

/** Shape of an inbound Slack `message` event (subset used by this host). */
const slackMessageEventSchema = z.object({
  type: z.literal('message'),
  channel: z.string().min(1).describe('Conversation ID (C... channels, D... DMs, G... group DMs)'),
  user: z.string().nullable().optional().describe('User ID (U...) of the message author; null for bot messages'),
  bot_id: z.string().optional().describe('Bot ID when the message was authored by a bot'),
  text: z.string().optional().describe('Plain-text message content (<@U...> mention tokens are included)'),
  ts: z.string().min(1).describe('Message timestamp used for threading'),
  thread_ts: z.string().optional().describe('Root message timestamp when the message is inside a thread'),
  subtype: z.string().optional().describe('Message subtype; regular user messages have none'),
  mentions: z.array(z.object({ user: z.string() })).optional().describe('Mentioned user IDs'),
});

/** Discriminates a Slack `url_verification` payload. */
function isUrlVerification(payload: unknown): payload is { type: 'url_verification'; challenge: string } {
  if (typeof payload !== 'object' || payload === null) return false;
  const record = payload as Record<string, unknown>;
  return record.type === 'url_verification' && typeof record.challenge === 'string' && record.challenge.length > 0;
}

/** Parsed data from the webhook preamble (validation + extraction). */
type SlackWebhookContext = {
  stageId?: string;
  agentId?: string;
  channelProviderId: string;
  projectId: string;
  keySettings: Record<string, unknown> | undefined;
  botToken: string;
  slackUserId: string;
  channelId: string;
  threadTs: string;
  messageText: string;
  eventId?: string;
  processingDelayMinMs: number;
  processingDelayMaxMs: number;
};

/** Provider-scoped data shared by both inbound transports (webhook + socket). */
type SlackProviderContext = {
  channelProviderId: string;
  projectId: string;
  keySettings: Record<string, unknown> | undefined;
  botToken: string;
  processingDelayMinMs: number;
  processingDelayMaxMs: number;
};

/** Event-specific fields extracted from a Slack `message` event. */
type SlackEventFields = {
  slackUserId: string;
  channelId: string;
  threadTs: string;
  messageText: string;
  eventId?: string;
};

/** Outcome of classifying an inbound Slack payload. */
type SlackRouteResult =
  | { kind: 'url_verification'; challenge: string }
  | { kind: 'event'; fields: SlackEventFields }
  | { kind: 'ignore' };

/** Shape of an inbound Socket Mode `slack_event` envelope as emitted by the client. */
type SlackSocketEnvelope = {
  ack: (response?: Record<string, unknown>) => Promise<void>;
  envelope_id: string;
  body: Record<string, unknown>;
  retry_num?: number;
  retry_reason?: string;
};

/** An active Socket Mode client, its app token (for change detection), and its resolved provider context. */
type SlackSocketEntry = {
  client: SocketModeClient;
  appToken: string;
  providerCtx: SlackProviderContext;
};

/**
 * Host for the Slack channel. Supports two inbound transports, selected per
 * provider via the config `mode`:
 *
 * - **Events API webhook** (`mode: "events_api"`, the default): Slack POSTs
 *   signed Events API payloads to `/api/slack/webhook`. Production. Each
 *   payload is authenticated via the query `apiKey` and the provider
 *   `signingSecret` (HMAC-SHA256 over `v0:<timestamp>:<raw-body>`, compared to
 *   the `X-Slack-Signature` header). The request is acknowledged (HTTP 200)
 *   before processing so the AI turn can exceed Slack's 3-second deadline.
 *
 * - **Socket Mode** (`mode: "socket_mode"`): the host opens an outbound
 *   WebSocket to Slack using the provider's app-level token. No public URL is
 *   required — intended for local development. Events arrive as `slack_event`
 *   envelopes and are acknowledged over the WebSocket. Connections are
 *   reconciled dynamically: {@link initialize} opens them at boot and
 *   {@link onProviderChanged} opens/closes/reconnects them as providers are
 *   created, updated, or deleted — no restart required. All are torn down on
 *   shutdown ({@link stop}).
 *
 * Both transports share the same payload routing: `url_verification` echoes the
 * challenge, and `event_callback` with a `message` event drives the
 * conversation flow. Trigger scope: direct messages (D.../G.../J...
 * conversations) always trigger; channel messages (C...) only trigger when the
 * bot is @-mentioned (resolved at runtime via `auth.test`, cached per
 * provider).
 */
@singleton()
export class SlackChannelHost {
  /** Maps `${projectId}:${channelId}:${threadRootTs}` → sessionId for active virtual sessions (one per Slack thread). */
  private readonly userSessionMap = new Map<string, string>();
  /** Maps sessionId → active inactivity timer handle. */
  private readonly sessionTimeoutMap = new Map<string, NodeJS.Timeout>();
  /** Maps channelProviderId → bot user id (resolved via auth.test, cached for process lifetime). */
  private readonly botUserIdCache = new Map<string, string>();
  /** Maps Slack event_id → processed at (ms) for webhook retry de-duplication. */
  private readonly processedEventIds = new Map<string, number>();
  /** Maps channelProviderId → active Socket Mode client and resolved provider context. */
  private readonly socketClients = new Map<string, SlackSocketEntry>();
  /** Guards against double-initialization of the socket-mode connections. */
  private socketInitialized = false;
  /** Chains per-provider reconciliations so rapid changes to the same provider never race. */
  private readonly reconcileChains = new Map<string, Promise<void>>();

  private readonly timeoutMs = parseInt(process.env.SLACK_SESSION_TIMEOUT_MS ?? String(DEFAULT_SESSION_TIMEOUT_MS), 10) || DEFAULT_SESSION_TIMEOUT_MS;

  constructor(
    @inject(SessionManager) private readonly sessionManager: SessionManager,
    @inject(ChannelHandlerDispatcher) private readonly dispatcher: ChannelHandlerDispatcher,
    @inject(IpRateLimiter) private readonly rateLimiter: IpRateLimiter,
    @inject(SecretRefUtils) private readonly secretRefUtils: SecretRefUtils,
    @inject(DeferredProcessingService) private readonly deferredProcessingService: DeferredProcessingService,
  ) {}

  /**
   * Returns OpenAPI path definitions for the Slack endpoints.
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/slack/webhook',
        tags: ['Slack'],
        summary: 'Receive incoming Slack events',
        description: 'Webhook endpoint for receiving inbound Slack Events API payloads (url_verification and message events). The Request URL must be configured in the Slack app; payloads are verified via the provider signing secret.',
        security: [],
        request: { query: webhookQuerySchema },
        responses: {
          200: { description: 'Event received and acknowledged' },
          400: { description: 'Missing or invalid query parameters or channel provider' },
          401: { description: 'Invalid or inactive API key, or invalid request signature' },
          403: { description: 'API key does not permit slack channel' },
        },
      },
    ];
  }

  /**
   * Registers the Slack webhook route on the Express router.
   * @param router - The Express application or router to attach to.
   */
  registerRoutes(router: Router): void {
    router.post('/api/slack/webhook', asyncHandler(this.handleWebhook.bind(this)));
  }

  /**
   * At boot, opens a Socket Mode connection for every existing slack channel
   * provider configured with `mode: "socket_mode"`. No-ops in the test
   * environment and when already initialized. Providers created or changed
   * after boot are handled via {@link onProviderChanged}.
   */
  async initialize(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    if (this.socketInitialized) return;
    this.socketInitialized = true;

    try {
      const records = await db.query.providers.findMany({ where: eq(providers.apiType, 'slack') });
      for (const record of records) {
        if (record.providerType !== 'channel') continue;
        const rawConfig = (record.config ?? {}) as Record<string, unknown>;
        if (rawConfig.mode !== 'socket_mode') continue;
        this.onProviderChanged(record.id);
      }
    } catch (error) {
      // Don't let a transient DB failure at boot prevent the whole server from
      // starting. Providers created or changed afterwards still reconcile, and the
      // next restart retries the boot-time scan.
      logger.error({ error }, 'Slack socket: failed to load socket-mode providers at boot; skipping (will reconcile on provider changes)');
    }
  }

  /**
   * Reconciles the Socket Mode connection for a single provider after it is
   * created, updated, or deleted. Opens a connection for a valid
   * `socket_mode` provider, closes one when the provider is no longer
   * `socket_mode` (or was deleted), reconnects when the app token changes, and
   * refreshes the project binding when only the API key changed. No-ops in the
   * test environment. Safe to call fire-and-forget: it never throws.
   * @param providerId - The id of the provider that changed.
   */
  onProviderChanged(providerId: string): void {
    const prev = this.reconcileChains.get(providerId) ?? Promise.resolve();
    const next = prev
      .then(() => this.reconcileProvider(providerId))
      .catch((error) => {
        logger.error({ error, providerId }, 'Slack socket: reconciliation failed');
      });
    this.reconcileChains.set(providerId, next);
    void next.finally(() => {
      if (this.reconcileChains.get(providerId) === next) this.reconcileChains.delete(providerId);
    });
  }

  /**
   * Loads a provider and starts, stops, or refreshes its Socket Mode client so
   * the live set of connections matches the provider's current configuration.
   * @param providerId - The id of the provider to reconcile.
   */
  private async reconcileProvider(providerId: string): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;

    const record = await db.query.providers.findFirst({ where: eq(providers.id, providerId) });
    const desired = await this.resolveDesiredSocket(record);
    const current = this.socketClients.get(providerId);

    if (!desired) {
      if (current) await this.stopSocketClient(providerId);
      return;
    }
    if (current && current.appToken === desired.appToken) {
      current.providerCtx = desired.providerCtx;
      return;
    }
    if (current) await this.stopSocketClient(providerId);
    await this.startSocketClient(providerId, desired.appToken, desired.providerCtx);
  }

  /**
   * Disconnects all active Socket Mode clients. Called during graceful shutdown.
   */
  async stop(): Promise<void> {
    const entries = Array.from(this.socketClients.values());
    this.socketClients.clear();
    await Promise.all(entries.map(async ({ client }) => {
      try {
        await client.disconnect();
      } catch (error) {
        logger.warn({ error }, 'Slack socket: error during client disconnect');
      }
    }));
  }

  /**
   * Handles an inbound Slack Events API webhook (POST).
   *
   * Flow:
   * 1. Validate query params, API key, rate limit, provider config, and signature;
   *    answer `url_verification` challenges. Sends an HTTP response and returns
   *    undefined on any validation failure.
   * 2. Acknowledge with 200 before processing (Slack 3-second webhook deadline).
   * 3. Look up or create a virtual session for the user and dispatch the text.
   */
  private async handleWebhook(req: Request, res: Response): Promise<void> {
    const ctx = await this.extractWebhookData(req, res);
    if (!ctx) return;

    res.status(200).json({ ok: true });

    try {
      await this.processMessage(ctx);
    } catch (error) {
      logger.error({ error, projectId: ctx.projectId, eventId: ctx.eventId }, 'Slack webhook: failed to process inbound message');
    }
  }

  /**
   * Validates query params, API key, rate limit, provider config, and request
   * signature; extracts the message data or answers a url_verification challenge.
   * Sends an HTTP response and returns undefined on any validation failure or
   * non-actionable payload.
   */
  private async extractWebhookData(req: Request, res: Response): Promise<SlackWebhookContext | undefined> {
    const queryResult = webhookQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({ error: 'Missing or invalid query parameters' });
      return;
    }
    const { apiKey, stageId, agentId, channelProviderId } = queryResult.data;

    const apiKeyRecord = await db.query.apiKeys.findFirst({ where: eq(apiKeys.key, apiKey) });
    if (!apiKeyRecord || !apiKeyRecord.isActive) {
      logger.warn('Slack webhook: invalid or inactive API key');
      res.status(401).json({ error: 'Invalid or inactive API key' });
      return;
    }

    const { projectId, keySettings } = apiKeyRecord;

    if (keySettings?.allowedChannels && !keySettings.allowedChannels.includes('slack')) {
      logger.warn({ projectId }, 'Slack webhook: API key does not permit slack channel');
      res.status(403).json({ error: 'API key does not permit slack channel' });
      return;
    }

    const ip = req.ip ?? req.socket.remoteAddress ?? '';
    if (!this.rateLimiter.tryConsume(ip)) {
      logger.warn({ ip }, 'Slack webhook rate limit exceeded');
      res.status(429).json({ error: 'Rate limit exceeded' });
      return;
    }

    const providerRecord = await db.query.providers.findFirst({ where: eq(providers.id, channelProviderId) });
    if (!providerRecord || providerRecord.providerType !== 'channel' || providerRecord.apiType !== 'slack') {
      logger.warn({ channelProviderId }, 'Slack webhook: channel provider not found or wrong type');
      res.status(400).json({ error: 'Channel provider not found or wrong type' });
      return;
    }

    const rawConfig = await this.secretRefUtils.resolveObject(providerRecord.config as Record<string, unknown>);
    const configResult = slackChannelProviderConfigSchema.safeParse(rawConfig);
    if (!configResult.success) {
      logger.error({ channelProviderId, issues: configResult.error.issues }, 'Slack webhook: channel provider config is invalid');
      res.status(500).json({ error: 'Channel provider config is invalid' });
      return;
    }
    const { botToken, signingSecret, processingDelayMinMs, processingDelayMaxMs } = configResult.data;

    // Validate X-Slack-Signature (HMAC-SHA256 over `v0:<timestamp>:<raw-body>`)
    const rawBody: Buffer | undefined = (req as any).rawBody;
    if (!rawBody) {
      logger.error({ projectId }, 'Slack webhook: raw body not available for signature validation');
      res.status(401).json({ error: 'Request signature could not be verified' });
      return;
    }

    const timestamp = req.headers['x-slack-request-timestamp'] as string | undefined;
    const signature = req.headers['x-slack-signature'] as string | undefined;
    if (!this.isValidSignature(signingSecret, rawBody, timestamp, signature)) {
      logger.warn({ ip, projectId }, 'Slack webhook: invalid X-Slack-Signature');
      res.status(401).json({ error: 'Invalid request signature' });
      return;
    }

    const providerCtx: SlackProviderContext = {
      channelProviderId,
      projectId,
      keySettings: keySettings as Record<string, unknown> | undefined,
      botToken,
      processingDelayMinMs,
      processingDelayMaxMs,
    };

    const route = await this.routeSlackEvent(req.body, providerCtx);
    switch (route.kind) {
      case 'url_verification':
        res.status(200).json({ challenge: route.challenge });
        return;
      case 'ignore':
        logger.debug({ projectId }, 'Slack webhook: non-actionable payload, ignoring');
        res.status(200).json({ ok: true });
        return;
      case 'event':
        return {
          stageId,
          agentId,
          ...providerCtx,
          ...route.fields,
        };
    }
  }

  /**
   * Classifies an inbound Slack payload (shared by the webhook and socket
   * transports). The payload is the raw Events API body — `{ type, event,
   * event_id, ... }` for `event_callback`, or `{ type: 'url_verification',
   * challenge }`. Returns a route describing how the caller should respond
   * and whether the message should be processed.
   * @param body - The raw inbound Slack payload.
   * @param providerCtx - The resolved provider-scoped context.
   */
  private async routeSlackEvent(body: unknown, providerCtx: SlackProviderContext): Promise<SlackRouteResult> {
    if (isUrlVerification(body)) {
      return { kind: 'url_verification', challenge: body.challenge };
    }

    const payload = body as Record<string, unknown> | undefined;
    if (!payload || payload.type !== 'event_callback') {
      return { kind: 'ignore' };
    }

    const eventResult = slackMessageEventSchema.safeParse(payload.event);
    if (!eventResult.success) {
      return { kind: 'ignore' };
    }
    const event = eventResult.data;

    // Regular user messages only — bot messages, edits, broadcasts, etc. are ignored
    if (event.subtype) return { kind: 'ignore' };
    if (!event.user || event.bot_id) return { kind: 'ignore' };
    const slackUserId: string = event.user;

    const rawText = event.text?.trim();
    if (!rawText) return { kind: 'ignore' };

    // Trigger scope: direct conversations always; channels only on bot @-mention
    const isDirect = event.channel.startsWith('D') || event.channel.startsWith('G') || event.channel.startsWith('J');
    let messageText = rawText;
    if (!isDirect) {
      const botUserId = await this.resolveBotUserId(providerCtx.channelProviderId, providerCtx.botToken);
      if (!botUserId) {
        logger.error({ projectId: providerCtx.projectId, channelProviderId: providerCtx.channelProviderId }, 'Slack: could not resolve bot user id, ignoring channel message');
        return { kind: 'ignore' };
      }
      const mentioned = event.mentions?.some((mention) => mention.user === botUserId) ?? false;
      if (!mentioned) return { kind: 'ignore' };
      const withoutMention = rawText.split(new RegExp(`<@${botUserId}>`, 'g')).map((part) => part.trim()).filter((part) => part.length > 0).join(' ');
      messageText = withoutMention;
      if (!messageText) return { kind: 'ignore' };
    }

    // Thread replies under the triggering message (its own ts for top-level posts)
    const threadTs = event.thread_ts ?? event.ts;

    return {
      kind: 'event',
      fields: {
        slackUserId,
        channelId: event.channel,
        threadTs,
        messageText,
        eventId: payload.event_id as string | undefined,
      },
    };
  }

  /**
   * Resolves the desired Socket Mode state for a provider record.
   * @param record - The provider record (may be undefined if it was deleted).
   * @returns The app token and provider context to connect with, or null when
   *   no socket connection should exist (deleted, not a slack channel, not
   *   socket_mode, or missing/invalid credentials).
   */
  private async resolveDesiredSocket(record: typeof providers.$inferSelect | undefined): Promise<{ appToken: string; providerCtx: SlackProviderContext } | null> {
    if (!record || record.providerType !== 'channel' || record.apiType !== 'slack') return null;

    const rawConfig = await this.secretRefUtils.resolveObject(record.config as Record<string, unknown>);
    const configResult = slackChannelProviderConfigSchema.safeParse(rawConfig);
    if (!configResult.success) {
      logger.error({ providerId: record.id, issues: configResult.error.issues }, 'Slack socket: provider config is invalid, no socket connection');
      return null;
    }
    const { mode, appToken, projectId, botToken, processingDelayMinMs, processingDelayMaxMs } = configResult.data;
    if (mode !== 'socket_mode') return null;
    if (!appToken) {
      logger.error({ providerId: record.id }, 'Slack socket: mode is socket_mode but appToken is missing, no socket connection');
      return null;
    }
    if (!projectId) {
      logger.error({ providerId: record.id }, 'Slack socket: mode is socket_mode but projectId is missing, no socket connection');
      return null;
    }

    const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
    if (!project) {
      logger.error({ providerId: record.id, projectId }, 'Slack socket: configured projectId does not reference an existing project, no socket connection');
      return null;
    }
    if (project.archivedAt != null) {
      logger.error({ providerId: record.id, projectId }, 'Slack socket: configured projectId references an archived project, no socket connection');
      return null;
    }

    return {
      appToken,
      providerCtx: {
        channelProviderId: record.id,
        projectId,
        keySettings: undefined,
        botToken,
        processingDelayMinMs,
        processingDelayMaxMs,
      },
    };
  }

  /**
   * Creates and starts a Socket Mode client for a provider. The initial
   * connection is fire-and-forget; the client self-manages (re)connection in
   * the background. The `slack_event` listener reads the provider context from
   * the live entry so binding updates are reflected without a reconnect.
   * @param providerId - The provider record id.
   * @param appToken - The app-level token to connect with.
   * @param providerCtx - The resolved provider-scoped context.
   */
  private async startSocketClient(providerId: string, appToken: string, providerCtx: SlackProviderContext): Promise<void> {
    const client = new SocketModeClient({ appToken, logLevel: LogLevel.ERROR });
    client.on('connected', () => {
      const entry = this.socketClients.get(providerId);
      logger.info({ providerId, projectId: entry?.providerCtx.projectId }, 'Slack socket: connected to Slack');
    });
    client.on('slack_event', (envelope: unknown) => {
      const entry = this.socketClients.get(providerId);
      if (!entry) return;
      void this.handleSocketEvent(envelope as SlackSocketEnvelope, entry.providerCtx);
    });
    client.on('error', (error: unknown) => {
      logger.error({ error, providerId }, 'Slack socket: client error');
    });

    this.socketClients.set(providerId, { client, appToken, providerCtx });
    client.start().catch((error) => {
      logger.error({ error, providerId }, 'Slack socket: initial connection failed (client keeps retrying)');
    });
  }

  /**
   * Disconnects and removes the Socket Mode client for a provider, if present.
   * @param providerId - The provider record id.
   */
  private async stopSocketClient(providerId: string): Promise<void> {
    const entry = this.socketClients.get(providerId);
    if (!entry) return;
    this.socketClients.delete(providerId);
    try {
      await entry.client.disconnect();
    } catch (error) {
      logger.warn({ error, providerId }, 'Slack socket: error during client disconnect');
    }
  }

  /**
   * Handles an inbound Socket Mode event: routes the payload (shared with the
   * webhook path), acknowledges over the WebSocket before processing, and
   * dispatches the message.
   * @param envelope - The Socket Mode slack_event envelope.
   * @param providerCtx - The resolved provider-scoped context.
   */
  private async handleSocketEvent(envelope: SlackSocketEnvelope, providerCtx: SlackProviderContext): Promise<void> {
    const route = await this.routeSlackEvent(envelope.body, providerCtx);
    switch (route.kind) {
      case 'url_verification':
        await this.ackSafely(envelope, { challenge: route.challenge });
        return;
      case 'ignore':
        await this.ackSafely(envelope, {});
        return;
      case 'event': {
        await this.ackSafely(envelope, {});
        const ctx: SlackWebhookContext = {
          stageId: undefined,
          agentId: undefined,
          ...providerCtx,
          ...route.fields,
        };
        try {
          await this.processMessage(ctx);
        } catch (error) {
          logger.error({ error, projectId: providerCtx.projectId, eventId: route.fields.eventId }, 'Slack socket: failed to process inbound message');
        }
        return;
      }
    }
  }

  /**
   * Acknowledges a Socket Mode envelope, logging (not throwing) on failure so a
   * single failed ack cannot break the event handler.
   * @param envelope - The Socket Mode slack_event envelope.
   * @param response - The acknowledgement payload sent back over the WebSocket.
   */
  private async ackSafely(envelope: SlackSocketEnvelope, response: Record<string, unknown>): Promise<void> {
    try {
      await envelope.ack(response);
    } catch (error) {
      logger.warn({ error, envelopeId: envelope.envelope_id }, 'Slack socket: failed to acknowledge event');
    }
  }

  /**
   * Processes an acknowledged Slack message event: de-duplicates retries,
   * looks up or creates the virtual session, and dispatches the text input.
   */
  private async processMessage(ctx: SlackWebhookContext): Promise<void> {
    if (ctx.eventId) {
      if (!this.tryClaimEvent(ctx.eventId)) {
        logger.info({ projectId: ctx.projectId, eventId: ctx.eventId }, 'Slack: duplicate webhook event ignored');
        return;
      }
    }

    // Key by the thread root (event.thread_ts ?? event.ts): each top-level message
    // starts its own conversation, and replies within that thread continue it.
    const userKey = `${ctx.projectId}:${ctx.channelId}:${ctx.threadTs}`;
    const existingSessionId = this.userSessionMap.get(userKey);

    if (existingSessionId) {
      const existing = this.sessionManager.getSession(existingSessionId);
      // If the session exists but has no active conversation (e.g. previous start_conversation failed),
      // tear it down so a fresh session is created below.
      if (!existing?.conversationId) {
        logger.info({ sessionId: existingSessionId }, 'Slack: existing session has no active conversation, recreating');
        await this.terminateSession(existingSessionId, userKey);
      } else {
        this.scheduleTimeout(existingSessionId, userKey);
        await this.dispatchText(existingSessionId, ctx);
        return;
      }
    }

    const sessionId = await this.createNewSession(ctx, userKey);
    if (sessionId) {
      await this.dispatchText(sessionId, ctx);
    }
  }

  /**
   * Creates a new virtual session and starts a conversation for the user.
   * @returns The new session id, or null if starting the conversation failed.
   */
  private async createNewSession(ctx: SlackWebhookContext, userKey: string): Promise<string | null> {
    const connection = new SlackConnection(ctx.slackUserId, ctx.channelId, ctx.threadTs, ctx.botToken, this.sessionManager);
    const defaultSettings = sessionSettingsSchema.parse({ sendVoiceInput: false, receiveVoiceOutput: false, receiveTranscriptionUpdates: false, receiveEvents: false });
    const sessionId = this.sessionManager.registerSession(connection);
    const session = this.sessionManager.getSession(sessionId);
    connection.attachSession(session);
    this.sessionManager.setSessionProjectAndSettings(sessionId, ctx.projectId, defaultSettings, ctx.keySettings ?? null, null);
    this.userSessionMap.set(userKey, sessionId);
    this.scheduleTimeout(sessionId, userKey);

    logger.info({ sessionId, projectId: ctx.projectId, slackUserId: ctx.slackUserId }, 'Slack: new virtual session created');

    const startMsg: CALInputMessage = { type: 'start_conversation', userId: ctx.slackUserId, stageId: ctx.stageId, agentId: ctx.agentId, correlationId: undefined };

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
      logger.error({ sessionId, error: startResponse?.error, projectId: ctx.projectId, slackUserId: ctx.slackUserId }, 'Slack: start_conversation failed');
      // If the start failed because the project has no default starting stage, tell
      // the user in-thread instead of going silent.
      const startError = (startResponse?.error ?? '').toLowerCase();
      if (startError.includes('no default startingstageid')) {
        await connection.sendError('I could not start this conversation: this project has no default starting stage set. Please configure a default starting stage for the project, then message me again.');
      }
      await this.terminateSession(sessionId, userKey);
      return null;
    }

    return sessionId;
  }

  /**
   * Dispatches the incoming text as user input for an active session.
   * Feature permissions are checked against the session's API key settings;
   * disallowed input is silently ignored. Deferral is honored when configured.
   * @param sessionId - The target session.
   * @param ctx - The parsed webhook context carrying the text and deferral config.
   */
  private async dispatchText(sessionId: string, ctx: SlackWebhookContext): Promise<void> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session?.conversationId) {
      logger.warn({ sessionId }, 'Slack: cannot dispatch message — no active conversation');
      return;
    }

    if (!isFeatureAllowed(session, 'text_input')) {
      logger.warn({ sessionId }, 'Slack text input: text_input feature not permitted by API key');
      return;
    }

    const msg: CALInputMessage = { type: 'send_user_text_input', conversationId: session.conversationId, text: ctx.messageText, correlationId: undefined };

    // Check deferral config
    if (ctx.processingDelayMinMs > 0 && ctx.processingDelayMaxMs > 0) {
      const delayMs = randomBetween(ctx.processingDelayMinMs, ctx.processingDelayMaxMs);
      const processAt = new Date(Date.now() + delayMs);

      await this.deferredProcessingService.queue({
        sessionId,
        providerId: ctx.channelProviderId,
        projectId: session.projectId ?? '',
        conversationId: session.conversationId,
        channelType: 'slack',
        processAt,
        message: msg,
      });

      logger.info({
        sessionId,
        projectId: session.projectId,
        conversationId: session.conversationId,
        delayMs,
        processAt,
      }, 'Slack: incoming message queued for deferred processing');
      return;
    }

    await this.dispatcher.dispatch(msg, this.buildContext(sessionId));
  }

  /**
   * Resolves the bot user id for a provider via the Slack `auth.test` endpoint.
   * Cached per provider for the process lifetime.
   * @param channelProviderId - The provider record id used as the cache key.
   * @param botToken - The bot token to call auth.test with.
   * @returns The bot user id (U...), or null on failure.
   */
  private async resolveBotUserId(channelProviderId: string, botToken: string): Promise<string | null> {
    const cached = this.botUserIdCache.get(channelProviderId);
    if (cached) return cached;

    try {
      const response = await fetch(`${SLACK_API_BASE}auth.test`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${botToken}` },
      });
      const data: { ok?: boolean; user_id?: string; error?: string } = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true || !data.user_id) {
        logger.warn({ channelProviderId, status: response.status, error: data.error }, 'Slack auth.test failed');
        return null;
      }
      this.botUserIdCache.set(channelProviderId, data.user_id);
      return data.user_id;
    } catch (error) {
      logger.error({ error, channelProviderId }, 'Slack auth.test error');
      return null;
    }
  }

  /**
   * Verifies the `X-Slack-Signature` against `v0:<timestamp>:<raw-body>` using
   * the app signing secret, rejecting stale timestamps.
   * @param signingSecret - The app signing secret (SEC...).
   * @param rawBody - The raw request body buffer.
   * @param timestamp - The X-Slack-Request-Timestamp header value.
   * @param signature - The X-Slack-Signature header value (`v0=<hex>`).
   * @returns True when the signature is valid and the timestamp is fresh.
   */
  private isValidSignature(signingSecret: string, rawBody: Buffer, timestamp: string | undefined, signature: string | undefined): boolean {
    if (!timestamp || !signature) return false;

    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > SIGNATURE_MAX_DRIFT_SECONDS) return false;

    const baseString = `v0:${timestamp}:${rawBody.toString('utf8')}`;
    const expected = `v0=${createHmac('sha256', signingSecret).update(baseString).digest('hex')}`;
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const actualBuffer = Buffer.from(signature, 'utf8');
    if (expectedBuffer.length !== actualBuffer.length) return false;

    return timingSafeEqual(expectedBuffer, actualBuffer);
  }

  /**
   * Claims a Slack event_id for processing (webhook retries are deduplicated).
   * @param eventId - The Slack event_id from the payload.
   * @returns True if the event has not been processed before, false otherwise.
   */
  private tryClaimEvent(eventId: string): boolean {
    const now = Date.now();
    for (const [id, processedAt] of this.processedEventIds) {
      if (processedAt < now - EVENT_DEDUP_TTL_MS) this.processedEventIds.delete(id);
    }
    if (this.processedEventIds.has(eventId)) return false;
    this.processedEventIds.set(eventId, now);
    return true;
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
        logger.warn({ error, sessionId }, 'Slack: error dispatching end_conversation, continuing with session teardown');
      }
    }

    // Cancel any pending deferred messages for this session
    try {
      await this.deferredProcessingService.cancelBySessionId(sessionId);
    } catch (error) {
      logger.warn({ error, sessionId }, 'Slack: error cancelling deferred messages, continuing with session teardown');
    }

    await this.sessionManager.unregisterSession(sessionId);
    logger.info({ sessionId }, 'Slack: session terminated');
  }

  /**
   * Schedules (or resets) the inactivity timeout for a session.
   * When the timer fires the session is cleaned up and the user map entry removed.
    * @param sessionId - The session to schedule the timeout for.
    * @param userKey - The session key (`${projectId}:${channelId}:${threadRootTs}`), one per Slack thread.
   */
  private scheduleTimeout(sessionId: string, userKey: string): void {
    const existing = this.sessionTimeoutMap.get(sessionId);
    if (existing) clearTimeout(existing);

    const handle = setTimeout(() => {
      (async () => {
        logger.info({ sessionId }, 'Slack: session timed out due to inactivity');

        // Cancel any pending deferred messages for this session
        await this.deferredProcessingService.cancelBySessionId(sessionId);

        this.userSessionMap.delete(userKey);
        this.sessionTimeoutMap.delete(sessionId);
        await this.sessionManager.unregisterSession(sessionId);
      })().catch((err) => {
        logger.error({ error: err, sessionId }, 'Slack session timeout unhandled rejection');
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
      send: () => { /* outbound messages flow through SlackConnection.sendMessage */ },
      sendError: (error: string) => { logger.warn({ sessionId, error }, 'Slack dispatcher error'); },
    };
  }
}
