import { singleton, container } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { ZodError } from 'zod';
import { access, constants, stat } from 'node:fs/promises';
import { db } from '../../../db';
import { providers } from '../../../db/schema';
import type { Provider } from '../../../types/models';
import { ForbiddenError, InvalidOperationError, NotFoundError, TooManyRequestsError, ValidationError } from '../../../errors';
import { logger } from '../../../utils/logger';
import { MonitoringContext } from '../../monitoring/MonitoringContext';
import { classifyThirdPartyError, type ClassifiedError, type ThirdPartyErrorCode } from '../../../utils/errorClassification';
import type { RequestContext } from '../../RequestContext';
import { LlmProviderFactory, type LlmSettings } from '../llm/LlmProviderFactory';
import type { LlmProviderBase } from '../llm/LlmProviderBase';
import { AsrProviderFactory } from '../asr/AsrProviderFactory';
import type { AsrProviderBase } from '../asr/AsrProviderBase';
import { TtsProviderFactory, type TtsSettings } from '../tts/TtsProviderFactory';
import type { TtsProviderBase } from '../tts/TtsProviderBase';
import { StorageProviderFactory, type StorageSettings } from '../storage/StorageProviderFactory';
import type { StorageProviderBase } from '../storage/StorageProviderBase';
import {
  buildDraftProvider,
  connectionTestDraftKey,
  sanitizeErrorText,
  TestTimeoutError,
  ConnectionTestFailure,
  type ConnectionTestContext,
  type ConnectionTestInput,
  type ConnectionTestOutcome,
  type ConnectionTestRequest,
  type ConnectionTestResult,
  type DraftConnectionTestInput,
  type TestPhase,
  type TestProtocol,
} from './types';

/** Cooldown between tests per saved provider id / draft key (TPC-01 guard). */
const COOLDOWN_MS = 5_000;
/** Bounded wait for instance cleanup on the timeout/failure paths. */
const CLEANUP_BOUND_MS = 5_000;
/** Above this many tracked keys, expired cooldown entries are swept (draft keys are unbounded in variety). */
const COOLDOWN_SWEEP_THRESHOLD = 1_000;

/** Provider types that have a connection test (the provider base owns the test body). */
const SUPPORTED_TYPES = ['llm', 'asr', 'tts', 'storage'] as const;

/** Default hard timeouts per providerType (the whole body: build + test). */
const DEFAULT_TIMEOUTS: Record<string, number> = {
  llm: 30_000,
  asr: 20_000,
  tts: 30_000,
  storage: 15_000,
};

/**
 * TTS transport per apiType (TPC-04): a table — no per-vendor code. ElevenLabs/
 * Deepgram/Cartesia stream over WebSocket; OpenAI over HTTP; the SDK-backed
 * vendors (Soniox, Amazon Polly, Azure) over their SDK.
 */
const TTS_PROTOCOL_BY_API_TYPE: Record<string, TestProtocol> = {
  elevenlabs: 'websocket',
  deepgram: 'websocket',
  cartesia: 'websocket',
  openai: 'http',
  soniox: 'sdk',
  'amazon-polly': 'sdk',
  azure: 'sdk',
};

/**
 * On-demand provider connection testing (TPC-01 core).
 *
 * The provider classes own the simple test (`testConnection()` on each base,
 * TPC-02..05); this tester owns the cross-cutting guards:
 * - cooldown 5 s per saved provider id / draft key → TooManyRequestsError (429 + Retry-After)
 * - hard timeout per providerType wrapping build + test → ok:false 'timeout'
 * - fresh instance per test (built via the factories' `createForTest` seams)
 * - no vendor outcome escapes: only guard errors (400/404/429) throw
 * - error-text sanitization at the single choke point (response + logs)
 * - call-log attribution rides the production path: the test body runs under
 *   `MonitoringContext.run({ operation: '<type>.test' })`, so the provider
 *   base's own instrumentation records exactly one `<type>.test` row per saved
 *   test (same recording behavior as live calls). Draft providers are built
 *   un-stamped (factory seam), so draft tests record nothing.
 *
 * Test outcomes never feed the circuit breaker (CallLogger guard, TPC-01), so
 * a flaky vendor during manual testing cannot open a breaker and trigger
 * failover for real users.
 */
@singleton()
export class ProviderConnectionTester {
  /** cooldownKey → timestamp of the last test start (ms). */
  private readonly lastTestAt = new Map<string, number>();
  /** Test seam: per-providerType hard-timeout override (defaults in DEFAULT_TIMEOUTS). */
  private readonly timeoutOverrides = new Map<string, number>();

  /** Test seam (and plugin point): override the hard timeout for a providerType. */
  setTestTimeout(providerType: string, timeoutMs: number): void {
    this.timeoutOverrides.set(providerType, timeoutMs);
  }

