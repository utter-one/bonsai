import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
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
import { ConversationService } from '../../services/ConversationService';
import { SYSTEM_CONTEXT } from '../../services/RequestContext';
import { ProjectService } from '../../services/ProjectService';
import { UserService } from '../../services/UserService';
import { SecretRefUtils } from '../../services/secrets/SecretRefUtils';
import { NotFoundError } from '../../errors';
import { twilioMessagingSendBodySchema, twilioMessagingSendResponseSchema } from '../../http/contracts/twilio-messaging-outgoing';
import type { TwilioMessagingSendResponse } from '../../http/contracts/twilio-messaging-outgoing';
import * as _twilio from 'twilio';
const _twilioModule = (_twilio as any).default ?? _twilio;
const validateRequest = _twilioModule.validateRequest as typeof import('twilio').validateRequest;

/** Default inactivity session timeout in milliseconds (30 minutes). */
const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/** Query param schema for the incoming webhook. */
const webhookQuerySchema = z.object({
  apiKey: z.string().min(1).describe('API key used to authenticate and identify the project'),
  stageId: z.string().min(1).optional().describe('Stage ID to start new conversations at. When omitted, falls back to the project-level default starting stage.'),
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

  private readonly timeoutMs = parseInt(process.env.TWILIO_MESSAGING_SESSION_TIMEOUT_MS ?? String(DEFAULT_SESSION_TIMEOUT_MS), 10) || DEFAULT_SESSION_TIMEOUT_MS;

  constructor(
    @inject(SessionManager) private readonly sessionManager: SessionManager,
    @inject(ChannelHandlerDispatcher) private readonly dispatcher: ChannelHandlerDispatcher,
    @inject(IpRateLimiter) private readonly rateLimiter: IpRateLimiter,
    @inject(ConversationService) private readonly conversationService: ConversationService,
    @inject(ProjectService) private readonly projectService: ProjectService,
    @inject(UserService) private readonly userService: UserService,
    @inject(SecretRefUtils) private readonly secretRefUtils: SecretRefUtils,
  ) {}

  /**
   * Returns OpenAPI path definitions for the outgoing messaging endpoint.
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/twilio/messaging/send',
        tags: ['Twilio Messaging'],
        summary: 'Initiate an outgoing Twilio Messaging conversation',
        description: 'Starts a conversation for the specified recipient. The AI generates and sends the opening message automatically. Future inbound replies from the recipient will be attached to the same virtual session.',
        security: [],
        request: {
          query: webhookQuerySchema,
          body: { content: { 'application/json': { schema: twilioMessagingSendBodySchema } } },
        },
        responses: {
          201: { description: 'Conversation started and opening message sent by AI', content: { 'application/json': { schema: twilioMessagingSendResponseSchema } } },
          400: { description: 'Missing or invalid parameters' },
          401: { description: 'Invalid or inactive API key' },
          403: { description: 'API key does not permit twilio_messaging channel' },
          422: { description: 'No default stage available' },
        },
      },
    ];
  }

  /**
   * Registers the Twilio Messaging webhook route on the Express router.
   * @param router - The Express application or router to attach to.
   */
  registerRoutes(router: Router): void {
    router.post('/api/twilio/messaging/webhook', asyncHandler(this.handleWebhook.bind(this)));
    router.post('/api/twilio/messaging/send', asyncHandler(this.handleOutgoingMessage.bind(this)));
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

    const rawConfig = await this.secretRefUtils.resolveObject(providerRecord.config as Record<string, unknown>);
    const configResult = twilioMessagingChannelProviderConfigSchema.safeParse(rawConfig);
    if (!configResult.success) {
      logger.error({ channelProviderId, issues: configResult.error.issues }, 'Twilio webhook: channel provider config is invalid');
      res.status(500).send();
      return;
    }
    const { accountSid, authToken, fromNumber } = configResult.data;

    // Validate Twilio request signature
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

    let sessionId = existingSessionId;
    if (sessionId) {
      const existing = this.sessionManager.getSession(sessionId);
      if (!existing?.conversationId) {
        logger.info({ sessionId }, 'Twilio Messaging: existing session inactive, creating new session');
        this.phoneSessionMap.delete(phoneKey);
        const timer = this.sessionTimeoutMap.get(sessionId);
        if (timer) clearTimeout(timer);
        this.sessionTimeoutMap.delete(sessionId);
        sessionId = undefined;
      }
    }

    if (sessionId) {
      this.scheduleTimeout(sessionId, phoneKey);
      await this.dispatchTextInput(sessionId, messageText);
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
   * Handles a request to send an outgoing Twilio Messaging SMS.
   *
   * Flow:
   * 1. Validate query params (apiKey, channelProviderId) and request body.
   * 2. Load channel provider config and resolve stageId.
   * 3. Create a virtual session and pre-create a conversation record with direction 'outgoing'.
   * 4. Dispatch `start_conversation` — the AI generates and sends the opening message automatically.
   * 5. Return 201 with conversationId.
   *
   * Inbound replies from the recipient will arrive via the webhook and be matched
   * to the existing virtual session using the phoneSessionMap.
   */
  private async handleOutgoingMessage(req: Request, res: Response): Promise<void> {
    const queryResult = webhookQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({ error: 'Missing or invalid query parameters' });
      return;
    }
    const { apiKey: rawApiKey, stageId: queryStageId, agentId: queryAgentId, channelProviderId } = queryResult.data;

    const apiKeyRecord = await db.query.apiKeys.findFirst({ where: eq(apiKeys.key, rawApiKey) });
    if (!apiKeyRecord || !apiKeyRecord.isActive) {
      res.status(401).json({ error: 'Invalid or inactive API key' });
      return;
    }
    const { projectId, keySettings } = apiKeyRecord;

    if (keySettings?.allowedChannels && !keySettings.allowedChannels.includes('twilio_messaging')) {
      res.status(403).json({ error: 'API key does not permit twilio_messaging channel' });
      return;
    }

    const bodyResult = twilioMessagingSendBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Invalid request body', issues: bodyResult.error.issues });
      return;
    }
    const body = bodyResult.data;

    const providerRecord = await db.query.providers.findFirst({ where: eq(providers.id, channelProviderId) });
    if (!providerRecord || providerRecord.providerType !== 'channel') {
      res.status(400).json({ error: 'Channel provider not found or wrong type' });
      return;
    }

    const rawConfig = await this.secretRefUtils.resolveObject(providerRecord.config as Record<string, unknown>);
    const configResult = twilioMessagingChannelProviderConfigSchema.safeParse(rawConfig);
    if (!configResult.success) {
      logger.error({ channelProviderId, issues: configResult.error.issues }, 'TwilioMessaging outgoing: channel provider config is invalid');
      res.status(500).json({ error: 'Channel provider config is invalid' });
      return;
    }
    const { accountSid, authToken, fromNumber } = configResult.data;

    // Resolve stageId: body overrides query param, then project default
    let resolvedStageId = body.stageId ?? queryStageId;
    if (!resolvedStageId) {
      const project = await this.projectService.getProjectById(projectId, SYSTEM_CONTEXT);
      resolvedStageId = project.startingStageId ?? undefined;
      if (!resolvedStageId) {
        res.status(422).json({ error: 'No stageId provided and project has no default starting stage' });
        return;
      }
    }
    const resolvedAgentId = body.agentId ?? queryAgentId;

    // Ensure the user exists (create if not, only if project allows it)
    try {
      await this.userService.getUserById(projectId, body.to);
    } catch (err) {
      if (err instanceof NotFoundError) {
        const project = await this.projectService.getProjectById(projectId, SYSTEM_CONTEXT);
        if (!project.autoCreateUsers) {
          res.status(422).json({ error: 'User not found and project does not allow auto-creating users' });
          return;
        }
        await this.userService.ensureUserExists(projectId, body.to);
      } else {
        throw err;
      }
    }

    // Deep-merge injected userProfile into existing user profile
    if (body.userProfile && Object.keys(body.userProfile).length > 0) {
      await this.userService.updateUserProfile(projectId, body.to, body.userProfile);
    }

    // Create virtual connection and register a real session so inbound replies
    // are routed to this conversation instead of spawning a new session.
    const phoneKey = `${projectId}:${body.to}`;
    const connection = new TwilioMessagingConnection(body.to, fromNumber, accountSid, authToken, this.sessionManager);
    const defaultSettings = sessionSettingsSchema.parse({ sendVoiceInput: false, receiveVoiceOutput: false, receiveTranscriptionUpdates: false, receiveEvents: false });
    const sessionId = this.sessionManager.registerSession(connection);
    const session = this.sessionManager.getSession(sessionId);
    connection.attachSession(session);
    this.sessionManager.setSessionProjectAndSettings(sessionId, projectId, defaultSettings, keySettings ?? null);
    this.phoneSessionMap.set(phoneKey, sessionId);
    this.scheduleTimeout(sessionId, phoneKey);

    logger.info({ sessionId, projectId, to: body.to }, 'TwilioMessaging: outgoing virtual session created');

    // Pre-create the conversation record with direction 'outgoing', then dispatch
    // `start_conversation` so the AI generates and sends the opening message.
    const conversation = await this.conversationService.createConversation({
      projectId,
      userId: body.to,
      sessionId,
      stageId: resolvedStageId,
      status: 'initialized',
      direction: 'outgoing',
      metadata: body.metadata ?? null,
    }, SYSTEM_CONTEXT);

    const startMsg: CALInputMessage = { type: 'start_conversation', userId: body.to, stageId: resolvedStageId, agentId: resolvedAgentId, correlationId: undefined, existingConversationId: conversation.id };
    await this.dispatcher.dispatch(startMsg, this.buildContext(sessionId));

    logger.info({ projectId, conversationId: conversation.id, to: body.to }, 'TwilioMessaging: outgoing conversation started');

    const response: TwilioMessagingSendResponse = { conversationId: conversation.id };
    res.status(201).json(response);
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
