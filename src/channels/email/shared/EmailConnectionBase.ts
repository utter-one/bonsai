import { randomBytes } from 'crypto';
import type { CALOutputMessage, CALAttachFileOutputMessage } from '../../messages';
import type { Session, SessionManager } from '../../SessionManager';
import type { IClientConnection } from '../../IClientConnection';
import { extractDomainFromEmail } from './MessageIdUtils';
import { logger } from '../../../utils/logger';
import { getProviderCallRecorder } from '../../../services/monitoring/ProviderCallRecorder';

export type ThreadingStrategy = 'messageId' | 'senderSubject';

export interface EmailHeaders {
  from?: string;
  to?: string;
  subject?: string;
  cc?: string;
  bcc?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  [key: string]: string | undefined;
}

export interface EmailAttachment {
  content: Buffer;
  fileName: string;
  mimeType: string;
}

export abstract class EmailConnectionBase implements IClientConnection {
  readonly connectionType: 'sendgrid' | 'ses' | 'smtp_imap';

  protected session: Session;
  private readonly threadHeaders = new Map<string, { inReplyTo?: string; references?: string }>();
  /** Buffered file attachments collected from attach_file_output messages. Cleared after email send. */
  protected pendingAttachments: Array<{
    artifactId: string;
    fileName: string;
    mimeType: string;
    downloadUrl: string;
    sequenceNumber: number;
  }> = [];

  constructor(
    protected readonly fromAddress: string,
    protected readonly threadingStrategy: ThreadingStrategy,
    protected readonly sessionManager: SessionManager,
    connectionType: 'sendgrid' | 'ses' | 'smtp_imap',
    /** P1-03: provider id for call-log attribution (passed by the channel host). */
    protected readonly callLogProviderId?: string,
  ) {
    this.connectionType = connectionType;
  }

  attachSession(session: Session): void {
    this.session = session;
  }

  async close(): Promise<void> {
    await this.sessionManager.unregisterSession(this.session.id);
  }

  async sendMessage(msg: CALOutputMessage): Promise<void> {
    if (msg.type === 'attach_file_output') {
      this.bufferAttachment(msg as CALAttachFileOutputMessage);
      return;
    }

    if (msg.type !== 'end_ai_generation_output') return;

    const body = msg.fullText?.trim();
    if (!body) return;

    const attachments = await this.downloadPendingAttachments();
    this.pendingAttachments = [];

    logger.info({ to: this.getRecipientAddress(), sessionId: this.session?.id, channel: this.connectionType, attachmentCount: attachments.length }, `${this.getChannelLabel()} email sent`);
  }

  /** Buffers an attach_file_output message. Called by base and subclasses. */
  protected bufferAttachment(msg: CALAttachFileOutputMessage): void {
    this.pendingAttachments.push({
      artifactId: msg.artifactId,
      fileName: msg.fileName,
      mimeType: msg.mimeType,
      downloadUrl: msg.downloadUrl,
      sequenceNumber: msg.sequenceNumber,
    });
  }

  /**
   * Downloads all pending file attachments from their signed URLs.
   * Returns sorted by sequenceNumber. Attachments that fail to download are skipped with a warning.
   */
  protected async downloadPendingAttachments(): Promise<EmailAttachment[]> {
    if (this.pendingAttachments.length === 0) return [];

    const sorted = [...this.pendingAttachments].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    const results: EmailAttachment[] = [];

    for (const att of sorted) {
      try {
        const response = await fetch(att.downloadUrl, {
          signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) {
          response.body?.cancel();
          logger.warn({ artifactId: att.artifactId, fileName: att.fileName, status: response.status }, 'Failed to download email attachment');
          continue;
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        results.push({
          content: buffer,
          fileName: att.fileName,
          mimeType: att.mimeType,
        });
      } catch (error) {
        logger.error({ artifactId: att.artifactId, fileName: att.fileName, error: error instanceof Error ? error.message : String(error) }, 'Failed to download email attachment');
      }
    }

    return results;
  }

  /** Generates a RFC-compliant Message-ID. */
  protected generateMessageId(): string {
    const domain = extractDomainFromEmail(this.fromAddress) || 'bonsai.ai';
    const rand = randomBytes(16).toString('hex');
    return `<${rand}@${domain}>`;
  }

  /** Gets the recipient email address for this connection. Override in subclasses. */
  protected abstract getRecipientAddress(): string;

  /** Gets the channel label for logging. Override in subclasses. */
  protected abstract getChannelLabel(): string;

  /**
   * P1-03 template wrapper: records one channel.send call-log row per email send,
   * then delegates to the provider-specific implementation.
   *
   * Public (P2-02): the alert EmailNotifier reuses this as the raw-send entry
   * point for per-delivery connection instances — the call-log row is desired
   * so alert-mail provider failures feed provider-degraded.
   */
  public async sendEmail(to: string, subject: string, body: string, attachments: EmailAttachment[], headers?: EmailHeaders): Promise<void> {
    const startedAt = Date.now();
    try {
      await this.doSendEmail(to, subject, body, attachments, headers);
      this.recordEmailSend(Date.now() - startedAt, null);
    } catch (error) {
      this.recordEmailSend(Date.now() - startedAt, error);
      throw error;
    }
  }

  /** Sends an email via the provider API. Override in subclasses. */
  protected abstract doSendEmail(to: string, subject: string, body: string, attachments: EmailAttachment[], headers?: EmailHeaders): Promise<void>;

  /** P1-03: one channel.send call-log row per email send. Never throws. */
  private recordEmailSend(durationMs: number, error: unknown): void {
    if (!this.callLogProviderId) return;
    getProviderCallRecorder().record({
      providerId: this.callLogProviderId,
      providerType: 'channel',
      apiType: this.connectionType,
      operation: 'channel.send_message',
      durationMs,
      ok: error === null,
      error: error ?? undefined,
    });
  }
}
