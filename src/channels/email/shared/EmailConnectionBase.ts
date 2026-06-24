import { randomBytes } from 'crypto';
import type { CALOutputMessage } from '../../messages';
import type { Session, SessionManager } from '../../SessionManager';
import type { IClientConnection } from '../../IClientConnection';
import { extractDomainFromEmail } from './MessageIdUtils';
import { logger } from '../../../utils/logger';

export type ThreadingStrategy = 'messageId' | 'senderSubject';

export interface EmailHeaders {
  from?: string;
  to?: string;
  subject?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  [key: string]: string | undefined;
}

export abstract class EmailConnectionBase implements IClientConnection {
  readonly connectionType: 'sendgrid' | 'ses' | 'smtp_imap';

  protected session: Session;
  private readonly threadHeaders = new Map<string, { inReplyTo?: string; references?: string }>();

  constructor(
    protected readonly fromAddress: string,
    protected readonly threadingStrategy: ThreadingStrategy,
    protected readonly sessionManager: SessionManager,
    connectionType: 'sendgrid' | 'ses' | 'smtp_imap',
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
    if (msg.type !== 'end_ai_generation_output') return;

    const body = msg.fullText?.trim();
    if (!body) return;

    logger.info({ to: this.getRecipientAddress(), sessionId: this.session?.id, channel: this.connectionType }, `${this.getChannelLabel()} email sent`);
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

  /** Sends an email via the provider API. Override in subclasses. */
  protected abstract sendEmail(to: string, subject: string, body: string, headers?: EmailHeaders): Promise<void>;
}
