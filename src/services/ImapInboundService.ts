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

type MailboxState = 'disconnected' | 'connecting' | 'polling' | 'searching';

function extractHeaderFromSource(source: string, headerName: string): string | undefined {
  const headerSection = source.split(/\r?\n\r?\n/)[0];
  const match = headerSection.match(new RegExp(`${headerName}:\\s*(.+)$`, 'im'));
  return match ? match[1].trim() : undefined;
}

class ImapMailboxSession {
  public state: MailboxState = 'disconnected';
  public imap: ImapConnection | null = null;
  private processedUids = new Set<number>();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private consecutiveErrors = 0;
  public shouldStop = false;
  private channelHostRef: SmtpImapChannelHost | null = null;

  constructor(
    public readonly providerId: string,
    public readonly projectId: string,
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
    public readonly keySettings: Record<string, unknown> | null,
    public readonly oauth2AccessToken: string | undefined,
  ) {}

  public async connect(): Promise<void> {
    if (this.state !== 'disconnected') return;
    this.state = 'connecting';

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
        keepalive: true,
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

      this.imap = imap;
      this.consecutiveErrors = 0;
      logger.info({ providerId: this.providerId, host: this.imapHost, authMethod: useOAuth2 ? 'XOAUTH2' : 'password' }, 'IMAP connected');

      await this.openInbox();
    } catch (error) {
      this.state = 'disconnected';
      this.imap = null;
      logger.error({ error, providerId: this.providerId, host: this.imapHost }, 'IMAP connection failed');
      this.scheduleReconnect();
    }
  }

  private async openInbox(): Promise<void> {
    if (!this.imap || this.shouldStop) return;

    return new Promise<void>((resolve, reject) => {
      this.imap!.openBox('INBOX', false, (err) => {
        if (err) {
          logger.error({ error: err, providerId: this.providerId }, 'Failed to open INBOX');
          reject(err);
          return;
        }
        logger.info({ providerId: this.providerId }, 'INBOX opened');
        resolve();
      });
    });
  }

  public startWatching(channelHost: SmtpImapChannelHost): void {
    if (!this.imap || this.shouldStop) return;
    this.channelHostRef = channelHost;

    this.imap.on('error', (error) => {
      logger.error({ error, providerId: this.providerId }, 'IMAP connection error');
      this.state = 'disconnected';
      this.imap = null;
      this.scheduleReconnect();
    });

    this.imap.on('newmail', (count) => {
      logger.debug({ providerId: this.providerId, unseen: count }, 'New mail notification');
      if (this.channelHostRef) {
        this.processNewMessages(this.channelHostRef);
      }
    });

    this.imap.on('expunge', () => {
      logger.debug({ providerId: this.providerId }, 'IMAP expunge notification');
    });

    this.startPolling();
  }

  private startPolling(): void {
    if (this.shouldStop) return;
    this.state = 'polling';
    this.clearPollTimer();

    this.pollTimer = setTimeout(async () => {
      if (this.shouldStop) return;
      try {
        await this.processNewMessagesDirect();
      } catch (error) {
        logger.error({ error, providerId: this.providerId }, 'Error during IMAP polling');
      }
      this.startPolling();
    }, this.pollingIntervalMs);

    if (this.pollTimer) {
      this.pollTimer.unref?.();
    }
  }

  private async processNewMessages(channelHost: SmtpImapChannelHost): Promise<void> {
    if (!this.imap || this.shouldStop) return;
    this.clearPollTimer();

    try {
      await this.processNewMessagesDirect();
    } catch (error) {
      logger.error({ error, providerId: this.providerId }, 'Error processing new messages');
      this.state = 'disconnected';
      this.imap = null;
      this.scheduleReconnect();
    } finally {
      this.startPolling();
    }
  }

  private async processNewMessagesDirect(): Promise<void> {
    if (!this.imap || this.shouldStop) return;
    this.state = 'searching';

    try {
      logger.info({ providerId: this.providerId, processedCount: this.processedUids.size, state: this.state }, 'IMAP: starting search');
      const results = await new Promise<any[]>((resolve, reject) => {
        this.imap!.search(['UNSEEN'], (err, results) => {
          if (err) reject(err);
          else resolve(results);
        });
      });

      logger.info({ providerId: this.providerId, resultCount: results.length, results: JSON.stringify(results) }, 'IMAP: search results received');

      if (results.length === 0) return;

      for (const seqno of results) {
        if (this.shouldStop) break;
        const seq = typeof seqno === 'number' ? seqno : seqno.attr;
        if (!seq) continue;
        logger.info({ providerId: this.providerId, seqno: seq }, 'IMAP: iterating result');

        await this.fetchAndProcessMessage(seq);
      }
    } catch (error) {
      logger.error({ error, providerId: this.providerId }, 'Failed to search for new messages');
    } finally {
      if (!this.shouldStop) {
        this.state = 'polling';
      }
    }
  }

  private async fetchAndProcessMessage(seqno: number): Promise<void> {
    if (!this.imap || this.shouldStop) return;

    try {
      logger.info({ providerId: this.providerId, seqno }, 'IMAP: fetching message');
      const fetch = this.imap.fetch([seqno], { bodies: '' });

      const result = await new Promise<{ source: string; uid: number }>((resolve, reject) => {
        let source = '';
        let msgUid = 0;
        fetch.on('message', (msg, seq) => {
          msgUid = (msg as any).attr?.uid ?? seq;
          msg.on('body', (stream) => {
            stream.on('data', (chunk) => {
              source += chunk.toString('utf8');
            });
            stream.on('end', () => {
              logger.info({ providerId: this.providerId, uid: msgUid, sourceLength: source.length }, 'IMAP: message body received');
            });
          });
          msg.on('end', () => {
            resolve({ source, uid: msgUid });
          });
        });
        fetch.on('error', reject);
      });

      const { source, uid } = result;

      if (this.processedUids.has(uid)) {
        logger.info({ providerId: this.providerId, uid }, 'IMAP: already processed, skipping');
        return;
      }

      this.processedUids.add(uid);
      await markSeen(this.imap, uid).catch((error) => {
        logger.warn({ error, uid, providerId: this.providerId }, 'Failed to mark message as seen');
      });

      if (!source) {
        logger.info({ providerId: this.providerId, uid }, 'IMAP: empty source, skipping');
        return;
      }

      logger.info({ providerId: this.providerId, uid, sourcePreview: source.substring(0, 200) }, 'IMAP: parsing email source');
      const parsed = await simpleParser(source);
      const senderEmail = parsed.from?.value?.[0]?.address ?? parsed.from?.text ?? 'unknown';
      const emailBody = parsed.text?.trim() ?? parsed.textAsHtml?.trim() ?? parsed.html?.trim() ?? '';
      const subject = parsed.subject ?? '';

      const messageId = parsed.messageId || extractHeaderFromSource(source, 'Message-ID') || undefined;
      const inReplyTo = parsed.inReplyTo || extractHeaderFromSource(source, 'In-Reply-To') || undefined;
      const references = parsed.references || extractHeaderFromSource(source, 'References') || undefined;

      logger.info({ providerId: this.providerId, uid, from: senderEmail, subject, bodyLength: emailBody.length, messageId }, 'IMAP: parsed email');

      if (!emailBody) {
        logger.info({ uid, providerId: this.providerId }, 'Empty email body, skipping');
        this.processedUids.add(uid);
        return;
      }

      logger.info({
        uid,
        from: senderEmail,
        subject,
        providerId: this.providerId,
        projectId: this.projectId,
      }, 'Processing inbound email');

      const channelHost = container.resolve(SmtpImapChannelHost);
      await channelHost.handleInboundEmail(
        this.projectId,
        this.keySettings,
        this.fromAddress,
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
        undefined,
        undefined,
      );

      this.processedUids.add(uid);
      await markSeen(this.imap, uid).catch((error) => {
        logger.warn({ error, uid, providerId: this.providerId }, 'Failed to mark message as seen');
      });

    } catch (error) {
      logger.error({ error, seqno, providerId: this.providerId }, 'Failed to process email');
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.shouldStop) return;
    const delay = Math.min(1000 * Math.pow(2, this.consecutiveErrors), 300000);
    this.consecutiveErrors++;
    logger.info({ providerId: this.providerId, delay }, 'Scheduling IMAP reconnect');

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.shouldStop) {
        await this.connect();
        if (this.imap) {
          const channelHost = container.resolve(SmtpImapChannelHost);
          this.startWatching(channelHost);
        }
      }
    }, delay);

    if (this.reconnectTimer) {
      this.reconnectTimer.unref?.();
    }
  }

  private clearPollTimer(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  public async stop(): Promise<void> {
    this.shouldStop = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearPollTimer();

    if (this.imap) {
      this.imap.end();
      this.imap = null;
    }
    this.state = 'disconnected';
    logger.info({ providerId: this.providerId }, 'IMAP session stopped');
  }
}

