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
import { SesConnection } from './SesConnection';
import { sesChannelProviderConfigSchema } from '../../../services/providers/channel/SesChannelProvider';
import { sessionSettingsSchema } from '../../websocket/contracts/auth';
import { logger } from '../../../utils/logger';
import { asyncHandler } from '../../../utils/asyncHandler';
import type { CALInputMessage } from '../../messages';
import type { ClientMessageHandlerContext } from '../../ClientMessageHandlerContext';
import { ConversationService } from '../../../services/ConversationService';
import { ProjectService } from '../../../services/ProjectService';
import { UserService } from '../../../services/UserService';
import { SecretRefUtils } from '../../../services/secrets/SecretRefUtils';
import { sesSendBodySchema, sesSendResponseSchema } from '../../../http/contracts/ses-outgoing';
import type { SesSendResponse } from '../../../http/contracts/ses-outgoing';
import { NotFoundError } from '../../../errors';
import { SYSTEM_CONTEXT } from '../../../services/RequestContext';
import { DeferredProcessingService } from '../../../services/DeferredProcessingService';
import { randomBetween } from '../../../utils/randomBetween';
import { extractConversationIdFromMessageId, extractConversationIdFromReferences } from '../shared/MessageIdUtils';
import { resolveEmailRouting, extractRecipientEmails } from '../shared/EmailRoutingUtils';
import { stripEmailQuotes } from '../shared/EmailBodyCleaner';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { simpleParser } from 'mailparser';

const DEFAULT_SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000;

const webhookQuerySchema = z.object({
  apiKey: z.string().min(1).describe('API key used to authenticate and identify the project'),
  stageId: z.string().min(1).optional().describe('Stage ID to start new conversations at. When omitted, falls back to the project-level default starting stage.'),
  agentId: z.string().optional().describe('Optional agent ID override'),
  channelProviderId: z.string().min(1).describe('ID of the SES channel provider record'),
});



type SnsNotification = {
  Type?: string;
  Message?: string;
  Subject?: string;
};

type SesReceiptMessage = {
  mail?: {
    commonHeaders?: {
      from?: string[];
      to?: string[];
      subject?: string;
      'message-id'?: string;
      'in-reply-to'?: string;
      references?: string;
    };
  };
  receipt?: {
    spamVerdict?: { status: string };
    virusVerdict?: { status: string };
    disposition?: string;
    action?: {
      type?: string;
      bucketName?: string;
      objectKey?: string;
    };
  };
  content?: string;
};

