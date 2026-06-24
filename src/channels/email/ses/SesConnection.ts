import type { Session, SessionManager } from '../../SessionManager';
import type { CALOutputMessage } from '../../messages';
import { SESClient, SendRawEmailCommand } from '@aws-sdk/client-ses';
import { EmailConnectionBase, type EmailHeaders } from '../shared/EmailConnectionBase';
import { extractDomainFromEmail, generateEmailMessageId } from '../shared/MessageIdUtils';
import { logger } from '../../../utils/logger';

export class SesConnection extends EmailConnectionBase {
  readonly connectionType = 'ses' as const;

  private sesClient: SESClient;
  private conversationId: string | undefined;
  private inboundMessageId: string | undefined;
  private skipNextEmail = false;

  constructor(
    private readonly toAddress: string,
    fromAddress: string,
    threadingStrategy: 'messageId' | 'senderSubject',
    sessionManager: SessionManager,
    private readonly subject: string,
    private readonly accessKeyId: string,
    private readonly secretAccessKey: string,
    private readonly region: string,
  ) {
    super(fromAddress, threadingStrategy, sessionManager, 'ses');
    this.sesClient = new SESClient({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  setConversationId(id: string): void {
    this.conversationId = id;
  }

  setInboundMessageId(id: string): void {
    this.inboundMessageId = id;
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
    return 'SES';
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
      headers.references = this.inboundMessageId;
    }

    await this.sendEmail(this.toAddress, this.subject, body, headers);
  }

  protected async sendEmail(to: string, subject: string, body: string, headers?: EmailHeaders): Promise<void> {
    const messageId = headers?.messageId ?? this.generateMessageId();
    const rawEmail = this.buildRawEmail(
      headers?.from ?? this.fromAddress,
      to,
      headers?.subject ?? subject,
      body,
      messageId,
      headers?.inReplyTo,
      headers?.references,
    );

    await this.sesClient.send(new SendRawEmailCommand({ RawMessage: { Data: rawEmail } }));
    logger.info({ to, sessionId: this.session?.id }, 'SES email sent');
  }

  private buildRawEmail(
    from: string,
    to: string,
    subject: string,
    body: string,
    messageId: string,
    inReplyTo?: string,
    references?: string,
  ): Buffer {
    let raw = `From: ${from}\r\n`;
    raw += `To: ${to}\r\n`;
    raw += `Subject: ${subject}\r\n`;
    raw += `Message-ID: ${messageId}\r\n`;
    raw += `MIME-Version: 1.0\r\n`;
    raw += `Content-Type: text/plain; charset=UTF-8\r\n`;
    if (inReplyTo) raw += `In-Reply-To: ${inReplyTo}\r\n`;
    if (references) raw += `References: ${references}\r\n`;
    raw += `\r\n${body}`;

    return Buffer.from(raw);
  }
}
