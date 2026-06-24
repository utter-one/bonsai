import { randomBytes } from 'crypto';

/**
 * Extracts the domain from an email address.
 */
export function extractDomainFromEmail(email?: string): string | undefined {
  if (!email) return undefined;
  const parts = email.split('@');
  return parts.length === 2 ? parts[1] : undefined;
}

/**
 * Generates a unique Message-ID for an email.
 *
 * When a conversation ID is provided, the format is:
 *   <{uuid}.{timestamp}@domain>
 * where {uuid} is the conversation ID without the "conv_" prefix,
 * and {timestamp} is Date.now() in base-36 to ensure uniqueness per message.
 *
 * Falls back to a random ID if no conversation ID is provided.
 * Uses the given domain, or `bonsai.ai` as a last resort.
 */
export function generateEmailMessageId(conversationId?: string, domain?: string): string {
  const fallbackDomain = domain || 'bonsai.ai';

  if (conversationId) {
    const id = conversationId.replace(/^conv_/, '').replace(/-/g, '');
    const timestamp = Date.now().toString(36);
    return `<${id}.${timestamp}@${fallbackDomain}>`;
  }

  return `<${randomBytes(16).toString('hex')}@${fallbackDomain}>`;
}

/**
 * Extracts a conversation ID from a single Message-ID token.
 * Handles with/without angle brackets, with/without timestamp suffix.
 */
function parseSingleMessageId(token: string): string | undefined {
  const trimmed = token.trim();
  const stripped = trimmed.replace(/^<?|>?$/g, '').trim();

  const match = stripped.match(/^([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.[^@]*)?@.+/i);
  if (match) {
    const uuid = match[1].replace(/-/g, '');
    const formatted = `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`;
    return `conv_${formatted}`;
  }

  const legacyMatch = stripped.match(/^conv_([0-9a-f-]+)@.+/i);
  if (legacyMatch) return `conv_${legacyMatch[1]}`;

  return undefined;
}

/**
 * Extracts the conversation ID from a Message-ID or In-Reply-To header.
 *
 * Handles both legacy format (<conv_xxx@domain>) and compact UUID format
 * (<uuid32@domain>) with any domain. Tolerates missing angle brackets,
 * extra whitespace, and multiple Message-IDs.
 */
export function extractConversationIdFromMessageId(header?: string): string | undefined {
  if (!header) return undefined;

  const tokens = header.split(/\s+/);
  for (const token of tokens) {
    const result = parseSingleMessageId(token);
    if (result) return result;
  }

  return undefined;
}

/**
 * Extracts a conversation ID from a References header (space-separated list of Message-IDs).
 * Returns the first match found.
 */
export function extractConversationIdFromReferences(header?: string | string[]): string | undefined {
  if (!header) return undefined;
  const parts = Array.isArray(header) ? header : header.split(/\s+/);
  for (const part of parts) {
    const result = parseSingleMessageId(part);
    if (result) return result;
  }
  return undefined;
}
