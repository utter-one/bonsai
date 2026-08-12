import { inject, singleton, container } from 'tsyringe';
import ImapConnection from 'imap';
import { simpleParser } from 'mailparser';
import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { providers, apiKeys } from '../db/schema';
import { SmtpImapChannelHost } from '../channels/email/smtp-imap/SmtpImapChannelHost';
import { smtpImapChannelProviderConfigSchema } from './providers/channel/SmtpImapChannelProvider';
import { SecretRefUtils } from './secrets/SecretRefUtils';
import { logger } from '../utils/logger';
import { extractRecipientEmails, resolveEmailRouting } from '../channels/email/shared/EmailRoutingUtils';
import type { EmailRoutingEntry } from '../channels/email/shared/EmailRoutingTypes';
import { stripEmailQuotes } from '../channels/email/shared/EmailBodyCleaner';

function extractHeaderFromSource(source: string, headerName: string): string | undefined {
  const headerSection = source.split(/\r?\n\r?\n/)[0];
  const match = headerSection.match(new RegExp(`${headerName}:\\s*(.+)$`, 'im'));
  return match ? match[1].trim() : undefined;
}

class ImapMailboxSession {
  private pollTimer: NodeJS.Timeout | null = null;
  public shouldStop = false;

  constructor(
    public readonly providerId: string,
    public readonly defaultProjectId: string | undefined,
    public readonly imapHost: string,
    public readonly imapPort: number,
    public readonly imapSecure: boolean,
    public readonly imapUser: string,
    public readonly imapPass: string,
    public readonly pollingIntervalMs: number,
    public readonly fromAddress: string,
    public readonly threadingStrategy: 'messageId' | 'senderSubject',
    public readonly smtpHost: string,
    public readonly smtpPort: number,
    public readonly smtpSecure: boolean,
    public readonly smtpAuthUser: string,
    public readonly smtpAuthPass: string,
    public readonly emailToProject: Record<string, string | EmailRoutingEntry> | undefined,
    public readonly oauth2AccessToken: string | undefined,
    public readonly processedFolder: string,
    public readonly ccBccReplyAsHandOff: boolean,
    public readonly processingDelayMinMs: number,
    public readonly processingDelayMaxMs: number,
  ) {}

  public startPolling(): void {
    if (this.shouldStop) return;
    this.clearPollTimer();

    this.pollTimer = setTimeout(async () => {
      if (this.shouldStop) return;
      try {
        await this.runPollCycle();
      } catch (error) {
        logger.error({ error, providerId: this.providerId }, 'Error during IMAP poll cycle');
      }
      this.startPolling();
    }, this.pollingIntervalMs);

    if (this.pollTimer) {
      this.pollTimer.unref?.();
    }
  }

  private async runPollCycle(): Promise<void> {
    const imap = await this.connectAndOpenInbox();
    if (!imap) return;

    try {
      await this.ensureProcessedFolder(imap);
      await this.processMessages(imap);
    } catch (error) {
      logger.error({ error, providerId: this.providerId }, 'Failed to process messages');
    } finally {
      this.disconnect(imap);
    }
  }

