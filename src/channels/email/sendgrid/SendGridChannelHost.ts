import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../../../db/index';
import { providers, apiKeys } from '../../../db/schema';
import { SessionManager } from '../../SessionManager';
import { isFeatureAllowed } from '../../SessionManager';
import { ChannelHandlerDispatcher } from '../../ChannelHandlerDispatcher';
import { IpRateLimiter } from '../../../IpRateLimiter';
import { SendGridConnection } from './SendGridConnection';
import { sendGridChannelProviderConfigSchema } from '../../../services/providers/channel/SendGridChannelProvider';
import { sessionSettingsSchema } from '../../websocket/contracts/auth';
import { logger } from '../../../utils/logger';
import { asyncHandler } from '../../../utils/asyncHandler';
import type { CALInputMessage } from '../../messages';
import type { ClientMessageHandlerContext } from '../../ClientMessageHandlerContext';
import { ConversationService } from '../../../services/ConversationService';
import { ProjectService } from '../../../services/ProjectService';
import { UserService } from '../../../services/UserService';
import { SecretRefUtils } from '../../../services/secrets/SecretRefUtils';
import { sendGridSendBodySchema, sendGridSendResponseSchema } from '../../../http/contracts/sendgrid-outgoing';
import type { SendGridSendResponse } from '../../../http/contracts/sendgrid-outgoing';
import { NotFoundError } from '../../../errors';
import { SYSTEM_CONTEXT } from '../../../services/RequestContext';
import { DeferredProcessingService } from '../../../services/DeferredProcessingService';
import { randomBetween } from '../../../utils/randomBetween';
import { extractConversationIdFromMessageId, extractConversationIdFromReferences } from '../shared/MessageIdUtils';
import { resolveEmailRouting, extractRecipientEmails } from '../shared/EmailRoutingUtils';
import { stripEmailQuotes } from '../shared/EmailBodyCleaner';

const DEFAULT_SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000;

const webhookQuerySchema = z.object({
  apiKey: z.string().min(1).describe('API key used to authenticate and identify the project'),
  stageId: z.string().min(1).optional().describe('Stage ID to start new conversations at. When omitted, falls back to the project-level default starting stage.'),
  agentId: z.string().optional().describe('Optional agent ID override'),
  channelProviderId: z.string().min(1).describe('ID of the SendGrid channel provider record'),
});

type SendGridInboundPayload = {
  from?: string;
  subject?: string;
  text?: string;
  headers?: Array<{ ['name']?: string; ['value']?: string }>;
};

@singleton()
export class SendGridChannelHost {
  private readonly emailSessionMap = new Map<string, string>();
  private readonly sessionTimeoutMap = new Map<string, NodeJS.Timeout>();

  private readonly timeoutMs = parseInt(process.env.EMAIL_SESSION_TIMEOUT_MS ?? String(DEFAULT_SESSION_TIMEOUT_MS), 10);