  private timeoutFor(providerType: string): number {
    return this.timeoutOverrides.get(providerType) ?? DEFAULT_TIMEOUTS[providerType] ?? 30_000;
  }

  /** The public protocol, from the request (the error path can't ask the instance). */
  private protocolFor(request: ConnectionTestRequest): TestProtocol {
    if (request.providerType === 'tts') {
      return TTS_PROTOCOL_BY_API_TYPE[request.apiType] ?? 'http';
    }
    if (request.providerType === 'storage') {
      return request.apiType === 'local' ? 'local-fs' : 'sdk';
    }
    if (request.providerType === 'asr') {
      return 'websocket';
    }
    return 'http'; // llm (and the defensive default)
  }

  /**
   * Runs a connection test (saved or draft mode). Vendor failures return a
   * structured result; only guard errors throw (ZodError/InvalidOperation →
   * 400, NotFound → 404, cooldown → 429, Forbidden → 403).
   */
  async testConnection(input: ConnectionTestInput, context: RequestContext): Promise<ConnectionTestResult> {
    const request = await this.normalizeInput(input);
    if (!(SUPPORTED_TYPES as readonly string[]).includes(request.providerType)) {
      throw new InvalidOperationError(`No connection test available for provider type '${request.providerType}'. Supported types: ${SUPPORTED_TYPES.join(', ')}`);
    }
    this.assertCooldown(request.cooldownKey);
    this.markTestStarted(request.cooldownKey);

    const ctx: ConnectionTestContext = { operatorId: context.operatorId };
    // Monotonic clock: latency must not be skewed by wall-clock (NTP) adjustments.
    const startedAt = performance.now();
    let instance: unknown = null;
    try {
      // The hard timeout wraps the whole body (build + test), per TPC-01. Body
      // AND cleanup run under the tester's monitoring context so the production
      // path's instrumentation records the test's own call-log rows
      // breaker-excluded — including rows flushed by cleanup itself (e.g. the
      // ASR session row, which hardcodes its operation and is only excluded via
      // the context at flush time).
      const outcome = await MonitoringContext.run({ operation: `${request.providerType}.test` }, async () => {
        try {
          return await this.withTimeout(
            this.buildInstanceAndTest(request, (built) => {
              instance = built;
            }),
            this.timeoutFor(request.providerType),
          );
        } finally {
          // Always awaited (bounded) — even on timeout, so the instance's own
          // resources are released (the raced promise may still settle later).
          await this.boundedCleanup(instance);
        }
      });
      return this.complete(request, outcome, ctx, startedAt);
    } catch (err) {
      if (this.isGuardError(err)) {
        throw err;
      }
      const classified = this.classify(err);
      const phase = this.derivePhase(err, classified.code);
      const outcome: ConnectionTestOutcome = {
        ok: false,
        phase,
        errorCode: classified.code,
        statusHttp: classified.statusHttp ?? null,
        errorText: this.errorMessageOf(err),
      };
      return this.complete(request, outcome, ctx, startedAt);
    }
  }

  // --- internals ---

  /**
   * Builds a fresh instance via the provider type's factory and runs its own
   * `testConnection()` — the "simple test" the provider class owns. This is
   * the seam the core unit test overrides to exercise the guards with a stub.
   * `onBuilt` registers the instance for the tester's bounded cleanup as soon
   * as it exists (so a failure in the test body still releases it).
   */
  protected async buildInstanceAndTest(request: ConnectionTestRequest, onBuilt: (instance: unknown) => void): Promise<ConnectionTestOutcome> {
    const provider = request.provider;
    switch (request.providerType) {
      case 'llm': {
        const factory = container.resolve(LlmProviderFactory);
        const model = await this.resolveLlmModel(factory, request);
        const instance = await factory.createForTest(provider, { model } as LlmSettings);
        onBuilt(instance);
        // Pass the resolved model explicitly — draft instances are un-stamped, so
        // the base cannot recover it from `providerModel`.
        return (instance as LlmProviderBase<Record<string, unknown>>).testConnection(model);
      }
      case 'asr': {
        const factory = container.resolve(AsrProviderFactory);
        const instance = await factory.createForTest(provider, {});
        onBuilt(instance);
        return (instance as AsrProviderBase).testConnection();
      }
      case 'tts': {
        const factory = container.resolve(TtsProviderFactory);
        // Every TTS settings schema requires the `provider` literal (== apiType);
        // all other fields take schema defaults. No init() here — the lifecycle
        // inside testConnection is the test.
        const settings = { provider: request.apiType, voiceId: request.voice } as TtsSettings;
        const instance = await factory.createForTest(provider, settings);
        onBuilt(instance);
        return (instance as TtsProviderBase).testConnection(request.voice);
      }
      case 'storage': {
        const factory = container.resolve(StorageProviderFactory);
        // local: pre-check the base directory BEFORE building —
        // LocalStorageProvider.init() would auto-create a missing directory and
        // mask the misconfiguration. Missing/unwritable is a configuration
        // error, not a third-party failure (spec: client_error).
        let basePath: string | null = null;
        if (request.apiType === 'local') {
          basePath = this.readLocalBasePath(provider);
          await this.assertLocalDirectory(basePath);
        }
        const settings = this.buildStorageSettings(request);
        const instance = await factory.createForTest(provider, settings);
        onBuilt(instance);
        return (instance as StorageProviderBase<Record<string, unknown>>).testConnection({ write: request.write === true, path: basePath });
      }
      default:
        throw new InvalidOperationError(`No connection test available for provider type '${request.providerType}'`);
    }
  }

