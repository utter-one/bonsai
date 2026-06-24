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
import { SmtpImapConnection } from './SmtpImapConnection';
import { smtpImapChannelProviderConfigSchema } from '../../../services/providers/channel/SmtpImapChannelProvider';
import { sessionSettingsSchema } from '../../websocket/contracts/auth';
import { logger } from '../../../utils/logger';
import { asyncHandler } from '../../../utils/asyncHandler';
import type { CALInputMessage } from '../../messages';
import type { ClientMessageHandlerContext } from '../../ClientMessageHandlerContext';
import { ConversationService } from '../../../services/ConversationService';
import { ProjectService } from '../../../services/ProjectService';
import { UserService } from '../../../services/UserService';
import { SecretRefUtils } from '../../../services/secrets/SecretRefUtils';
import { smtpImapSendBodySchema, smtpImapSendResponseSchema } from '../../../http/contracts/smtp-imap-outgoing';
import type { SmtpImapSendResponse } from '../../../http/contracts/smtp-imap-outgoing';
import { NotFoundError } from '../../../errors';
import { SYSTEM_CONTEXT } from '../../../services/RequestContext';
import { OAuth2TokenRefreshService } from '../../../services/OAuth2TokenRefreshService';
import { extractConversationIdFromMessageId, extractConversationIdFromReferences } from '../shared/MessageIdUtils';

const DEFAULT_SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000;

const webhookQuerySchema = z.object({
  apiKey: z.string().min(1).describe('API key used to authenticate and identify the project'),
  stageId: z.string().min(1).optional().describe('Stage ID to start new conversations at. When omitted, falls back to the project-level default starting stage.'),
  agentId: z.string().optional().describe('Optional agent ID override'),
  channelProviderId: z.string().min(1).describe('ID of the SMTP/IMAP channel provider record'),
});