  constructor(
    @inject(SessionManager) private readonly sessionManager: SessionManager,
    @inject(ChannelHandlerDispatcher) private readonly dispatcher: ChannelHandlerDispatcher,
    @inject(IpRateLimiter) private readonly rateLimiter: IpRateLimiter,
    @inject(ConversationService) private readonly conversationService: ConversationService,
    @inject(ProjectService) private readonly projectService: ProjectService,
    @inject(UserService) private readonly userService: UserService,
    @inject(SecretRefUtils) private readonly secretRefUtils: SecretRefUtils,
    @inject(DeferredProcessingService) private readonly deferredProcessingService: DeferredProcessingService,
  ) {}

  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/email/sendgrid/send',
        tags: ['SendGrid'],
        summary: 'Initiate an outgoing SendGrid email conversation',
        description: 'Sends an email via SendGrid and pre-creates a conversation record. Future inbound replies will be attached to the same virtual session.',
        security: [],
        request: {
          query: webhookQuerySchema,
          body: { content: { 'application/json': { schema: sendGridSendBodySchema } } },
        },
        responses: {
          201: { description: 'Email sent and conversation pre-created', content: { 'application/json': { schema: sendGridSendResponseSchema } } },
          400: { description: 'Missing or invalid parameters' },
          401: { description: 'Invalid or inactive API key' },
          403: { description: 'API key does not permit sendgrid channel' },
          422: { description: 'No default stage available' },
          502: { description: 'SendGrid API call failed' },
        },
      },
    ];
  }

  registerRoutes(router: Router): void {
    router.post('/api/email/sendgrid/inbound', asyncHandler(this.handleWebhook.bind(this)));
    router.post('/api/email/sendgrid/send', asyncHandler(this.handleOutgoingMessage.bind(this)));
  }

  private async handleWebhook(req: Request, res: Response): Promise<void> {
    res.status(200).json({});

    const ip = req.ip ?? req.socket.remoteAddress ?? '';

    if (!this.rateLimiter.tryConsume(ip)) {
      logger.warn({ ip }, 'SendGrid webhook rate limit exceeded');
      return;
    }

    const queryResult = webhookQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      logger.warn({ issues: queryResult.error.issues }, 'SendGrid webhook missing/invalid query params');
      return;
    }
    const { apiKey: rawApiKey, stageId, agentId, channelProviderId } = queryResult.data;

    const apiKeyRecord = await db.query.apiKeys.findFirst({ where: eq(apiKeys.key, rawApiKey) });
    if (!apiKeyRecord || !apiKeyRecord.isActive) {
      logger.warn('SendGrid webhook: invalid or inactive API key');
      return;
    }

    const { projectId, keySettings } = apiKeyRecord;

    if (keySettings?.allowedChannels && !keySettings.allowedChannels.includes('sendgrid')) {
      logger.warn({ projectId }, 'SendGrid webhook: API key does not permit sendgrid channel');
      return;
    }

    const providerRecord = await db.query.providers.findFirst({ where: eq(providers.id, channelProviderId) });
    if (!providerRecord || providerRecord.providerType !== 'channel') {
      logger.warn({ channelProviderId }, 'SendGrid webhook: channel provider not found or wrong type');
      return;
    }

    const rawConfig = await this.secretRefUtils.resolveObject(providerRecord.config as Record<string, unknown>);
    const configResult = sendGridChannelProviderConfigSchema.safeParse(rawConfig);
    if (!configResult.success) {
      logger.error({ channelProviderId, issues: configResult.error.issues }, 'SendGrid webhook: channel provider config is invalid');
      return;
    }
    const { apiKey, fromAddress, threadingStrategy, ccBccReplyAsHandOff, processingDelayMinMs, processingDelayMaxMs } = configResult.data;

    const payload = req.body as SendGridInboundPayload;
    const senderEmail = payload.from;
    const rawBody = payload.text?.trim();
    const messageText = rawBody ? stripEmailQuotes(rawBody) : '';
    const headers = this.parseHeaders(payload.headers);

    if (!senderEmail || !messageText) {
      logger.warn({ projectId }, 'SendGrid webhook: missing sender or text body');
      return;
    }

    const replyConversationId = extractConversationIdFromMessageId(headers['in-reply-to']) ?? extractConversationIdFromReferences(headers['references']);

    if (replyConversationId) {
      const existingSessionId = this.findSessionByConversationId(projectId, replyConversationId);
      if (existingSessionId) {
        const existingSession = this.sessionManager.getSession(existingSessionId);
        const conversationUserEmail = existingSession?.clientConnection instanceof SendGridConnection
          ? existingSession.clientConnection.getUserEmail()
          : undefined;

        if (ccBccReplyAsHandOff && conversationUserEmail && senderEmail.toLowerCase() !== conversationUserEmail.toLowerCase()) {
          logger.info({
            projectId,
            conversationId: replyConversationId,
            from: senderEmail,
            conversationUserEmail,
          }, 'SendGrid: reply from non-conversation user (CC/BCC hand-off), closing conversation');
          await this.conversationService.finishConversation(projectId, replyConversationId, 'Hand-off: reply from CC/BCC recipient');
          const emailKey = `${projectId}:${replyConversationId}`;
          this.emailSessionMap.delete(emailKey);
          await this.sessionManager.unregisterSession(existingSessionId);
          return;
        }

        const emailKey = `${projectId}:${replyConversationId}`;
        this.scheduleTimeout(existingSessionId, emailKey);
        await this.dispatchTextInput(existingSessionId, messageText, channelProviderId, processingDelayMinMs, processingDelayMaxMs);
        return;
      }

      // Session not found (may have timed out) — check if this is a hand-off reply
      if (ccBccReplyAsHandOff) {
        try {
        if (senderEmail) {
          const conversation = await this.conversationService.getConversationById(projectId, replyConversationId);
          if (conversation.userId.toLowerCase() !== senderEmail.toLowerCase()) {
            logger.info({
              projectId,
              conversationId: replyConversationId,
              from: senderEmail,
              conversationUserId: conversation.userId,
            }, 'SendGrid: reply from non-conversation user (CC/BCC hand-off), session timed out, closing conversation');
            await this.conversationService.finishConversation(projectId, replyConversationId, 'Hand-off: reply from CC/BCC recipient');
            return;
          }
        }
      } catch (error) {
        logger.warn({ error, projectId, conversationId: replyConversationId }, 'SendGrid: conversation not found for hand-off check, falling through to new conversation');
      }
      }
    }

    const connection = new SendGridConnection(senderEmail, fromAddress, threadingStrategy ?? 'messageId', this.sessionManager, payload.subject ?? 'Re: Conversation', apiKey, undefined, undefined);
    connection.setUserEmail(senderEmail);
    const defaultSettings = sessionSettingsSchema.parse({ sendVoiceInput: false, receiveVoiceOutput: false, receiveTranscriptionUpdates: false, receiveEvents: false });
    const sessionId = this.sessionManager.registerSession(connection);
    const session = this.sessionManager.getSession(sessionId);
    connection.attachSession(session);
    this.sessionManager.setSessionProjectAndSettings(sessionId, projectId, defaultSettings, keySettings ?? null, null);
    const emailKey = `${projectId}:${sessionId}`;
    this.emailSessionMap.set(emailKey, sessionId);
    this.scheduleTimeout(sessionId, emailKey);

    logger.info({ sessionId, projectId, from: senderEmail }, 'SendGrid: new virtual session created');

    const startMsg: CALInputMessage = { type: 'start_conversation', userId: senderEmail, stageId, agentId, correlationId: undefined };
    await this.dispatcher.dispatch(startMsg, this.buildContext(sessionId));

    await this.dispatchTextInput(sessionId, messageText, channelProviderId, processingDelayMinMs, processingDelayMaxMs);
  }

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

    if (keySettings?.allowedChannels && !keySettings.allowedChannels.includes('sendgrid')) {
      res.status(403).json({ error: 'API key does not permit sendgrid channel' });
      return;
    }

    const bodyResult = sendGridSendBodySchema.safeParse(req.body);
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
    const configResult = sendGridChannelProviderConfigSchema.safeParse(rawConfig);
    if (!configResult.success) {
      logger.error({ channelProviderId, issues: configResult.error.issues }, 'SendGrid outgoing: channel provider config is invalid');
      res.status(500).json({ error: 'Channel provider config is invalid' });
      return;
    }
    const { apiKey, fromAddress, emailToProject } = configResult.data;

    const fromAddressLookup = body.fromAddress ?? fromAddress;
    const routing = emailToProject ? resolveEmailRouting(emailToProject, extractRecipientEmails(fromAddressLookup), projectId, fromAddress) : null;
    const resolvedFromAddress = body.fromAddress ?? routing?.fromAddress ?? fromAddress;

    let resolvedStageId = body.stageId ?? queryStageId ?? routing?.stageId;
    if (!resolvedStageId) {
      const project = await this.projectService.getProjectById(projectId, SYSTEM_CONTEXT);
      resolvedStageId = project.startingStageId ?? undefined;
      if (!resolvedStageId) {
        res.status(422).json({ error: 'No stageId provided and project has no default starting stage' });
        return;
      }
    }
    const resolvedAgentId = body.agentId ?? queryAgentId ?? routing?.agentId;
    const resolvedCc = body.cc ?? routing?.cc;
    const resolvedBcc = body.bcc ?? routing?.bcc;
    const resolvedSubject = body.subject ?? routing?.subject ?? 'New Conversation';

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

    if (body.userProfile && Object.keys(body.userProfile).length > 0) {
      await this.userService.updateUserProfile(projectId, body.to, body.userProfile);
    }

    const connection = new SendGridConnection(
      body.to,
      resolvedFromAddress,
      'messageId',
      this.sessionManager,
      resolvedSubject,
      apiKey,
      resolvedCc,
      resolvedBcc,
    );
    connection.setUserEmail(body.to);
    const defaultSettings = sessionSettingsSchema.parse({ sendVoiceInput: false, receiveVoiceOutput: false, receiveTranscriptionUpdates: false, receiveEvents: false });
    const sessionId = this.sessionManager.registerSession(connection);
    const session = this.sessionManager.getSession(sessionId);
    connection.attachSession(session);
    this.sessionManager.setSessionProjectAndSettings(sessionId, projectId, defaultSettings, keySettings ?? null, null);

    const conversation = await this.conversationService.createConversation({
      projectId,
      userId: body.to,
      sessionId,
      stageId: resolvedStageId,
      status: 'initialized',
      direction: 'outgoing',
      metadata: body.metadata ?? null,
    }, SYSTEM_CONTEXT);

    const emailKey = `${projectId}:${conversation.id}`;
    this.emailSessionMap.set(emailKey, sessionId);
    this.scheduleTimeout(sessionId, emailKey);
    connection.setConversationId(conversation.id);

    logger.info({ sessionId, projectId, to: body.to, conversationId: conversation.id }, 'SendGrid: outgoing virtual session created');

    const startMsg: CALInputMessage = { type: 'start_conversation', userId: body.to, stageId: resolvedStageId, agentId: resolvedAgentId, correlationId: undefined, existingConversationId: conversation.id };
    await this.dispatcher.dispatch(startMsg, this.buildContext(sessionId));

    logger.info({ projectId, conversationId: conversation.id, to: body.to }, 'SendGrid: outgoing conversation started');

    const response: SendGridSendResponse = { conversationId: conversation.id };
    res.status(201).json(response);
  }

  private async dispatchTextInput(sessionId: string, text: string, providerId: string, processingDelayMinMs: number, processingDelayMaxMs: number): Promise<void> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session?.conversationId) {
      logger.warn({ sessionId }, 'SendGrid: cannot dispatch message — no active conversation');
      return;
    }

    if (!isFeatureAllowed(session, 'text_input')) {
      logger.warn({ sessionId }, 'SendGrid text input: text_input feature not permitted by API key');
      return;
    }

    const msg: CALInputMessage = { type: 'send_user_text_input', conversationId: session.conversationId, text, correlationId: undefined };

    // Check deferral config
    if (processingDelayMinMs > 0 && processingDelayMaxMs > 0) {
      const delayMs = randomBetween(processingDelayMinMs, processingDelayMaxMs);
      const processAt = new Date(Date.now() + delayMs);

      await this.deferredProcessingService.queue({
        sessionId,
        providerId,
        projectId: session.projectId ?? '',
        conversationId: session.conversationId,
        channelType: 'sendgrid',
        processAt,
        message: msg,
      });

      logger.info({
        sessionId,
        projectId: session.projectId,
        conversationId: session.conversationId,
        delayMs,
        processAt,
      }, 'SendGrid: incoming message queued for deferred processing');
      return;
    }

    await this.dispatcher.dispatch(msg, this.buildContext(sessionId));
  }

  private findSessionByConversationId(projectId: string, conversationId: string): string | undefined {
    const emailKey = `${projectId}:${conversationId}`;
    const sessionId = this.emailSessionMap.get(emailKey);
    if (sessionId) return sessionId;

    for (const [key, sid] of this.emailSessionMap.entries()) {
      const session = this.sessionManager.getSession(sid);
      if (session?.conversationId === conversationId) {
        this.emailSessionMap.delete(key);
        this.emailSessionMap.set(emailKey, sid);
        return sid;
      }
    }
    return undefined;
  }

  private parseHeaders(rawHeaders?: Array<{ ['name']?: string; ['value']?: string }>): Record<string, string> {
    const result: Record<string, string> = {};
    if (!rawHeaders) return result;
    for (const h of rawHeaders) {
      const name = h['name']?.toLowerCase();
      const value = h['value'];
      if (name && value) {
        result[name] = value;
      }
    }
    return result;
  }

  private scheduleTimeout(sessionId: string, emailKey: string): void {
    const existing = this.sessionTimeoutMap.get(sessionId);
    if (existing) clearTimeout(existing);

    const handle = setTimeout(async () => {
      logger.info({ sessionId }, 'SendGrid: session timed out due to inactivity');

      // Cancel any pending deferred messages for this session
      await this.deferredProcessingService.cancelBySessionId(sessionId);

      this.emailSessionMap.delete(emailKey);
      this.sessionTimeoutMap.delete(sessionId);
      await this.sessionManager.unregisterSession(sessionId);
    }, this.timeoutMs);

    handle.unref?.();
    this.sessionTimeoutMap.set(sessionId, handle);
  }

  private buildContext(sessionId: string): ClientMessageHandlerContext {
    const session = this.sessionManager.getSession(sessionId);
    return {
      session,
      send: () => { /* outbound messages flow through SendGridConnection.sendMessage */ },
      sendError: (error: string) => { logger.warn({ sessionId, error }, 'SendGrid dispatcher error'); },
    };
  }
}