  private async normalizeInput(input: ConnectionTestInput): Promise<ConnectionTestRequest> {
    if (this.isDraftInput(input)) {
      return {
        providerType: input.providerType,
        apiType: input.apiType,
        mode: 'draft',
        provider: buildDraftProvider(input.providerType, input.apiType, input.config),
        cooldownKey: connectionTestDraftKey(input.apiType, input.config),
        model: input.model,
        voice: input.voice,
        language: input.language,
        write: input.write,
        bucket: input.bucket,
      };
    }
    const provider = await this.loadProvider(input.providerId);
    return {
      providerType: provider.providerType,
      apiType: provider.apiType,
      mode: 'saved',
      provider,
      cooldownKey: provider.id,
      model: input.model,
      voice: input.voice,
      language: input.language,
      write: input.write,
      bucket: input.bucket,
    };
  }

  /**
   * Resolves the model to test: the input's `model`, else (saved mode only) the
   * first model from the provider's own catalog. Draft mode requires `model`
   * (a draft has no row to enumerate against).
   */
  private async resolveLlmModel(factory: LlmProviderFactory, request: ConnectionTestRequest): Promise<string> {
    if (request.model) {
      return request.model;
    }
    if (request.mode === 'draft') {
      throw new ValidationError('A model is required to test a draft LLM provider', []);
    }
    // Defaults the tested model via the provider's own model catalog — the
    // existing free call (same path as the provider editor's model list):
    // uninitialised enumeration instance → init() (client construction, no
    // network) → enumerateModels() → first model id.
    const enumerator = await factory.createProviderForEnumeration(request.provider);
    try {
      await enumerator.init();
      const models = await enumerator.enumerateModels();
      const model = models[0]?.id;
      if (!model) {
        throw new ValidationError(`Could not determine a model for provider ${request.provider.id} — pass 'model' explicitly`, []);
      }
      return model;
    } finally {
      await enumerator.cleanup();
    }
  }

  /** Loads the provider row for saved mode (404 if missing). Seam for unit tests. */
  protected async loadProvider(id: string): Promise<Provider> {
    const provider = await db.query.providers.findFirst({ where: eq(providers.id, id) });
    if (!provider) {
      throw new NotFoundError(`Provider with id ${id} not found`);
    }
    return provider;
  }

  /** local: `basePath` is a required plaintext config field (not a secret). */
  private readLocalBasePath(provider: Provider): string {
    const basePath = (provider.config as Record<string, unknown> | null)?.basePath;
    if (typeof basePath !== 'string' || basePath.length === 0) {
      throw new ValidationError('Local storage connection test requires a non-empty basePath in the provider config', []);
    }
    return basePath;
  }

  /** local: existence + directory-ness + read/write access, as `client_error` failures. */
  private async assertLocalDirectory(basePath: string): Promise<void> {
    try {
      const stats = await stat(basePath);
      if (!stats.isDirectory()) {
        throw new ConnectionTestFailure(`Local storage path '${basePath}' is not a directory`, 'auth', undefined, 'client_error');
      }
      await access(basePath, constants.R_OK | constants.W_OK);
    } catch (err) {
      if (err instanceof ConnectionTestFailure) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new ConnectionTestFailure(`Local storage directory '${basePath}' is missing or not readable/writable: ${sanitizeErrorText(message)}`, 'auth', undefined, 'client_error');
    }
  }

  /** Per-apiType settings — storage settings are per-project in production, so the bucket comes from the test input. */
  private buildStorageSettings(request: ConnectionTestRequest): StorageSettings {
    switch (request.apiType) {
      case 's3':
        if (!request.bucket) throw new ValidationError('Storage connection test for s3 requires the bucket input parameter', []);
        return { bucket: request.bucket };
      case 'azure-blob':
        if (!request.bucket) throw new ValidationError('Storage connection test for azure-blob requires the bucket (container) input parameter', []);
        return { containerName: request.bucket };
      case 'gcs':
        if (!request.bucket) throw new ValidationError('Storage connection test for gcs requires the bucket input parameter', []);
        return { bucketName: request.bucket };
      case 'local':
        return {};
      default:
        throw new ValidationError(`Unsupported storage provider API type for connection test: ${request.apiType}`, []);
    }
  }

