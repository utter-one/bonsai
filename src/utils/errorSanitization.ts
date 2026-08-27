/**
 * Redaction of secret-shaped material from vendor error text before it is
 * returned to clients or persisted (TPC-01 guard, applied at the
 * provider_call_logs write layer and the connection-test response path).
 * Truncates to 500 chars.
 */

export const ERROR_TEXT_MAX_CHARS = 500;

const SECRET_NAME_ALT = 'api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|secret|token|authorization|password';
const SECRET_VALUE = '[A-Za-z0-9\\-._~+/=]{4,}';

/**
 * Redacts secret-shaped material from vendor error text. Order matters:
 * Bearer/Basic first, then JWT-shaped tokens, then key/token/secret
 * assignments (`key=value`, `key: "value"`, and space-separated quoted
 * `key "value"`). `Bearer`/`Basic` themselves are never consumed as
 * assignment values, so `Authorization: Bearer <token>` keeps its shape
 * with the token redacted.
 */
export function sanitizeErrorText(text: string): string {
  let out = text.replace(/\bBearer\s+[A-Za-z0-9\-._~+/=]+/gi, 'Bearer [REDACTED]');
  out = out.replace(/\bBasic\s+[A-Za-z0-9+/=]{8,}/gi, 'Basic [REDACTED]');
  out = out.replace(/\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, '[REDACTED]');
  const assignment = new RegExp(`\\b(${SECRET_NAME_ALT})(\\s*[:=]\\s*)(["']?)(?!(?:Bearer|Basic)\\b)(${SECRET_VALUE})\\3`, 'gi');
  out = out.replace(assignment, '$1$2[REDACTED]');
  const quoted = new RegExp(`\\b(${SECRET_NAME_ALT})(\\s+)(["'])(${SECRET_VALUE})\\3`, 'gi');
  out = out.replace(quoted, '$1 [REDACTED]');
  return out.slice(0, ERROR_TEXT_MAX_CHARS);
}
