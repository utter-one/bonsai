/**
 * Normalizes third-party SDK / network errors into a bounded errorCode enum.
 *
 * Pure and defensive (shape-based property checks, never throws): the same
 * function classifies OpenAI/Anthropic APIErrors, Twilio error responses,
 * AWS SDK v3 exceptions, Meta/FB Graph JSON errors, undici/fetch failures and
 * plain Node network errors. The resulting code drives provider_call_logs
 * rows, alerting and failover decisions (PROPOSAL §3.2a/§3.3/§3.4).
 */

export const THIRD_PARTY_ERROR_CODES = [
  'auth',
  'client_error',
  'rate_limited',
  'timeout',
  'network',
  'server_error',
  'unknown',
] as const;

export type ThirdPartyErrorCode = (typeof THIRD_PARTY_ERROR_CODES)[number];

export interface ClassifiedError {
  code: ThirdPartyErrorCode;
  statusHttp?: number;
}

/** Node/undici error codes that mean "the network path failed" (no HTTP response). */
const NETWORK_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
]);

/** undici timeout codes (connect/header/body) — classified as timeout, not network. */
const UNDICICI_TIMEOUT_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/** AWS SDK v3 exception names with stable semantics across services. */
const AWS_AUTH_NAMES = new Set([
  'UnrecognizedClientException',
  'InvalidClientTokenId',
  'AccessDeniedException',
  'InvalidSignatureException',
  'SignatureDoesNotMatch',
  'CredentialsExpireException',
]);

const AWS_RATE_LIMIT_NAMES = new Set([
  'ThrottlingException',
  'Throttling',
  'TooManyRequestsException',
  'RequestThrottledException',
  'BandwidthThrottledException',
]);

const AWS_SERVER_ERROR_NAMES = new Set([
  'RequestTimeoutException',
  'ServiceUnavailableException',
  'InternalServiceError',
  'RequestTimeout',
]);

/** Twilio numeric error codes (their HTTP status is not always set on the error). */
const TWILIO_AUTH_CODES = new Set([20003, 20037]);

/** Meta/FB Graph JSON error codes: token/auth problems. */
const FB_AUTH_CODES = new Set([1, 100, 102, 190, 200]);

/** Meta/FB Graph JSON error codes: rate limit family (user/app/temporary app limits). */
const FB_RATE_LIMIT_CODES = new Set([2, 4, 17, 32, 322, 80004, 1304764]);

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isHttpStatus(value: number | undefined): value is number {
  return value !== undefined && value >= 100 && value <= 599;
}

/**
 * Extracts an HTTP status from the SDK-specific shapes we integrate with:
 * OpenAI/Anthropic/Generic `.status`, Twilio `.statusCode`, AWS `. $metadata.httpStatusCode`,
 * axios-style `.response.status`.
 */
function extractStatus(err: Record<string, unknown>): number | undefined {
  const candidates = [
    toNumber(err.status),
    toNumber(err.statusCode),
    toNumber((err.$metadata as Record<string, unknown> | undefined)?.httpStatusCode),
    toNumber((err.response as Record<string, unknown> | undefined)?.status),
  ];
  for (const candidate of candidates) {
    if (isHttpStatus(candidate)) return candidate;
  }
  return undefined;
}

/** Maps an HTTP status to an errorCode. 404 is auth only with key-like semantics. */
function statusToCode(status: number, message: string): ThirdPartyErrorCode {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  if (status === 404) {
    // e.g. "The API key ... was not found" vs "model xyz not found"
    if (/(api[ _-]?key|credential|unrecognized client|invalid x-api-key)/i.test(message)) return 'auth';
    return 'client_error';
  }
  if (status >= 500) return 'server_error';
  return 'client_error';
}

/**
 * Classifies any thrown value from a third-party call.
 * Never throws — worst case returns `{ code: 'unknown' }`.
 */