async function markSeen(imap: ImapConnection, uid: number): Promise<void> {
  return new Promise((resolve, reject) => {
    imap.addFlags([uid], ['\\Seen'], (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function resolveOAuth2RefreshService(): Promise<{ refreshProvider: (id: string) => Promise<void> }> {
  const mod = await import('./OAuth2TokenRefreshService');
  return container.resolve(mod.OAuth2TokenRefreshService);
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
    this.discoverAndConnect().catch((error) => {
      logger.error({ error }, 'Failed to discover IMAP providers');
    });
  }

  stop(): void {
    this.isStarted = false;
    const promises: Promise<void>[] = [];
    for (const session of this.sessions.values()) {
      promises.push(session.stop());
    }
    Promise.allSettled(promises).then(() => {
      this.sessions.clear();
      logger.info('ImapInboundService stopped');
    });
  }

  async stopSession(providerId: string): Promise<void> {
    if (!this.isStarted) return;

    const existing = this.sessions.get(providerId);
    if (existing) {
      await existing.stop();
      this.sessions.delete(providerId);
      logger.info({ providerId }, 'IMAP session stopped');
    }
  }

  async reload(providerId: string): Promise<void> {
    if (!this.isStarted) return;

    await this.stopSession(providerId);

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

    const apiKeyRecord = await this.findProjectApiKey(config.projectId);
    if (!apiKeyRecord) {
      logger.warn({ providerId, projectId: config.projectId }, 'No API key found for project, skipping IMAP reload');
      return;
    }

    const session = new ImapMailboxSession(
      provider.id,
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
      apiKeyRecord.keySettings ?? null,
      config.oauth2?.accessToken,
    );

    this.sessions.set(provider.id, session);
    await session.connect();

    if (session.imap) {
      const channelHost = container.resolve(SmtpImapChannelHost);
      session.startWatching(channelHost);
      logger.info({ providerId }, 'IMAP session reloaded with updated config');
    }
  }

  private async discoverAndConnect(): Promise<void> {
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

        const apiKeyRecord = await this.findProjectApiKey(config.projectId);
        if (!apiKeyRecord) {
          logger.warn({ providerId: provider.id, projectId: config.projectId }, 'No API key found for project, skipping IMAP inbound');
          continue;
        }

        const session = new ImapMailboxSession(
          provider.id,
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
          apiKeyRecord.keySettings ?? null,
          config.oauth2?.accessToken,
        );

        this.sessions.set(provider.id, session);
        await session.connect();

        if (session.imap) {
          const channelHost = container.resolve(SmtpImapChannelHost);
          session.startWatching(channelHost);
        }
      }
    } catch (error) {
      logger.error({ error }, 'Error during IMAP provider discovery');
    }
  }

  private async findProjectApiKey(projectId: string): Promise<{ key: string; keySettings: Record<string, unknown> | null } | null> {
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
}
