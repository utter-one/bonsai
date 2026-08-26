import { singleton, inject } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { ZodError } from 'zod';
import { db } from '../../../db';
import { providers } from '../../../db/schema';
import type { Provider } from '../../../types/models';
import { ForbiddenError, InvalidOperationError, NotFoundError, TooManyRequestsError } from '../../../errors';
import { logger } from '../../../utils/logger';
import { classifyThirdPartyError, type ClassifiedError, type ThirdPartyErrorCode } from '../../../utils/errorClassification';
import type { RequestContext } from '../../RequestContext';
import { CallLogger } from '../../monitoring/CallLogger';
import { buildConnectionTestStrategies } from './index';
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
  type ConnectionTestStrategy,
  type DraftConnectionTestInput,
  type TestPhase,
} from './types';

/** Cooldown between tests per saved provider id / draft key (TPC-01 guard). */
const COOLDOWN_MS = 5_000;
/** Bounded wait for instance cleanup on the timeout/failure paths. */
const CLEANUP_BOUND_MS = 5_000;
/** Above this many tracked keys, expired cooldown entries are swept (draft keys are unbounded in variety). */
const COOLDOWN_SWEEP_THRESHOLD = 1_000;

/**
 * On-demand provider connection testing (TPC-01 core).
 *
 * Orchestrates the cross-cutting guards and delegates the per-type test to a
 * strategy (`buildConnectionTestStrategies()`, one per providerType):
 * - cooldown 5 s per saved provider id / draft key → TooManyRequestsError (429 + Retry-After)
 * - hard timeout per strategy wrapping buildInstance + test → ok:false 'timeout'
 * - fresh instance per test (strategies build via the factories' test seams)
 * - no vendor outcome escapes: only guard errors (400/404/429) throw
 * - error-text sanitization at the single choke point (response + logs)
 * - saved tests record exactly one provider_call_logs row (`<type>.test`);
 *   draft tests record nothing
 *
 * Test outcomes never feed the circuit breaker (CallLogger guard, TPC-01),
 * so a flaky vendor during manual testing cannot open a breaker and trigger
 * failover for real users.
 */
@singleton()
export class ProviderConnectionTester {
  private readonly strategies: Map<string, ConnectionTestStrategy>;
  /** cooldownKey → timestamp of the last test start (ms). */
  private readonly lastTestAt = new Map<string, number>();

  constructor(@inject(CallLogger) private readonly callLogger: CallLogger) {
    this.strategies = buildConnectionTestStrategies();
  }

  /** Test seam (and plugin point): register/override a strategy for its providerType. */
  registerStrategy(strategy: ConnectionTestStrategy): void {
    this.strategies.set(strategy.providerType, strategy);
  }

  /**
   * Runs a connection test (saved or draft mode). Vendor failures return a
   * structured result; only guard errors throw (ZodError/InvalidOperation →
   * 400, NotFound → 404, cooldown → 429, Forbidden → 403).
   */
  async testConnection(input: ConnectionTestInput, context: RequestContext): Promise<ConnectionTestResult> {
    const request = await this.normalizeInput(input);
    const strategy = this.strategies.get(request.providerType);
    if (!strategy) {
      throw new InvalidOperationError(`No connection test available for provider type '${request.providerType}'. Registered types: ${[...this.strategies.keys()].sort().join(', ') || 'none'}`);
    }
    this.assertCooldown(request.cooldownKey);
    this.markTestStarted(request.cooldownKey);

    const ctx: ConnectionTestContext = { operatorId: context.operatorId };
    const startedAt = Date.now();
    let instance: unknown = null;
    try {
      // The hard timeout wraps the whole strategy body (build + test), per TPC-01.
      const outcome = await this.withTimeout(
        (async () => {
          instance = await strategy.buildInstance(request, ctx);
          return await strategy.test(request, instance, ctx);
        })(),
        strategy.timeoutMs,
      );
      return this.complete(request, outcome, ctx);
    } catch (err) {
      if (this.isGuardError(err)) {
        throw err;
      }
      const classified = this.classify(err);
      const phase = this.derivePhase(err, classified.code);
      const outcome: ConnectionTestOutcome = {
        ok: false,
        providerType: request.providerType,
        apiType: request.apiType,
        protocol: strategy.protocol,
        phase,
        latencyMs: Date.now() - startedAt,
        errorCode: classified.code,
        statusHttp: classified.statusHttp ?? null,
        errorText: this.errorMessageOf(err),
      };
      return this.complete(request, outcome, ctx);
    } finally {
      // Always awaited (bounded) — even on timeout, so the instance's own
      // resources are released (the raced promise may still settle later).
      await this.boundedCleanup(instance);
    }
  }

  // --- internals ---

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
    };
  }

  /** Loads the provider row for saved mode (404 if missing). Seam for unit tests. */
  protected async loadProvider(id: string): Promise<Provider> {
    const provider = await db.query.providers.findFirst({ where: eq(providers.id, id) });
    if (!provider) {
      throw new NotFoundError(`Provider with id ${id} not found`);
    }
    return provider;
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

  /** Sanitizes the result, records the saved-test call-log row (exactly once per test) and returns the public shape. */
  private complete(request: ConnectionTestRequest, outcome: ConnectionTestOutcome, ctx: ConnectionTestContext): ConnectionTestResult {
    const errorText = outcome.errorText ? sanitizeErrorText(outcome.errorText) : undefined;
    const result: ConnectionTestResult = {
      ok: outcome.ok,
      providerType: outcome.providerType,
      apiType: outcome.apiType,
      protocol: outcome.protocol,
      phase: outcome.phase,
      latencyMs: outcome.latencyMs,
      errorCode: outcome.errorCode,
      ...(errorText ? { errorText } : {}),
      ...(outcome.detail ? { detail: outcome.detail } : {}),
    };

    if (request.mode === 'saved') {
      // Draft tests are transient (no provider row to attribute to) — no row.
      // The '<type>.test' operation keeps these rows out of the breaker feed.
      this.callLogger.record({
        providerId: request.provider.id,
        providerType: request.providerType,
        apiType: request.apiType,
        operation: `${request.providerType}.test`,
        model: outcome.model ?? request.model ?? null,
        ok: result.ok,
        errorCode: result.errorCode,
        statusHttp: outcome.statusHttp ?? null,
        durationMs: result.latencyMs,
        errorText: errorText ?? null,
      });
    }

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
    if (err instanceof ConnectionTestFailure) {
      return { code: err.errorCode ?? classifyThirdPartyError(err).code, statusHttp: err.statusHttp };
    }
    return classifyThirdPartyError(err);
  }

  private derivePhase(err: unknown, code: ThirdPartyErrorCode): TestPhase {
    if (err instanceof ConnectionTestFailure) return err.phase;
    if (err instanceof TestTimeoutError) return 'session';
    // Furthest stage known from the code alone: auth-classified failures
    // failed at auth; everything else reached (or was trying) first data.
    return code === 'auth' ? 'auth' : 'first-data';
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
    return err instanceof ZodError || err instanceof InvalidOperationError || err instanceof NotFoundError || err instanceof TooManyRequestsError || err instanceof ForbiddenError;
  }

  private errorMessageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  private isDraftInput(input: ConnectionTestInput): input is DraftConnectionTestInput {
    return typeof (input as DraftConnectionTestInput).providerType === 'string';
  }
}