  private async connectAndOpenInbox(): Promise<ImapConnection | null> {
    try {
      const useOAuth2 = this.oauth2AccessToken != null && this.oauth2AccessToken.length > 0;

      const imapOpts: ImapConnection.Config = {
        user: this.imapUser,
        password: this.imapPass,
        host: this.imapHost,
        port: this.imapPort,
        tls: this.imapSecure,
        tlsOptions: {
          servername: this.imapHost,
        },
      };

      if (useOAuth2) {
        imapOpts.xoauth2 = Buffer.from(
          `user=${this.imapUser}\x01auth=Bearer ${this.oauth2AccessToken}\x01\x01`,
          'utf-8',
        ).toString('base64');
      }

      const imap = new ImapConnection(imapOpts);

      await new Promise<void>((resolve, reject) => {
        imap.once('ready', () => resolve());
        imap.once('error', reject);
        imap.connect();
      });

      logger.info(
        { providerId: this.providerId, host: this.imapHost, authMethod: useOAuth2 ? 'XOAUTH2' : 'password' },
        'IMAP connected',
      );

      await new Promise<void>((resolve, reject) => {
        imap.openBox('INBOX', false, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      logger.info({ providerId: this.providerId }, 'INBOX opened');
      return imap;
    } catch (error) {
      logger.error({ error, providerId: this.providerId, host: this.imapHost }, 'IMAP connection failed');
      return null;
    }
  }

  private disconnect(imap: ImapConnection): void {
    try {
      imap.end();
      logger.info({ providerId: this.providerId }, 'IMAP disconnected');
    } catch (error) {
      logger.warn({ error, providerId: this.providerId }, 'Error during IMAP disconnect');
    }
  }

  private async processMessages(imap: ImapConnection): Promise<void> {
    const results = await new Promise<any[]>((resolve, reject) => {
      imap.search(['ALL'], (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });

    logger.info(
      { providerId: this.providerId, resultCount: results.length, results: JSON.stringify(results) },
      'IMAP: search results received',
    );

    if (results.length === 0) return;

    for (const result of results) {
      if (this.shouldStop) break;
      const uid = typeof result === 'number' ? result : result.attr;
      if (!uid) continue;

      logger.info({ providerId: this.providerId, uid }, 'IMAP: iterating result');
      await this.fetchAndProcessMessage(imap, uid);
    }
  }

  private async fetchAndProcessMessage(imap: ImapConnection, uid: number): Promise<void> {
    if (this.shouldStop) return;

    try {
      logger.info({ providerId: this.providerId, uid }, 'IMAP: fetching message');
      const fetch = imap.fetch([uid], { bodies: '' });

      const source = await new Promise<string>((resolve, reject) => {
        let data = '';
        fetch.on('message', (msg) => {
          msg.on('body', (stream) => {
            stream.on('data', (chunk) => {
              data += chunk.toString('utf8');
            });
            stream.on('end', () => {
              logger.info({ providerId: this.providerId, uid, sourceLength: data.length }, 'IMAP: message body received');
            });
          });
          msg.on('end', () => {
            resolve(data);
          });
        });
        fetch.on('error', reject);
      });

      if (!source) {
        logger.info({ providerId: this.providerId, uid }, 'IMAP: empty source, skipping');
        return;
      }

      logger.info(
        { providerId: this.providerId, uid, sourcePreview: source.substring(0, 200) },
        'IMAP: parsing email source',
      );
      const parsed = await simpleParser(source);
      const senderEmail = parsed.from?.value?.[0]?.address ?? parsed.from?.text ?? 'unknown';
      const rawBody = parsed.text?.trim() ?? parsed.textAsHtml?.trim() ?? parsed.html?.trim() ?? '';
      const emailBody = rawBody ? stripEmailQuotes(rawBody) : '';
      const subject = parsed.subject ?? '';

      const messageId = parsed.messageId || extractHeaderFromSource(source, 'Message-ID') || undefined;
      const inReplyTo = parsed.inReplyTo || extractHeaderFromSource(source, 'In-Reply-To') || undefined;
      const references = parsed.references || extractHeaderFromSource(source, 'References') || undefined;

      const recipientEmails = extractRecipientEmails(parsed.to?.value?.map((v) => v.address) ?? parsed.to?.text);

      logger.info(
        { providerId: this.providerId, uid, from: senderEmail, to: recipientEmails, subject, bodyLength: emailBody.length, messageId },
        'IMAP: parsed email',
      );

      if (!emailBody) {
        logger.info({ uid, providerId: this.providerId }, 'Empty email body, skipping');
        return;
      }

      if (!this.defaultProjectId) {
        logger.error({ uid, providerId: this.providerId }, 'No default projectId configured for provider');
        return;
      }

      const routing = resolveEmailRouting(this.emailToProject, recipientEmails, this.defaultProjectId, this.fromAddress);

      const apiKeyRecord = await findProjectApiKey(routing.projectId);
      if (!apiKeyRecord) {
        logger.warn(
          { uid, providerId: this.providerId, projectId: routing.projectId },
          'No API key found for routed project, skipping email',
        );
        return;
      }

      logger.info(
        {
          uid,
          from: senderEmail,
          to: recipientEmails,
          targetEmail: routing.targetEmail,
          projectId: routing.projectId,
          providerId: this.providerId,
        },
        'Processing inbound email',
      );

      const channelHost = container.resolve(SmtpImapChannelHost);
      await channelHost.handleInboundEmail(
        routing.projectId,
        apiKeyRecord.keySettings,
        this.fromAddress,
        routing.targetEmail,
        this.threadingStrategy,
        this.providerId,
        this.smtpHost,
        this.smtpPort,
        this.smtpSecure,
        this.smtpAuthUser,
        this.smtpAuthPass,
        senderEmail,
        emailBody,
        subject,
        messageId,
        inReplyTo,
        references,
        routing.stageId,
        routing.agentId,
        routing.cc,
        routing.bcc,
        routing.fromAddress,
        () => this.moveMessage(imap, uid, this.processedFolder),
        this.ccBccReplyAsHandOff,
        this.processingDelayMinMs,
        this.processingDelayMaxMs,
      );

      // Move the email to the processed folder immediately after handling.
      // This prevents duplicate processing on the next IMAP poll cycle when
      // processing deferral is active (the email would otherwise stay in the
      // inbox until the AI response is sent, getting re-queued every 30s).
      await this.moveMessage(imap, uid, this.processedFolder);

    } catch (error) {
      logger.error({ error, uid, providerId: this.providerId }, 'Failed to process email');
    }
  }

  private moveMessage(imap: ImapConnection, uid: number, folder: string): Promise<void> {
    return new Promise((resolve) => {
      try {
        (imap as any).move([uid], folder, (err: Error | null) => {
          if (err) {
            logger.error({ error: err, uid, folder, providerId: this.providerId }, 'Failed to move message to processed folder');
            resolve();
            return;
          }
          logger.info({ uid, folder, providerId: this.providerId }, 'Message moved to processed folder');
          resolve();
        });
      } catch (error) {
        logger.error({ error, uid, folder, providerId: this.providerId }, 'Exception during message move');
        resolve();
      }
    });
  }

  private async ensureProcessedFolder(imap: ImapConnection): Promise<void> {
    if (!this.processedFolder) return;

    const folders = await new Promise<string[]>((resolve, reject) => {
      imap.getBoxes((err: Error | null, boxes: ImapConnection.MailBoxes) => {
        if (err) reject(err);
        else resolve(Object.keys(boxes));
      });
    }).catch((error) => {
      logger.warn({ error, providerId: this.providerId }, 'Failed to list IMAP folders');
      return [];
    });

    if (!folders.length) return;

    const exists = folders.some((f) => f.toLowerCase() === this.processedFolder!.toLowerCase());
    if (exists) return;

    const separator = '/' as const;
    const parts = this.processedFolder.split(separator).filter(Boolean);

    let current = '';
    for (const part of parts) {
      current = current ? `${current}${separator}${part}` : part;
      const alreadyExists = folders.some((f) => f.toLowerCase() === current.toLowerCase());
      if (alreadyExists) continue;

      try {
        await new Promise<void>((resolve, reject) => {
          imap.addBox(current, (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          });
        });
        logger.info({ folder: current, providerId: this.providerId }, 'Created IMAP folder');
      } catch {
        return;
      }
    }
  }

  private clearPollTimer(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  public stop(): void {
    this.shouldStop = true;
    this.clearPollTimer();
    logger.info({ providerId: this.providerId }, 'IMAP session stopped');
  }
}

async function resolveOAuth2RefreshService(): Promise<{ refreshProvider: (id: string) => Promise<void> }> {
  const mod = await import('./OAuth2TokenRefreshService');
  return container.resolve(mod.OAuth2TokenRefreshService);
}

async function findProjectApiKey(projectId: string): Promise<{ key: string; keySettings: Record<string, unknown> | null } | null> {
  const keys = await db.select().from(apiKeys).where(eq(apiKeys.projectId, projectId));

  const activeKey = keys.find((k) => k.isActive);
  if (activeKey) {
    return {
      key: activeKey.key,
      keySettings: activeKey.keySettings ?? null,
    };
  }
  return null;
}

@singleton()
export class ImapInboundService {
  private sessions: Map<string, ImapMailboxSession> = new Map();
  private isStarted = false;

  constructor(
    @inject(SecretRefUtils) private readonly secretRefUtils: SecretRefUtils,
  ) {}

  start(): void {
    if (this.isStarted) {
      logger.warn('ImapInboundService already started');
      return;
    }
    this.isStarted = true;
    logger.info('Starting ImapInboundService');
    this.discoverAndStart().catch((error) => {
      logger.error({ error }, 'Failed to discover IMAP providers');
    });
  }

  stop(): void {
    this.isStarted = false;
    for (const session of this.sessions.values()) {
      session.stop();
    }
    this.sessions.clear();
    logger.info('ImapInboundService stopped');
  }

  stopSession(providerId: string): void {
    if (!this.isStarted) return;

    const existing = this.sessions.get(providerId);
    if (existing) {
      existing.stop();
      this.sessions.delete(providerId);
      logger.info({ providerId }, 'IMAP session stopped');
    }
  }

  async reload(providerId: string): Promise<void> {
    if (!this.isStarted) return;

    this.stopSession(providerId);

    const provider = await db.query.providers.findFirst({
      where: eq(providers.id, providerId),
    });

    if (!provider || provider.apiType !== 'smtp_imap') {
      logger.warn({ providerId }, 'Provider not found or not smtp_imap, skipping reload');
      return;
    }

    const rawConfig = await this.secretRefUtils.resolveObject(provider.config as Record<string, unknown>);
    const configResult = smtpImapChannelProviderConfigSchema.safeParse(rawConfig);

    if (!configResult.success) {
      logger.warn({ providerId, issues: configResult.error.issues }, 'SMTP/IMAP provider config invalid, skipping reload');
      return;
    }

    const config = configResult.data;

    if (config.oauth2?.accessToken && config.oauth2.accessTokenExpiry && Date.now() >= config.oauth2.accessTokenExpiry) {
      logger.info({ providerId }, 'IMAP reload: OAuth2 token expired, refreshing inline');
      await (await resolveOAuth2RefreshService()).refreshProvider(providerId);
      return;
    }

    if (!config.projectId && !config.emailToProject) {
      logger.warn({ providerId }, 'SMTP/IMAP provider has neither projectId nor emailToProject, skipping reload');
      return;
    }

    this.startSession(provider.id, config);
    logger.info({ providerId }, 'IMAP session reloaded with updated config');
  }

  private async discoverAndStart(): Promise<void> {
    try {
      const providerRecords = await db.query.providers.findMany({
        where: and(
          eq(providers.providerType, 'channel'),
        ),
      });

      const smtpImapProviders = providerRecords.filter((p) => p.apiType === 'smtp_imap');

      for (const provider of smtpImapProviders) {
        const rawConfig = await this.secretRefUtils.resolveObject(provider.config as Record<string, unknown>);
        const configResult = smtpImapChannelProviderConfigSchema.safeParse(rawConfig);

        if (!configResult.success) {
          logger.warn({ providerId: provider.id, issues: configResult.error.issues }, 'SMTP/IMAP provider config invalid, skipping');
          continue;
        }

        const config = configResult.data;

        if (config.oauth2?.accessToken && config.oauth2.accessTokenExpiry && Date.now() >= config.oauth2.accessTokenExpiry) {
          logger.info({ providerId: provider.id }, 'IMAP discovery: OAuth2 token expired, refreshing inline');
          await (await resolveOAuth2RefreshService()).refreshProvider(provider.id);
          continue;
        }

        if (!config.projectId && !config.emailToProject) {
          logger.warn({ providerId: provider.id }, 'SMTP/IMAP provider has neither projectId nor emailToProject, skipping');
          continue;
        }

        this.startSession(provider.id, config);
      }
    } catch (error) {
      logger.error({ error }, 'Error during IMAP provider discovery');
    }
  }

  private startSession(providerId: string, config: ReturnType<typeof smtpImapChannelProviderConfigSchema.parse>): void {
    const session = new ImapMailboxSession(
      providerId,
      config.projectId,
      config.imap.host,
      config.imap.port,
      config.imap.secure,
      config.imap.auth.user,
      config.imap.auth.pass,
      config.imap.pollingIntervalMs,
      config.fromAddress,
      config.threadingStrategy,
      config.smtp.host,
      config.smtp.port,
      config.smtp.secure,
      config.smtp.auth.user,
      config.smtp.auth.pass,
      config.emailToProject,
      config.oauth2?.accessToken,
      config.processedFolder,
      config.ccBccReplyAsHandOff,
      config.processingDelayMinMs,
      config.processingDelayMaxMs,
    );

    this.sessions.set(providerId, session);
    session.startPolling();
    logger.info({ providerId, intervalMs: config.imap.pollingIntervalMs }, 'IMAP polling started');
  }
}
