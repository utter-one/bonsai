import type { Session, SessionManager } from '../../SessionManager';
import type { CALOutputMessage, CALAttachFileOutputMessage } from '../../messages';
import { MailService } from '@sendgrid/mail';
import { EmailConnectionBase, type EmailAttachment, type EmailHeaders } from '../shared/EmailConnectionBase';
import { extractDomainFromEmail, generateEmailMessageId } from '../shared/MessageIdUtils';
import { logger } from '../../../utils/logger';

export class SendGridConnection extends EmailConnectionBase {
  readonly connectionType = 'sendgrid' as const;

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
    private readonly apiKey: string,
    cc: string | undefined,
    bcc: string | undefined,
  ) {
    super(fromAddress, threadingStrategy, sessionManager, 'sendgrid');
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
    return 'SendGrid';
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
    const sg = new MailService();
    sg.setApiKey(this.apiKey);

    const messageId = headers?.messageId ?? this.generateMessageId();

    const customArgs: Record<string, string> = { 'X-Message-ID': messageId };
    if (headers?.inReplyTo) customArgs['X-In-Reply-To'] = headers.inReplyTo;
    if (headers?.references) customArgs['X-References'] = headers.references;

    const resolvedCc = headers?.cc ?? this.cc;
    const resolvedBcc = headers?.bcc ?? this.bcc;

    await sg.send({
      to: [{ email: to }],
      from: { email: headers?.from ?? this.fromAddress },
      subject: headers?.subject ?? subject,
      text: body,
      customArgs,
      cc: resolvedCc ? [resolvedCc] : undefined,
      bcc: resolvedBcc ? [resolvedBcc] : undefined,
      attachments: attachments.length > 0 ? attachments.map(att => ({
        content: att.content.toString('base64'),
        filename: att.fileName,
        type: att.mimeType,
      })) : undefined,
    });
    logger.info({ to, sessionId: this.session?.id, attachmentCount: attachments.length }, 'SendGrid email sent');
  }
}
