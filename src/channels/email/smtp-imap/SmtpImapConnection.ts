import { eq } from 'drizzle-orm';
import { container } from 'tsyringe';
import type { Session, SessionManager } from '../../SessionManager';
import type { CALOutputMessage } from '../../messages';
import * as nodemailer from 'nodemailer';
import { db } from '../../../db';
import { providers } from '../../../db/schema';
import { EmailConnectionBase, type EmailHeaders } from '../shared/EmailConnectionBase';
import { extractDomainFromEmail, generateEmailMessageId } from '../shared/MessageIdUtils';
import { logger } from '../../../utils/logger';
import { smtpImapChannelProviderConfigSchema } from '../../../services/providers/channel/SmtpImapChannelProvider';

export class SmtpImapConnection extends EmailConnectionBase {
  readonly connectionType = 'smtp_imap' as const;

  private transporter: nodemailer.Transporter | null = null;
  private readonly smtpAuthUser: string;
  private readonly smtpHost: string;
  private readonly smtpPort: number;
  private readonly smtpSecure: boolean;
  private conversationId: string | undefined;
  private inboundMessageId: string | undefined;
  private referencesChain: string[] = [];
  private skipNextEmail = false;
  private cachedOAuth2Token: string | undefined;

  constructor(
    private readonly toAddress: string,
    fromAddress: string,
    threadingStrategy: 'messageId' | 'senderSubject',
    sessionManager: SessionManager,
    private readonly subject: string,
    private readonly providerId: string,
    smtpHost: string,
    smtpPort: number,
    smtpSecure: boolean,
    smtpAuthUser: string,
    private readonly smtpAuthPass: string,
  ) {
    super(fromAddress, threadingStrategy, sessionManager, 'smtp_imap');
    this.smtpAuthUser = smtpAuthUser;
    this.smtpHost = smtpHost;
    this.smtpPort = smtpPort;
    this.smtpSecure = smtpSecure;
  }

  private createTransporter(oauth2Token?: string): void {
    const isOAuth2 = !!oauth2Token;
    const transporterConfig: Record<string, unknown> = {
      host: this.smtpHost,
      port: this.smtpPort,
      secure: this.smtpSecure,
      connectionTimeout: 30000,
      socketTimeout: 30000,
      auth: isOAuth2
        ? {
            type: 'OAuth2',
            user: this.smtpAuthUser,
            accessToken: oauth2Token,
          }
        : {
            user: this.smtpAuthUser,
            pass: this.smtpAuthPass,
          },
    };
    logger.info({ host: this.smtpHost, port: this.smtpPort, secure: this.smtpSecure, authType: isOAuth2 ? 'OAuth2' : 'LOGIN' }, 'SMTP/IMAP: creating transporter');
    this.transporter = nodemailer.createTransport(transporterConfig as nodemailer.TransportOptions);
  }

  private async ensureTransporter(): Promise<void> {
    if (this.transporter && !this.cachedOAuth2Token) {
      return;
    }

    const provider = await db.query.providers.findFirst({
      where: eq(providers.id, this.providerId),
    });

    if (!provider) {
      if (!this.transporter) {
        this.createTransporter();
      }
      return;
    }

    const { SecretRefUtils } = await import('../../../services/secrets/SecretRefUtils');
    const secretRefUtils = container.resolve(SecretRefUtils);
    const rawConfig = await secretRefUtils.resolveObject(provider.config as Record<string, unknown>);
    const configResult = smtpImapChannelProviderConfigSchema.safeParse(rawConfig);

    if (!configResult.success) {
      if (!this.transporter) {
        this.createTransporter();
      }
      return;
    }

    const newToken = configResult.data.oauth2?.accessToken;

    if (newToken !== this.cachedOAuth2Token) {
      this.cachedOAuth2Token = newToken;
      this.createTransporter(newToken);
    }
  }

  async verifyConnection(): Promise<void> {
    await this.ensureTransporter();
    if (!this.transporter) {
      throw new Error('SMTP transporter not initialized');
    }
    try {
      await this.transporter.verify();
      logger.info({ to: this.toAddress }, 'SMTP/IMAP: transporter verified successfully');
    } catch (error) {
      logger.error({ error, to: this.toAddress }, 'SMTP/IMAP: transporter verification failed');
      throw error;
    }
  }

  setConversationId(id: string): void {
    this.conversationId = id;
  }

 setInboundMessageId(id: string): void {
      this.inboundMessageId = id || undefined;
    }

    setReferencesChain(references: string | string[]): void {
      if (references) {
        this.referencesChain = Array.isArray(references) ? references.filter(Boolean) : references.split(/\s+/).filter(Boolean);
      }
    }

  setSkipNextEmail(skip: boolean): void {
    this.skipNextEmail = skip;
  }

  attachSession(session: Session): void {
    this.session = session;
  }

  protected getRecipientAddress(): string {
    return this.toAddress;
  }

  protected getChannelLabel(): string {
    return 'SMTP/IMAP';
  }

  async sendMessage(msg: CALOutputMessage): Promise<void> {
    if (msg.type !== 'end_ai_generation_output') return;

    const body = msg.fullText?.trim();
    if (!body) return;

    if (this.skipNextEmail) {
      this.skipNextEmail = false;
      return;
    }

    const headers: EmailHeaders = {};
    const convId = this.conversationId ?? this.session?.conversationId;
    if (convId) {
      headers.messageId = generateEmailMessageId(convId, extractDomainFromEmail(this.fromAddress));
    }

    if (this.inboundMessageId) {
      headers.inReplyTo = this.inboundMessageId;
      const existingRefs = this.referencesChain.filter((r) => r !== this.inboundMessageId);
      this.referencesChain = [...existingRefs, this.inboundMessageId];
      headers.references = this.referencesChain.join(' ');
    }

    await this.sendEmail(this.toAddress, this.subject, body, headers);
  }

  protected async sendEmail(to: string, subject: string, body: string, headers?: EmailHeaders): Promise<void> {
    await this.ensureTransporter();
    const messageId = headers?.messageId ?? this.generateMessageId();
    const from = headers?.from ?? this.fromAddress ?? this.smtpAuthUser;

    const mailOptions: nodemailer.SendMailOptions = {
      from,
      to,
      subject: headers?.subject ?? subject,
      text: body,
      headers: {},
    };

    (mailOptions.headers as Record<string, string>)['Message-ID'] = messageId;
    if (headers?.inReplyTo) {
      (mailOptions.headers as Record<string, string>)['In-Reply-To'] = headers.inReplyTo;
    }
    if (headers?.references) {
      (mailOptions.headers as Record<string, string>)['References'] = headers.references;
    }

    if (!this.transporter) {
      logger.error({ to }, 'SMTP/IMAP: transporter not initialized');
      return;
    }
    try {
      const info = await this.transporter.sendMail(mailOptions);
      logger.info({ to, messageId, sessionId: this.session?.id, messageIdRemote: info.messageId }, 'SMTP/IMAP email sent');
    } catch (error) {
      logger.error({ error, to, messageId, sessionId: this.session?.id }, 'Failed to send SMTP/IMAP email');
    }
  }
}