  private assertCooldown(key: string): void {
    const lastAt = this.lastTestAt.get(key);
    if (lastAt === undefined) return;
    const elapsedMs = Date.now() - lastAt;
    if (elapsedMs < COOLDOWN_MS) {
      const retryAfterSeconds = Math.max(1, Math.ceil((COOLDOWN_MS - elapsedMs) / 1000));
      throw new TooManyRequestsError(`Provider connection test on cooldown — retry in ${retryAfterSeconds}s`, 'api', retryAfterSeconds);
    }
  }

  private markTestStarted(key: string): void {
    const now = Date.now();
    if (this.lastTestAt.size > COOLDOWN_SWEEP_THRESHOLD) {
      for (const [cooldownKey, lastAt] of this.lastTestAt) {
        if (now - lastAt >= COOLDOWN_MS) this.lastTestAt.delete(cooldownKey);
      }
    }
    this.lastTestAt.set(key, now);
  }

  /** Shapes the public result from the provider's outcome + the request, and logs it. */
  private complete(request: ConnectionTestRequest, outcome: ConnectionTestOutcome, ctx: ConnectionTestContext, startedAt: number): ConnectionTestResult {
    const errorText = outcome.errorText ? sanitizeErrorText(outcome.errorText) : undefined;
    const result: ConnectionTestResult = {
      ok: outcome.ok,
      providerType: request.providerType,
      apiType: request.apiType,
      protocol: this.protocolFor(request),
      phase: outcome.phase,
      // Tester-owned: total elapsed (build + test), identical on ok/fail paths.
      latencyMs: Math.round(performance.now() - startedAt),
      errorCode: outcome.errorCode,
      ...(errorText ? { errorText } : {}),
      ...(outcome.detail ? { detail: outcome.detail } : {}),
    };
    logger.info(
      { providerType: request.providerType, apiType: request.apiType, mode: request.mode, ok: result.ok, phase: result.phase, latencyMs: result.latencyMs, errorCode: result.errorCode, operatorId: ctx.operatorId },
      'Provider connection test finished',
    );
    return result;
  }

  private classify(err: unknown): ClassifiedError {
    if (err instanceof TestTimeoutError) {
      return { code: 'timeout' };
    }
    if (this.isConnectionTestFailure(err)) {
      return { code: err.errorCode ?? classifyThirdPartyError(err).code, statusHttp: err.statusHttp };
    }
    return classifyThirdPartyError(err);
  }

  private derivePhase(err: unknown, code: ThirdPartyErrorCode): TestPhase {
    if (this.isConnectionTestFailure(err)) return err.phase;
    if (err instanceof TestTimeoutError) return 'session';
    // Furthest stage known from the code alone: auth-classified failures
    // failed at auth; everything else reached (or was trying) first data.
    return code === 'auth' ? 'auth' : 'first-data';
  }

  /**
   * Graph-proof `ConnectionTestFailure` check. The storage provider base is
   * dynamically imported under tsx and can live in a different module graph
   * than this tester, so `instanceof` is unreliable there — match on the
   * `name` the class sets in its constructor (an own property in every graph).
   */
  private isConnectionTestFailure(err: unknown): err is ConnectionTestFailure {
    return err instanceof Error && err.name === 'ConnectionTestFailure';
  }

  private withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new TestTimeoutError(timeoutMs)), timeoutMs);
      timer.unref?.();
    });
    return Promise.race([work, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  private async boundedCleanup(instance: unknown): Promise<void> {
    const cleanup = (instance as { cleanup?: unknown } | null | undefined)?.cleanup;
    if (typeof cleanup !== 'function') return;
    try {
      await Promise.race([
        Promise.resolve((cleanup as () => Promise<void>).call(instance)),
        new Promise<void>((resolve) => {
          const t = setTimeout(resolve, CLEANUP_BOUND_MS);
          t.unref?.();
        }),
      ]);
    } catch (err) {
      logger.warn({ error: (err as Error)?.message ?? String(err) }, 'Connection test instance cleanup failed (ignored)');
    }
  }

  private isGuardError(err: unknown): boolean {
    return err instanceof ZodError || err instanceof ValidationError || err instanceof InvalidOperationError || err instanceof NotFoundError || err instanceof TooManyRequestsError || err instanceof ForbiddenError;
  }

  private errorMessageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  private isDraftInput(input: ConnectionTestInput): input is DraftConnectionTestInput {
    return typeof (input as DraftConnectionTestInput).providerType === 'string';
  }
}
