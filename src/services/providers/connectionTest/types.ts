import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Provider } from '../../../types/models';
import type { ThirdPartyErrorCode } from '../../../utils/errorClassification';
import { sanitizeErrorText } from '../../../utils/errorSanitization';

export { sanitizeErrorText };

/**
 * Provider connection testing (TPC-01) — shared types.
 *
 * The tester reuses each provider's own production code path (same host,
 * transport, auth, SDK) at minimum size. These types define the uniform
 * result contract, the strategy seam and the tester-owned guards' helpers.
 */

/** Transport the test exercises — the same protocol as the provider's main functionality. */
export const connectionTestProtocolSchema = z.enum(['http', 'websocket', 'sdk', 'smtp', 'imap', 'local-fs']);
export type TestProtocol = z.infer<typeof connectionTestProtocolSchema>;

/** How far the test got (furthest stage reached). */
export const connectionTestPhaseSchema = z.enum(['auth', 'session', 'first-data', 'write']);
export type TestPhase = z.infer<typeof connectionTestPhaseSchema>;

/**
 * Structured outcome of a connection test. Always returned with HTTP 200 when
 * the test itself ran — vendor failures are data (`ok: false` + `errorCode`),
 * not HTTP errors.
 */
export interface ConnectionTestResult {
  ok: boolean;
  providerType: string;
  apiType: string;
  protocol: TestProtocol;
  phase: TestPhase;
  latencyMs: number;
  errorCode: ThirdPartyErrorCode | null;
  /** Sanitized by the tester: truncated to 500 chars, token/key patterns redacted. */
  errorText?: string;
  detail?: Record<string, unknown>;
}

/**
 * Internal supertype of ConnectionTestResult returned by strategies.
 * `model`/`statusHttp` feed the saved-test call-log row only (TPC-07) and are
 * stripped before the public result is returned — they never reach the API.
 */
export interface ConnectionTestOutcome extends ConnectionTestResult {
  /** Call-log attribution (saved mode): the model/voice actually exercised. */
  model?: string | null;
  /** Call-log attribution (saved mode): vendor HTTP status, when known. */
  statusHttp?: number | null;
}

/** Mode A — test a saved provider row by id. */
export interface SavedConnectionTestInput {
  providerId: string;
  model?: string;
  voice?: string;
  language?: string;
  /** Storage only: run a full upload/download/delete round trip on a throwaway key. */
  write?: boolean;
  /** Storage only (s3/azure-blob/gcs): the bucket/container to verify — storage settings are per-project in production, so the test takes the target explicitly. */
  bucket?: string;
}

/** Mode B — test an unsaved (draft) config before the provider row exists. */
export interface DraftConnectionTestInput {
  providerType: string;
  apiType: string;
  /** Validated by the same per-apiType Zod schema the create endpoint uses. Plaintext secrets are used for the test only, never persisted. */
  config: Record<string, unknown>;
  model?: string;
  voice?: string;
  language?: string;
  write?: boolean;
  bucket?: string;
}

export type ConnectionTestInput = SavedConnectionTestInput | DraftConnectionTestInput;

/** Normalized request the tester builds before dispatch (mode already resolved). */
export interface ConnectionTestRequest {
  providerType: string;
  apiType: string;
  mode: 'saved' | 'draft';
  /** DB row (saved) or synthetic in-memory provider (draft, `id: 'draft'`). */
  provider: Provider;
  /** Cooldown key: saved → providerId · draft → `draft:<apiType>:<sha256(config)[:12]>`. */
  cooldownKey: string;
  model?: string;
  voice?: string;
  language?: string;
  write?: boolean;
  /** Storage only (s3/azure-blob/gcs): bucket/container to verify (see ConnectionTestInput.bucket). */
  bucket?: string;
}

/** Tester → strategy context (never carries secrets). */
export interface ConnectionTestContext {
  /** Operator who initiated the test (logs only). */
  operatorId: string;
}

/**
 * One strategy per providerType. Strategies drive the production lifecycle at
 * minimum size (TPC-02 LLM, TPC-03 ASR, TPC-04 TTS, TPC-05 storage, TPC-08
 * channel) and plug in via `buildConnectionTestStrategies()` without touching
 * the tester or the HTTP contract.
 */
export interface ConnectionTestStrategy<TInstance = unknown> {
  /** Registry key — the providerType this strategy handles. */
  readonly providerType: string;
  /** Hard timeout wrapping the whole body (buildInstance + test). */
  readonly timeoutMs: number;
  /** Default transport reported for tester-derived failures (strategies override per call in the returned outcome). */
  readonly protocol: TestProtocol;
  /**
   * Build a fresh instance from the (resolved) request — never a pooled or
   * pre-warmed provider, so a test cannot disturb in-flight conversations.
   * May throw ZodError (invalid draft config → 400) or InvalidOperationError.
   */
  buildInstance(request: ConnectionTestRequest, ctx: ConnectionTestContext): Promise<TInstance>;
  /**
   * Drive the production lifecycle at minimum size. Vendor failures may be
   * returned as an outcome or thrown (raw vendor error or ConnectionTestFailure);
   * the tester normalizes either way. Must never throw guard errors.
   */
  test(request: ConnectionTestRequest, instance: TInstance, ctx: ConnectionTestContext): Promise<ConnectionTestOutcome>;
}

/** Sentinel: the tester's hard timeout fired. Caught internally, never escapes the tester. */
export class TestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Connection test timed out after ${timeoutMs}ms`);
    this.name = 'TestTimeoutError';
  }
}

/**
 * Strategy-side structured failure: carries the phase the test actually
 * reached (and optionally the vendor HTTP status / errorCode) so the tester
 * can normalize without guessing. A raw thrown vendor error without this
 * degrades to phase 'auth' (auth-classified codes) or 'first-data'.
 */
export class ConnectionTestFailure extends Error {
  constructor(
    message: string,
    readonly phase: TestPhase,
    readonly statusHttp?: number,
    readonly errorCode?: ThirdPartyErrorCode,
  ) {
    super(message);
    this.name = 'ConnectionTestFailure';
  }
}

/** Synthetic provider id for draft tests (never exists in the DB; the factory skips call-log stamping for it). */
export const CONNECTION_TEST_DRAFT_ID = 'draft';

/** Deterministic JSON stringify (object keys sorted recursively) for stable hashing. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${entries.join(',')}}`;
}

/** Cooldown key for a draft test: `draft:<apiType>:<sha256(stableStringify(config))[:12]>`. */
export function connectionTestDraftKey(apiType: string, config: Record<string, unknown>): string {
  const hash = createHash('sha256').update(stableStringify(config)).digest('hex').slice(0, 12);
  return `draft:${apiType}:${hash}`;
}

/**
 * Synthetic in-memory provider for draft tests (`id: 'draft'`). Config is
 * plaintext — used for the test only, never persisted.
 */
export function buildDraftProvider(providerType: string, apiType: string, config: Record<string, unknown>): Provider {
  const now = new Date();
  return {
    id: CONNECTION_TEST_DRAFT_ID,
    name: CONNECTION_TEST_DRAFT_ID,
    description: null,
    providerType,
    apiType,
    config: config as Provider['config'],
    fallbacks: [],
    createdBy: null,
    tags: null,
    version: 0,
    createdAt: now,
    updatedAt: now,
  };
}