@singleton()
export class SmtpImapChannelHost {
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
    @inject(OAuth2TokenRefreshService) private readonly oauth2TokenRefreshService: OAuth2TokenRefreshService,
  ) {}

  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/email/smtp-imap/send',
        tags: ['SMTP/IMAP'],
        summary: 'Initiate an outgoing SMTP/IMAP email conversation',
        description: 'Sends an email via SMTP and pre-creates a conversation record. Future inbound replies will be picked up by the IMAP polling service.',
        security: [],
        request: {
          query: webhookQuerySchema,
          body: { content: { 'application/json': { schema: smtpImapSendBodySchema } } },
        },
        responses: {
          201: { description: 'Email sent and conversation pre-created', content: { 'application/json': { schema: smtpImapSendResponseSchema } } },
          400: { description: 'Missing or invalid parameters' },
          401: { description: 'Invalid or inactive API key' },
          403: { description: 'API key does not permit smtp_imap channel' },
          422: { description: 'No default stage available' },
          502: { description: 'SMTP send failed' },
        },
      },
    ];
  }

  registerRoutes(router: Router): void {
    router.post('/api/email/smtp-imap/send', asyncHandler(this.handleOutgoingMessage.bind(this)));
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

    if (keySettings?.allowedChannels && !keySettings.allowedChannels.includes('smtp_imap')) {
      res.status(403).json({ error: 'API key does not permit smtp_imap channel' });
      return;
    }

    const bodyResult = smtpImapSendBodySchema.safeParse(req.body);
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
    const configResult = smtpImapChannelProviderConfigSchema.safeParse(rawConfig);
    if (!configResult.success) {
      logger.error({ channelProviderId, issues: configResult.error.issues }, 'SMTP/IMAP outgoing: channel provider config is invalid');
      res.status(500).json({ error: 'Channel provider config is invalid' });
      return;
    }
    const { fromAddress, smtp, threadingStrategy, oauth2 } = configResult.data;

    if (oauth2?.accessToken && oauth2.accessTokenExpiry && Date.now() >= oauth2.accessTokenExpiry) {
      logger.info({ channelProviderId }, 'SMTP/IMAP outgoing: OAuth2 token expired, refreshing inline');
      await this.oauth2TokenRefreshService.refreshProvider(channelProviderId);
    }

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

    const subject = body.subject ?? 'New Conversation';
    const connection = new SmtpImapConnection(
      body.to,
      body.fromAddress ?? fromAddress,
      threadingStrategy ?? 'messageId',
      this.sessionManager,
      subject,
      channelProviderId,
      smtp.host,
      smtp.port,
      smtp.secure,
      smtp.auth.user,
      smtp.auth.pass,
    );

    try {
      await connection.verifyConnection();
    } catch (error) {
      logger.error({ error, channelProviderId, to: body.to }, 'SMTP/IMAP: transporter verification failed');
      res.status(502).json({ error: 'SMTP connection verification failed' });
      return;
    }

    const defaultSettings = sessionSettingsSchema.parse({ sendVoiceInput: false, receiveVoiceOutput: false, receiveTranscriptionUpdates: false, receiveEvents: false });
    const sessionId = this.sessionManager.registerSession(connection);
    const session = this.sessionManager.getSession(sessionId);
    connection.attachSession(session);
    this.sessionManager.setSessionProjectAndSettings(sessionId, projectId, defaultSettings, keySettings ?? null);

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

    logger.info({ sessionId, projectId, to: body.to, conversationId: conversation.id }, 'SMTP/IMAP: outgoing virtual session created');

    const startMsg: CALInputMessage = { type: 'start_conversation', userId: body.to, stageId: resolvedStageId, agentId: resolvedAgentId, correlationId: undefined, existingConversationId: conversation.id };
    await this.dispatcher.dispatch(startMsg, this.buildContext(sessionId));

    logger.info({ projectId, conversationId: conversation.id, to: body.to }, 'SMTP/IMAP: outgoing conversation started');

    const response: SmtpImapSendResponse = { conversationId: conversation.id };
    res.status(201).json(response);
  }

  private async dispatchTextInput(sessionId: string, text: string): Promise<void> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session?.conversationId) {
      logger.warn({ sessionId }, 'SMTP/IMAP: cannot dispatch message — no active conversation');
      return;
    }

    if (!isFeatureAllowed(session, 'text_input')) {
      logger.warn({ sessionId }, 'SMTP/IMAP text input: text_input feature not permitted by API key');
      return;
    }

    const msg: CALInputMessage = { type: 'send_user_text_input', conversationId: session.conversationId, text, correlationId: undefined };
    await this.dispatcher.dispatch(msg, this.buildContext(sessionId));
  }

  public async handleInboundEmail(
    projectId: string,
    keySettings: Record<string, unknown> | null,
    fromAddress: string,
    threadingStrategy: 'messageId' | 'senderSubject',
    providerId: string,
    smtpHost: string,
    smtpPort: number,
    smtpSecure: boolean,
    smtpAuthUser: string,
    smtpAuthPass: string,
    senderEmail: string,
    emailBody: string,
    subject: string,
    messageId: string | undefined,
    inReplyTo: string | undefined,
    references: string | string[] | undefined,
    stageId: string | undefined,
    agentId: string | undefined,
  ): Promise<void> {
    const replyConversationId = extractConversationIdFromMessageId(inReplyTo) ?? extractConversationIdFromReferences(references);
    logger.info({ projectId, from: senderEmail, inReplyTo, references, replyConversationId }, 'SMTP/IMAP: inbound email threading headers');

    if (replyConversationId) {
      const existingSessionId = this.findSessionByConversationId(projectId, replyConversationId);
      if (existingSessionId) {
        const existingSession = this.sessionManager.getSession(existingSessionId);
        if (existingSession?.clientConnection instanceof SmtpImapConnection) {
          if (messageId) {
            existingSession.clientConnection.setInboundMessageId(messageId);
          }
          if (references) {
            existingSession.clientConnection.setReferencesChain(references);
          }
        }
        const emailKey = `${projectId}:${replyConversationId}`;
        this.scheduleTimeout(existingSessionId, emailKey);
        await this.dispatchTextInput(existingSessionId, emailBody);
        return;
      }
    }

    const connection = new SmtpImapConnection(
      senderEmail,
      fromAddress,
      threadingStrategy ?? 'messageId',
      this.sessionManager,
      subject ?? 'Re: Conversation',
      providerId,
      smtpHost,
      smtpPort,
      smtpSecure,
      smtpAuthUser,
      smtpAuthPass,
    );

    try {
      await connection.verifyConnection();
    } catch (error) {
      logger.error({ error, from: senderEmail }, 'SMTP/IMAP: transporter verification failed for inbound reply');
      return;
    }

    const defaultSettings = sessionSettingsSchema.parse({ sendVoiceInput: false, receiveVoiceOutput: false, receiveTranscriptionUpdates: false, receiveEvents: false });
    const sessionId = this.sessionManager.registerSession(connection);
    const session = this.sessionManager.getSession(sessionId);
    connection.attachSession(session);
    if (messageId) {
      connection.setInboundMessageId(messageId);
    }
    if (references) {
      connection.setReferencesChain(references);
    }
    this.sessionManager.setSessionProjectAndSettings(sessionId, projectId, defaultSettings, keySettings ?? null);

    let conversationId: string;

    if (replyConversationId) {
      conversationId = replyConversationId;
      await this.sessionManager.attachConversationToSession(sessionId, conversationId);
      const resumedSession = this.sessionManager.getSession(sessionId);
      await resumedSession.runner?.resumeConversation();
      logger.info({ sessionId, projectId, from: senderEmail, conversationId }, 'SMTP/IMAP: resumed existing conversation for inbound email');
    } else {
      try {
        await this.userService.getUserById(projectId, senderEmail);
      } catch (err) {
        if (err instanceof NotFoundError) {
          const project = await this.projectService.getProjectById(projectId, SYSTEM_CONTEXT);
          if (!project.autoCreateUsers) {
            logger.warn({ projectId, from: senderEmail }, 'SMTP/IMAP: user not found and auto-create disabled');
            await this.sessionManager.unregisterSession(sessionId);
            return;
          }
          await this.userService.ensureUserExists(projectId, senderEmail);
        } else {
          throw err;
        }
      }

      const resolvedStageId = stageId ?? (await this.projectService.getProjectById(projectId, SYSTEM_CONTEXT)).startingStageId;
      if (!resolvedStageId) {
        logger.warn({ projectId }, 'SMTP/IMAP: no stageId available for new conversation');
        await this.sessionManager.unregisterSession(sessionId);
        return;
      }

      const conversation = await this.conversationService.createConversation({
        projectId,
        userId: senderEmail,
        stageId: resolvedStageId,
        sessionId,
        status: 'initialized',
        direction: 'incoming',
        metadata: null,
      }, SYSTEM_CONTEXT);
      conversationId = conversation.id;

      connection.setSkipNextEmail(true);
      await this.sessionManager.attachConversationToSession(sessionId, conversationId);
      const newSession = this.sessionManager.getSession(sessionId);
      await newSession.runner?.startConversation();
      logger.info({ sessionId, projectId, from: senderEmail, conversationId }, 'SMTP/IMAP: new conversation started for inbound email (welcome email suppressed)');
    }

    connection.setConversationId(conversationId);
    const emailKey = `${projectId}:${conversationId}`;
    this.emailSessionMap.set(emailKey, sessionId);
    this.scheduleTimeout(sessionId, emailKey);

    await this.dispatchTextInput(sessionId, emailBody);
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

  private scheduleTimeout(sessionId: string, emailKey: string): void {
    const existing = this.sessionTimeoutMap.get(sessionId);
    if (existing) clearTimeout(existing);

    const handle = setTimeout(async () => {
      logger.info({ sessionId }, 'SMTP/IMAP: session timed out due to inactivity');
      this.emailSessionMap.delete(emailKey);
      this.sessionTimeoutMap.delete(sessionId);
      try {
        await this.sessionManager.unregisterSession(sessionId);
      } catch {
        // session may not have a connection, ignore
      }
    }, this.timeoutMs);

    handle.unref?.();
    this.sessionTimeoutMap.set(sessionId, handle);
  }

  private buildContext(sessionId: string): ClientMessageHandlerContext {
    const session = this.sessionManager.getSession(sessionId);
    return {
      session,
      send: () => { /* outbound messages flow through SmtpImapConnection.sendMessage */ },
      sendError: (error: string) => { logger.warn({ sessionId, error }, 'SMTP/IMAP dispatcher error'); },
    };
  }
}