export function classifyThirdPartyError(err: unknown): ClassifiedError {
  if (err === null || err === undefined) return { code: 'unknown' };

  const e = err as Record<string, unknown>;
  const name = toText(e.name);
  const message = toText(e.message);
  const combined = `${name} ${message}`.toLowerCase();

  // 1. Explicit timeouts: Node AbortSignal.timeout() rejects with DOMException 'TimeoutError'.
  if (name === 'TimeoutError') return { code: 'timeout' };

  // 2. Walk the cause chain (fetch wraps undici/node errors in .cause) for network/timeout codes.
  let current: Record<string, unknown> | undefined = e;
  for (let hops = 0; current && hops < 4; hops++) {
    const code = toText(current.code).toUpperCase();
    if (code) {
      if (UNDICICI_TIMEOUT_CODES.has(code)) return { code: 'timeout' };
      if (NETWORK_ERROR_CODES.has(code)) {
        return { code: 'network', statusHttp: extractStatus(current) };
      }
      // Other undici failures (socket reset, DNS via undici, etc.) are network-level.
      if (code.startsWith('UND_ERR')) {
        return { code: 'network', statusHttp: extractStatus(current) };
      }
    }
    current = current.cause as Record<string, unknown> | undefined;
  }

  // 3. AWS SDK v3: error name is stable across clients ($metadata carries the status).
  if (AWS_AUTH_NAMES.has(name)) return { code: 'auth', statusHttp: extractStatus(e) };
  if (AWS_RATE_LIMIT_NAMES.has(name)) return { code: 'rate_limited', statusHttp: extractStatus(e) };
  if (AWS_SERVER_ERROR_NAMES.has(name)) return { code: 'server_error', statusHttp: extractStatus(e) };

  // 4. Twilio: numeric error code (e.g. 20003 = "Authentication error - API key is invalid").
  const twilioCode = toNumber(e.code);
  if (twilioCode !== undefined && twilioCode >= 20000 && twilioCode < 30000) {
    if (TWILIO_AUTH_CODES.has(twilioCode)) return { code: 'auth', statusHttp: extractStatus(e) };
    const status = extractStatus(e);
    if (status !== undefined) return { code: statusToCode(status, combined), statusHttp: status };
    // Known Twilio codes without a usable HTTP status: not-found family vs generic client error.
    if (twilioCode === 20404) return { code: 'client_error' };
    return { code: 'client_error' };
  }

  // 5. Meta/FB Graph JSON errors surface as { error: { type, code, message } }.
  const fbError = e.error as Record<string, unknown> | undefined;
  if (fbError && typeof fbError === 'object') {
    const fbType = toText(fbError.type);
    const fbCode = toNumber(fbError.code);
    if (fbType === 'OAuthException' || (fbCode !== undefined && FB_AUTH_CODES.has(fbCode))) {
      return { code: 'auth', statusHttp: extractStatus(e) };
    }
    if (fbCode !== undefined && FB_RATE_LIMIT_CODES.has(fbCode)) {
      return { code: 'rate_limited', statusHttp: extractStatus(e) };
    }
  }

  // 6. Any HTTP status from an SDK error shape (OpenAI/Anthropic .status, Twilio .statusCode, ...).
  const status = extractStatus(e);
  if (status !== undefined) return { code: statusToCode(status, combined), statusHttp: status };

  // 7. Message-based fallback for SDKs that expose none of the above shapes.
  if (/(rate[ _-]?limit|too many requests|quota exceeded|429\b)/.test(combined)) return { code: 'rate_limited' };
  if (/(timed? out|timeout|etimedout|deadline exceeded)/.test(combined)) return { code: 'timeout' };
  if (/(econnrefused|econnreset|enotfound|eai_again|econnaborted|socket hang up|fetch failed|network (is )?unreachable)/.test(combined)) {
    return { code: 'network' };
  }
  if (/(unauthorized|forbidden|permission denied|access denied|invalid (api )?key|api[ _-]?key|credential|unrecognized client|unauthenticated|\bauth(entication|orization)?\b|401\b|403\b)/.test(combined)) {
    return { code: 'auth' };
  }
  if (/(internal server error|bad gateway|service unavailable|gateway timeout|500\b|502\b|503\b|504\b)/.test(combined)) {
    return { code: 'server_error' };
  }
  if (/(bad request|invalid (request|parameter|input)|not found|unprocessable|400\b|404\b|422\b)/.test(combined)) {
    return { code: 'client_error' };
  }

  return { code: 'unknown' };
}