@singleton()
export class SesChannelHost {
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
        path: '/api/email/ses/send',
        tags: ['SES'],
        summary: 'Initiate an outgoing SES email conversation',
        description: 'Sends an email via AWS SES and pre-creates a conversation record. Future inbound replies will be attached to the same virtual session.',
        security: [],
        request: {
          query: webhookQuerySchema,
          body: { content: { 'application/json': { schema: sesSendBodySchema } } },
        },
        responses: {
          201: { description: 'Email sent and conversation pre-created', content: { 'application/json': { schema: sesSendResponseSchema } } },
          400: { description: 'Missing or invalid parameters' },
          401: { description: 'Invalid or inactive API key' },
          403: { description: 'API key does not permit ses channel' },
          422: { description: 'No default stage available' },
          502: { description: 'SES API call failed' },
        },
      },
    ];
  }

  registerRoutes(router: Router): void {
    router.post('/api/email/ses/inbound', asyncHandler(this.handleWebhook.bind(this)));
    router.post('/api/email/ses/send', asyncHandler(this.handleOutgoingMessage.bind(this)));
  }

  private async handleWebhook(req: Request, res: Response): Promise<void> {
    res.status(200).json({});

    const ip = req.ip ?? req.socket.remoteAddress ?? '';

    if (!this.rateLimiter.tryConsume(ip)) {
      logger.warn({ ip }, 'SES webhook rate limit exceeded');
      return;
    }

    const queryResult = webhookQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      logger.warn({ issues: queryResult.error.issues }, 'SES webhook missing/invalid query params');
      return;
    }
    const { apiKey: rawApiKey, stageId, agentId, channelProviderId } = queryResult.data;

    const apiKeyRecord = await db.query.apiKeys.findFirst({ where: eq(apiKeys.key, rawApiKey) });
    if (!apiKeyRecord || !apiKeyRecord.isActive) {
      logger.warn('SES webhook: invalid or inactive API key');
      return;
    }

    const { projectId, keySettings } = apiKeyRecord;

    if (keySettings?.allowedChannels && !keySettings.allowedChannels.includes('ses')) {
      logger.warn({ projectId }, 'SES webhook: API key does not permit ses channel');
      return;
    }

    const providerRecord = await db.query.providers.findFirst({ where: eq(providers.id, channelProviderId) });
    if (!providerRecord || providerRecord.providerType !== 'channel') {
      logger.warn({ channelProviderId }, 'SES webhook: channel provider not found or wrong type');
      return;
    }

    const rawConfig = await this.secretRefUtils.resolveObject(providerRecord.config as Record<string, unknown>);
    const configResult = sesChannelProviderConfigSchema.safeParse(rawConfig);
    if (!configResult.success) {
      logger.error({ channelProviderId, issues: configResult.error.issues }, 'SES webhook: channel provider config is invalid');
      return;
    }
    const { accessKeyId, secretAccessKey, region, fromAddress, threadingStrategy, inboundMode, s3BucketName, ccBccReplyAsHandOff, processingDelayMinMs, processingDelayMaxMs } = configResult.data;

    const snsNotification = req.body as SnsNotification;

    if (snsNotification.Type === 'SubscriptionConfirmation') {
      logger.info({ messageId: snsNotification.Message }, 'SES SNS subscription confirmation received');
      return;
    }

    let sesMessage: SesReceiptMessage;
    try {
      sesMessage = JSON.parse(snsNotification.Message ?? '{}');
    } catch {
      logger.warn({ projectId }, 'SES webhook: failed to parse SNS message body');
      return;
    }

    const commonHeaders = sesMessage.mail?.commonHeaders ?? {};
    const senderEmail = commonHeaders.from?.[0];
    const disposition = sesMessage.receipt?.disposition;

    if (disposition === 'spam') {
      logger.warn({ projectId, from: senderEmail }, 'SES webhook: message classified as spam, ignoring');
      return;
    }

    if (!senderEmail) {
      logger.warn({ projectId }, 'SES webhook: missing sender address');
      return;
    }

    const rawMime = await this.getRawMime(sesMessage, inboundMode, s3BucketName, accessKeyId, secretAccessKey, region, projectId);
    const emailBody = await this.extractEmailBody(rawMime, senderEmail);

    const replyConversationId = extractConversationIdFromMessageId(commonHeaders['in-reply-to']) ?? extractConversationIdFromReferences(commonHeaders.references);

    if (replyConversationId) {
      const existingSessionId = this.findSessionByConversationId(projectId, replyConversationId);
      if (existingSessionId) {
        const existingSession = this.sessionManager.getSession(existingSessionId);
        const conversationUserEmail = existingSession?.clientConnection instanceof SesConnection
          ? existingSession.clientConnection.getUserEmail()
          : undefined;

        if (ccBccReplyAsHandOff && conversationUserEmail && senderEmail.toLowerCase() !== conversationUserEmail.toLowerCase()) {
          logger.info({
            projectId,
            conversationId: replyConversationId,
            from: senderEmail,
            conversationUserEmail,
          }, 'SES: reply from non-conversation user (CC/BCC hand-off), closing conversation');
          await this.conversationService.finishConversation(projectId, replyConversationId, 'Hand-off: reply from CC/BCC recipient');
          const emailKey = `${projectId}:${replyConversationId}`;
          this.emailSessionMap.delete(emailKey);
          await this.sessionManager.unregisterSession(existingSessionId);
          return;
        }

        const emailKey = `${projectId}:${replyConversationId}`;
        this.scheduleTimeout(existingSessionId, emailKey);
        await this.dispatchTextInput(existingSessionId, emailBody, channelProviderId, processingDelayMinMs, processingDelayMaxMs);
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
            }, 'SES: reply from non-conversation user (CC/BCC hand-off), session timed out, closing conversation');
            await this.conversationService.finishConversation(projectId, replyConversationId, 'Hand-off: reply from CC/BCC recipient');
            return;
          }
        }
      } catch (error) {
        logger.warn({ error, projectId, conversationId: replyConversationId }, 'SES: conversation not found for hand-off check, falling through to new conversation');
      }
      }
    }

    const connection = new SesConnection(
      senderEmail,
      fromAddress,
      threadingStrategy ?? 'messageId',
      this.sessionManager,
      commonHeaders.subject ?? 'Re: Conversation',
      accessKeyId,
      secretAccessKey,
      region,
      undefined,
      undefined,
    );
    connection.setUserEmail(senderEmail);
    const defaultSettings = sessionSettingsSchema.parse({ sendVoiceInput: false, receiveVoiceOutput: false, receiveTranscriptionUpdates: false, receiveEvents: false });
    const sessionId = this.sessionManager.registerSession(connection);
    const session = this.sessionManager.getSession(sessionId);
    connection.attachSession(session);
    this.sessionManager.setSessionProjectAndSettings(sessionId, projectId, defaultSettings, keySettings ?? null, null);
    const emailKey = `${projectId}:${sessionId}`;
    this.emailSessionMap.set(emailKey, sessionId);
    this.scheduleTimeout(sessionId, emailKey);

    logger.info({ sessionId, projectId, from: senderEmail }, 'SES: new virtual session created');

    const startMsg: CALInputMessage = { type: 'start_conversation', userId: senderEmail, stageId, agentId, correlationId: undefined };
    await this.dispatcher.dispatch(startMsg, this.buildContext(sessionId));

    await this.dispatchTextInput(sessionId, emailBody, channelProviderId, processingDelayMinMs, processingDelayMaxMs);
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

    if (keySettings?.allowedChannels && !keySettings.allowedChannels.includes('ses')) {
      res.status(403).json({ error: 'API key does not permit ses channel' });
      return;
    }

    const bodyResult = sesSendBodySchema.safeParse(req.body);
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
    const configResult = sesChannelProviderConfigSchema.safeParse(rawConfig);
    if (!configResult.success) {
      logger.error({ channelProviderId, issues: configResult.error.issues }, 'SES outgoing: channel provider config is invalid');
      res.status(500).json({ error: 'Channel provider config is invalid' });
      return;
    }
    const { accessKeyId, secretAccessKey, region, fromAddress, emailToProject } = configResult.data;

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

    const connection = new SesConnection(
      body.to,
      resolvedFromAddress,
      'messageId',
      this.sessionManager,
      resolvedSubject,
      accessKeyId,
      secretAccessKey,
      region,
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

    logger.info({ sessionId, projectId, to: body.to, conversationId: conversation.id }, 'SES: outgoing virtual session created');

    const startMsg: CALInputMessage = { type: 'start_conversation', userId: body.to, stageId: resolvedStageId, agentId: resolvedAgentId, correlationId: undefined, existingConversationId: conversation.id };
    await this.dispatcher.dispatch(startMsg, this.buildContext(sessionId));

    logger.info({ projectId, conversationId: conversation.id, to: body.to }, 'SES: outgoing conversation started');

    const response: SesSendResponse = { conversationId: conversation.id };
    res.status(201).json(response);
  }

  private async dispatchTextInput(sessionId: string, text: string, providerId: string, processingDelayMinMs: number, processingDelayMaxMs: number): Promise<void> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session?.conversationId) {
      logger.warn({ sessionId }, 'SES: cannot dispatch message — no active conversation');
      return;
    }

    if (!isFeatureAllowed(session, 'text_input')) {
      logger.warn({ sessionId }, 'SES text input: text_input feature not permitted by API key');
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
        channelType: 'ses',
        processAt,
        message: msg,
      });

      logger.info({
        sessionId,
        projectId: session.projectId,
        conversationId: session.conversationId,
        delayMs,
        processAt,
      }, 'SES: incoming message queued for deferred processing');
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

  private async getRawMime(
    sesMessage: SesReceiptMessage,
    inboundMode: 'sns' | 's3',
    s3BucketName: string | undefined,
    accessKeyId: string,
    secretAccessKey: string,
    region: string,
    projectId: string,
  ): Promise<string | null> {
    if (inboundMode === 'sns') {
      const content = sesMessage.content;
      if (!content) {
        logger.warn({ projectId }, 'SES webhook (sns mode): no "content" field in notification — receipt rule may not use an SNS action');
        return null;
      }
      return content;
    }

    const action = sesMessage.receipt?.action;
    if (!action?.objectKey) {
      logger.warn({ projectId }, 'SES webhook (s3 mode): no action.objectKey in notification — receipt rule may not use an S3 action');
      return null;
    }

    const bucket = action.bucketName;
    if (!bucket) {
      logger.warn({ projectId }, 'SES webhook (s3 mode): no action.bucketName in notification');
      return null;
    }

    if (s3BucketName && bucket !== s3BucketName) {
      logger.warn({ projectId, expectedBucket: s3BucketName, actualBucket: bucket }, 'SES webhook (s3 mode): notification bucket does not match configured s3BucketName');
      return null;
    }

    try {
      const s3Client = new S3Client({
        region,
        credentials: { accessKeyId, secretAccessKey },
      });
      const command = new GetObjectCommand({ Bucket: bucket, Key: action.objectKey });
      const response = await s3Client.send(command);

      if (!response.Body) {
        logger.warn({ projectId, objectKey: action.objectKey }, 'SES webhook (s3 mode): no body returned from S3');
        return null;
      }

      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks).toString('utf8');
    } catch (error) {
      logger.error({ error, projectId, bucket, objectKey: action.objectKey }, 'SES webhook (s3 mode): failed to fetch email from S3');
      return null;
    }
  }

  private async extractEmailBody(rawMime: string | null, senderEmail: string): Promise<string> {
    if (!rawMime) {
      return `Email from ${senderEmail}`;
    }

    try {
      const parsed = await simpleParser(rawMime);
      const rawBody = parsed.text?.trim() ?? parsed.textAsHtml?.trim() ?? parsed.html?.trim();
      if (rawBody) {
        return stripEmailQuotes(rawBody);
      }
    } catch (error) {
      logger.warn({ error }, 'SES webhook: failed to parse MIME content');
    }

    return `Email from ${senderEmail}`;
  }

  private scheduleTimeout(sessionId: string, emailKey: string): void {
    const existing = this.sessionTimeoutMap.get(sessionId);
    if (existing) clearTimeout(existing);

    const handle = setTimeout(async () => {
      logger.info({ sessionId }, 'SES: session timed out due to inactivity');

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
      send: () => { /* outbound messages flow through SesConnection.sendMessage */ },
      sendError: (error: string) => { logger.warn({ sessionId, error }, 'SES dispatcher error'); },
    };
  }
}
