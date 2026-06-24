import { createHash } from 'crypto';

export type ThreadingStrategy = 'messageId' | 'senderSubject';

/** Parsed email headers for thread resolution. */
export interface EmailHeadersInput {
  from: string;
  subject?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
}

/**
 * Resolves a stable thread key from inbound email metadata.
 *
 * Two strategies are supported:
 * - `messageId` (default): walks the In-Reply-To/References chain to find the root Message-ID,
 *   falling back to the incoming Message-ID for new threads.
 * - `senderSubject`: produces a hash of normalized sender + subject for grouping by topic.
 */
export class ThreadIdResolver {
  constructor(private readonly strategy: ThreadingStrategy) {}

  /** Extracts a thread ID from email headers using the configured strategy. */
  resolve(headers: EmailHeadersInput): string {
    switch (this.strategy) {
      case 'messageId':
        return this.resolveByMessageId(headers);
      case 'senderSubject':
        return this.resolveBySenderSubject(headers);
      default:
        return this.resolveByMessageId(headers);
    }
  }

  /**
   * Walks the In-Reply-To/References chain to find the root Message-ID.
   * Falls back to the incoming Message-ID when no chain exists (new thread).
   */
  private resolveByMessageId(headers: EmailHeadersInput): string {
    if (headers.inReplyTo) {
      const rootId = this.extractRootMessageId(headers.inReplyTo, headers.references);
      if (rootId) return `thread_${this.hashId(rootId)}`;
    }

    if (headers.messageId) {
      return `thread_${this.hashId(headers.messageId)}`;
    }

    return `thread_fallback_${Date.now()}`;
  }

  /**
   * Produces a deterministic hash from normalized sender + subject.
   */
  private resolveBySenderSubject(headers: EmailHeadersInput): string {
    const normalized = [
      headers.from.trim().toLowerCase(),
      (headers.subject ?? '').trim().toLowerCase(),
    ].join('|');

    return `thread_${this.hashId(normalized)}`;
  }

  /** Extracts the root Message-ID from a chain of In-Reply-To and References headers. */
  private extractRootMessageId(inReplyTo: string, references?: string): string | null {
    const ids = this.extractMessageIds(inReplyTo);
    const refIds = references ? this.extractMessageIds(references) : [];

    if (refIds.length > 0) {
      return refIds[0] || null;
    }

    return ids[0] || null;
  }

  /** Extracts Message-IDs from a header value (may contain multiple space-separated IDs). */
  private extractMessageIds(headerValue: string): string[] {
    return headerValue
      .split(/\s+/)
      .map((id) => id.replace(/^<|>$/g, '').trim())
      .filter(Boolean);
  }

  /** Produces a short SHA-256 hash of the input string. */
  private hashId(input: string): string {
    return createHash('sha256').update(input).digest('hex').substring(0, 16);
  }
}
