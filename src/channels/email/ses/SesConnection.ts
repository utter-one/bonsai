import type { Session, SessionManager } from '../../SessionManager';
import type { CALOutputMessage, CALAttachFileOutputMessage } from '../../messages';
import { SESClient, SendRawEmailCommand } from '@aws-sdk/client-ses';
import { EmailConnectionBase, type EmailAttachment, type EmailHeaders } from '../shared/EmailConnectionBase';
import { extractDomainFromEmail, generateEmailMessageId } from '../shared/MessageIdUtils';
import { logger } from '../../../utils/logger';

export class SesConnection extends EmailConnectionBase {
  readonly connectionType = 'ses' as const;

  private sesClient: SESClient;
  private cc: string | undefined;
  private bcc: string | undefined;
  private conversationId: string | undefined;
  private userEmail: string | undefined;
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
    cc: string | undefined,
    bcc: string | undefined,
  ) {
    super(fromAddress, threadingStrategy, sessionManager, 'ses');
    this.sesClient = new SESClient({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
    this.cc = cc;
    this.bcc = bcc;
  }

  setConversationId(id: string): void {
    this.conversationId = id;
  }

  setInboundMessageId(id: string): void {
    this.inboundMessageId = id || undefined;
  }

  setCc(cc: string | undefined): void {
    this.cc = cc;
  }

  setBcc(bcc: string | undefined): void {
    this.bcc = bcc;
  }

  setSkipNextEmail(skip: boolean): void {
    this.skipNextEmail = skip;
  }

  setUserEmail(email: string): void {
    this.userEmail = email;
  }

  getUserEmail(): string | undefined {
    return this.userEmail;
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
    if (msg.type === 'attach_file_output') {
      this.bufferAttachment(msg as CALAttachFileOutputMessage);
      return;
    }

    if (msg.type !== 'end_ai_generation_output') return;

    const body = msg.fullText?.trim();
    if (!body) return;

    if (this.skipNextEmail) {
      this.skipNextEmail = false;
      this.pendingAttachments = [];
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

    const attachments = await this.downloadPendingAttachments();
    this.pendingAttachments = [];

    await this.sendEmail(this.toAddress, this.subject, body, attachments, headers);
  }

  protected async sendEmail(to: string, subject: string, body: string, attachments: EmailAttachment[], headers?: EmailHeaders): Promise<void> {
    const messageId = headers?.messageId ?? this.generateMessageId();
    const rawEmail = this.buildRawEmail(
      headers?.from ?? this.fromAddress,
      to,
      headers?.subject ?? subject,
      body,
      messageId,
      headers?.inReplyTo,
      headers?.references,
      headers?.cc ?? this.cc,
      headers?.bcc ?? this.bcc,
      attachments,
    );

    const destinations = this.collectDestinations(to, headers?.cc, headers?.bcc ?? this.bcc);
    await this.sesClient.send(new SendRawEmailCommand({ RawMessage: { Data: rawEmail }, Destinations: destinations }));
    logger.info({ to, sessionId: this.session?.id, attachmentCount: attachments.length }, 'SES email sent');
  }

  private buildRawEmail(
    from: string,
    to: string,
    subject: string,
    body: string,
    messageId: string,
    inReplyTo?: string,
    references?: string,
    cc?: string,
    bcc?: string,
    attachments: EmailAttachment[] = [],
  ): Buffer {
    if (attachments.length === 0) {
      let raw = `From: ${from}\r\n`;
      raw += `To: ${to}\r\n`;
      raw += `Subject: ${subject}\r\n`;
      raw += `Message-ID: ${messageId}\r\n`;
      raw += `MIME-Version: 1.0\r\n`;
      raw += `Content-Type: text/plain; charset=UTF-8\r\n`;
      if (cc) raw += `Cc: ${cc}\r\n`;
      if (inReplyTo) raw += `In-Reply-To: ${inReplyTo}\r\n`;
      if (references) raw += `References: ${references}\r\n`;
      if (bcc) raw += `Bcc: ${bcc}\r\n`;
      raw += `\r\n${body}`;
      return Buffer.from(raw);
    }

    const boundary = `----=_Part_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    let raw = `From: ${from}\r\n`;
    raw += `To: ${to}\r\n`;
    raw += `Subject: ${subject}\r\n`;
    raw += `Message-ID: ${messageId}\r\n`;
      raw += `MIME-Version: 1.0\r\n`;
      raw += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n`;
      if (cc) raw += `Cc: ${cc}\r\n`;
      if (inReplyTo) raw += `In-Reply-To: ${inReplyTo}\r\n`;
      if (references) raw += `References: ${references}\r\n`;
      raw += `\r\n`;
      raw += `This is a multi-part message in MIME format.\r\n`;
    raw += `\r\n`;

    // Text part
    raw += `${boundary}\r\n`;
    raw += `Content-Type: text/plain; charset=UTF-8\r\n`;
    raw += `Content-Transfer-Encoding: 7bit\r\n`;
    raw += `\r\n`;
    raw += `${body}\r\n`;
    raw += `\r\n`;

    // Attachment parts
    for (const att of attachments) {
      const safeName = this.sanitizeFileName(att.fileName);
      raw += `${boundary}\r\n`;
      raw += `Content-Type: ${att.mimeType}; name="${safeName}"\r\n`;
      raw += `Content-Transfer-Encoding: base64\r\n`;
      raw += `Content-Disposition: attachment; filename="${safeName}"\r\n`;
      raw += `\r\n`;
      raw += att.content.toString('base64').match(/.{1,76}/g)?.join('\r\n') || att.content.toString('base64');
      raw += `\r\n`;
    }

    raw += `${boundary}--\r\n`;

    return Buffer.from(raw);
  }

  private collectDestinations(to: string, cc?: string, bcc?: string): string[] {
    const destinations = new Set<string>();
    destinations.add(to);
    if (cc) {
      for (const addr of cc.split(',')) {
        const email = addr.includes('<') ? addr.match(/<([^>]+)>/)?.[1] : addr.trim();
        if (email) destinations.add(email);
      }
    }
    if (bcc) {
      for (const addr of bcc.split(',')) {
        const email = addr.includes('<') ? addr.match(/<([^>]+)>/)?.[1] : addr.trim();
        if (email) destinations.add(email);
      }
    }
    return Array.from(destinations);
  }

  /** Removes CR/LF characters from filenames to prevent MIME header injection. */
  private sanitizeFileName(name: string): string {
    return name.replace(/[\r\n]/g, '');
  }
}
