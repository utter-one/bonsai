import type { ErrorCallback, SimpleCallback } from '../../../types/callbacks';
import type { LlmChunk, LlmChunkCallback, LlmCompleteCallback, LlmGenerationOptions, LlmGenerationResult, LlmMessage } from './ILlmProvider';
import type { ILlmProvider } from './ILlmProvider';
import type { LlmProviderFactory, LlmSettings } from './LlmProviderFactory';
import type { FallbackStep } from '../FallbackResolver';
import type { CircuitBreakerRegistry } from '../../monitoring/CircuitBreakerRegistry';
import type { FallbackEventService } from '../../monitoring/FallbackEventService';
import type { MetricsRegistry } from '../../monitoring/MetricsRegistry';
import { MonitoringContext } from '../../monitoring/MonitoringContext';
import { LlmProviderBase } from './LlmProviderBase';
import { classifyThirdPartyError } from '../../../utils/errorClassification';
import { CircuitOpenError } from '../../../errors';
import { logger } from '../../../utils/logger';
import type { LlmModelInfo } from '../ProviderCatalogService';

/** Setup-phase errors that get one retry (500 ms backoff) before moving down the chain. */
const RETRYABLE_SETUP_CODES = new Set(['timeout', 'server_error']);
const RETRY_BACKOFF_MS = 500;

/** Per in-flight stream attempt: true once any chunk was delivered downstream. */
interface StreamState {
  delivered: boolean;
}

/**
 * P3-03 — failover wrapper for conversation LLM calls.
 *
 * Wraps a primary `ILlmProvider` with its fallback chain (resolved by the
 * runner via `FallbackResolver` before construction). On a **setup-phase**
 * failure (before the first streamed chunk / any non-streaming failure) the
 * next provider in the chain is attempted — with one retry (500 ms backoff)
 * for `timeout`/`server_error`. A **mid-stream** failure never fails over:
 * tokens are already flowing downstream (TTS pipeline / response state) and
 * re-running the completion would corrupt the turn; the error surfaces
 * exactly as without failover.
 *
 * Observability per transition:
 * - `fallback_events` row (via `FallbackEventService`) — inserted at
 *   transition time with success=false, flipped to success=true when the
 *   transition's fallback ultimately serves the request;
 * - `fallback_attempts_total{provider_id=<failed step>}` counter;
 * - `provider_chain_exhausted_total{provider_id=<primary>}` on exhaustion;
 * - breaker skips (P3-01) produce no rows and no call-log entries — the
 *   `circuit_open_skips_total` metric + a pino warn are the trace.
 *
 * Fallback provider instances are created lazily on first attempt via
 * `LlmProviderFactory` (base settings + per-step override merged on top) and
 * cached for the wrapper's lifetime (one conversation). Non-primary attempts
 * are stamped `fallbackOfProviderId` so their call-log rows carry
 * `fallback_provider_id` (the chain's primary).
 *
 * `enumerateModels()` / `moderateUserInput()` delegate to the primary only —
 * no failover (low blast radius, keeps it cheap).
 */
export class FailoverLlmProvider implements ILlmProvider {
  /** The chain's primary provider id (audit / fallback_events semantics). */
  readonly primaryId: string;

  private readonly primary: ILlmProvider;
  private readonly fallbackSteps: FallbackStep[];
  private readonly baseSettings: LlmSettings;
  private readonly factory: LlmProviderFactory;
  private readonly breakerRegistry: CircuitBreakerRegistry;
  private readonly fallbackEvents: FallbackEventService;
  private readonly metrics: MetricsRegistry;

  /** Lazily created fallback instances, cached for the conversation's lifetime. */
  private readonly instances = new Map<string, ILlmProvider>();
  /** Row id of the most recent transition event (into the step being attempted). */
  private lastTransitionRowId: string | null = null;
  private chunkCallback?: LlmChunkCallback;
  private startedCallback?: SimpleCallback;
  private completedCallback?: LlmCompleteCallback;
  private errorCallback?: ErrorCallback;

  constructor(
    primaryId: string,
    primary: ILlmProvider,
    fallbackSteps: FallbackStep[],
    baseSettings: LlmSettings,
    deps: {
      factory: LlmProviderFactory;
      breakerRegistry: CircuitBreakerRegistry;
      fallbackEvents: FallbackEventService;
      metrics: MetricsRegistry;
    },
  ) {
    this.primaryId = primaryId;
    this.primary = primary;
    this.fallbackSteps = fallbackSteps;
    this.baseSettings = baseSettings;
    this.factory = deps.factory;
    this.breakerRegistry = deps.breakerRegistry;
    this.fallbackEvents = deps.fallbackEvents;
    this.metrics = deps.metrics;
  }

  /** Number of providers in the chain (primary + fallbacks). */
  get providerCount(): number {
    return this.fallbackSteps.length + 1;
  }

  async init(): Promise<void> {
    await this.primary.init();
  }

  async generate(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<LlmGenerationResult> {
    let lastError: unknown = null;
    for (let i = 0; i <= this.fallbackSteps.length; i++) {
      const step = i === 0 ? null : this.fallbackSteps[i - 1];
      const providerId = i === 0 ? this.primaryId : step!.provider.id;
      if (!this.passBreakerGate(providerId)) {
        continue;
      }
      const streamState: StreamState = { delivered: false };
      try {
        const provider = i === 0 ? this.primary : await this.ensureInstance(step!);
        this.wireCallbacks(provider, streamState);
        // Non-streaming: every failure is a setup-phase failure — fail over.
        const result = await this.attemptWithRetry(providerId, () => provider.generate(messages, options), streamState);
        await this.markLastTransitionSucceeded();
        return result;
      } catch (error) {
        lastError = error;
        await this.onSetupFailure(providerId, error, i);
      }
    }
    throw await this.exhaustChain(lastError);
  }

  async generateStream(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<void> {
    let lastError: unknown = null;
    for (let i = 0; i <= this.fallbackSteps.length; i++) {
      const step = i === 0 ? null : this.fallbackSteps[i - 1];
      const providerId = i === 0 ? this.primaryId : step!.provider.id;
      if (!this.passBreakerGate(providerId)) {
        continue;
      }
      const streamState: StreamState = { delivered: false };
      try {
        const provider = i === 0 ? this.primary : await this.ensureInstance(step!);
        this.wireCallbacks(provider, streamState);
        await this.attemptWithRetry(providerId, () => provider.generateStream(messages, options), streamState);
        await this.markLastTransitionSucceeded();
        return;
      } catch (error) {
        if (streamState.delivered) {
          // Mid-stream failure: no failover, no retry, no new event row. The
          // provider already delivered onError (forwarded, not suppressed) —
          // rethrow so the caller's existing error path runs unchanged.
          throw error;
        }
        lastError = error;
        await this.onSetupFailure(providerId, error, i);
      }
    }
    throw await this.exhaustChain(lastError);
  }

  setOnChunk(callback: LlmChunkCallback): void {
    this.chunkCallback = callback;
  }

  setOnGenerationStarted(callback: SimpleCallback): void {
    this.startedCallback = callback;
  }

  setOnGenerationCompleted(callback: LlmCompleteCallback): void {
    this.completedCallback = callback;
  }

  setOnError(callback: ErrorCallback): void {
    this.errorCallback = callback;
  }

  isInitialized(): boolean {
    return this.primary.isInitialized();
  }

  /**
   * Forwards cleanup to the primary and every fallback instance that was
   * actually created (a superset of "the active attempt" — failed attempts
   * may still hold aborted HTTP resources).
   */
  async cleanup(): Promise<void> {
    await this.primary.cleanup();
    for (const instance of this.instances.values()) {
      await instance.cleanup();
    }
  }

  /** Primary only — no failover (low blast radius, keeps it cheap). */
  enumerateModels(): Promise<LlmModelInfo[]> {
    return this.primary.enumerateModels();
  }

  /** Primary only — no failover (low blast radius, keeps it cheap). */
  moderateUserInput(input: string): Promise<{ flagged: boolean; categories: string[] }> {
    return this.primary.moderateUserInput(input);
  }

  // --- internals ---

  /**
   * Breaker gate (P3-01). Providers with no breaker yet (no recorded calls)
   * pass without creating one — gating must not pollute the breaker snapshot
   * with entries for providers that never logged a call.
   */
  private passBreakerGate(providerId: string): boolean {
    try {
      const state = this.breakerRegistry.getState(providerId);
      if (state !== null) {
        this.breakerRegistry.getBreaker(providerId).beforeCall();
      }
      return true;
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        logger.warn({ providerId, primaryId: this.primaryId }, 'Failover: provider skipped — circuit open');
        return false;
      }
      throw error;
    }
  }

  /** One retry (500 ms backoff) for setup-phase timeout/server_error. */
  private async attemptWithRetry<T>(providerId: string, attempt: () => Promise<T>, streamState: StreamState): Promise<T> {
    try {
      return await attempt();
    } catch (error) {
      if (streamState.delivered) {
        throw error;
      }
      const code = classifyThirdPartyError(error).code;
      if (RETRYABLE_SETUP_CODES.has(code)) {
        logger.warn({ providerId, code }, 'Failover: setup-phase failure is retryable — one retry after 500 ms');
        await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS));
        return attempt();
      }
      throw error;
    }
  }

  /**
   * Setup-phase failure at step index i: record the transition event (when a
   * next step exists) + the attempts counter, and let the loop continue.
   * Per-attempt onError delivery is suppressed by the wiring — the caller
   * sees exactly one onError (exhaustion) or none (failover succeeded).
   */
  private async onSetupFailure(failedProviderId: string, error: unknown, stepIndex: number): Promise<void> {
    const code = classifyThirdPartyError(error).code;
    const nextStep = this.fallbackSteps[stepIndex];
    if (nextStep) {
      const ctx = MonitoringContext.current();
      const row = await this.fallbackEvents.record({
        providerId: failedProviderId,
        fallbackProviderId: nextStep.provider.id,
        providerType: 'llm',
        operation: ctx?.operation ?? 'llm.generate',
        reason: code,
        projectId: ctx?.projectId ?? null,
        conversationId: ctx?.conversationId ?? null,
        success: false,
      });
      if (row) {
        this.lastTransitionRowId = row.id;
      }
      logger.warn({ providerId: failedProviderId, fallbackProviderId: nextStep.provider.id, code, primaryId: this.primaryId }, 'Failover: setup-phase failure — trying next provider');
    }
    this.metrics.inc('fallback_attempts_total', { provider_id: failedProviderId });
  }

  /** Flips the transition event (if any) whose fallback just served the request. */
  private async markLastTransitionSucceeded(): Promise<void> {
    if (this.lastTransitionRowId !== null) {
      await this.fallbackEvents.markSucceeded(this.lastTransitionRowId);
      this.lastTransitionRowId = null;
    }
  }

  /**
   * Chain exhausted: metric + the single onError delivery (awaited, exactly
   * like today's provider notifyError path) + the last original error to throw.
   * When every step was breaker-skipped (no attempt ran) a descriptive error
   * is used instead.
   */
  private async exhaustChain(lastError: unknown): Promise<Error> {
    this.metrics.inc('provider_chain_exhausted_total', { provider_id: this.primaryId });
    const error = lastError instanceof Error
      ? lastError
      : lastError !== null
        ? new Error(String(lastError))
        : new Error(`All ${this.providerCount} providers in the failover chain for ${this.primaryId} are unavailable (circuit open)`);
    if (this.errorCallback) {
      try {
        await this.errorCallback(error);
      } catch (callbackError) {
        logger.error({ primaryId: this.primaryId, error: (callbackError as Error)?.message }, 'Failover: error callback failed');
      }
    }
    return error;
  }

  /** Lazily creates (and caches) the fallback instance; stamps failover attribution. */
  private async ensureInstance(step: FallbackStep): Promise<ILlmProvider> {
    let instance = this.instances.get(step.provider.id);
    if (!instance) {
      const settings = { ...this.baseSettings, ...(step.settings ?? {}) } as LlmSettings;
      instance = await this.factory.createProvider(step.provider, settings);
      if (instance instanceof LlmProviderBase) {
        instance.fallbackOfProviderId = this.primaryId;
      }
      this.instances.set(step.provider.id, instance);
    }
    return instance;
  }

  /**
   * Wires the attempt's underlying provider to the caller's callbacks with
   * failover state tracking. onError is suppressed for pre-token failures
   * (the chain may still succeed — the caller must not mark the conversation
   * failed); mid-stream errors and exhausted chains deliver it.
   */
  private wireCallbacks(provider: ILlmProvider, streamState: StreamState): void {
    provider.setOnChunk(async (chunk: LlmChunk) => {
      streamState.delivered = true;
      if (this.chunkCallback) {
        await this.chunkCallback(chunk);
      }
    });
    provider.setOnGenerationStarted(async () => {
      if (this.startedCallback) {
        await this.startedCallback();
      }
    });
    provider.setOnGenerationCompleted(async (result) => {
      if (this.completedCallback) {
        await this.completedCallback(result);
      }
    });
    provider.setOnError(async (error: Error) => {
      if (streamState.delivered) {
        // Mid-stream: surface exactly as without failover.
        if (this.errorCallback) {
          await this.errorCallback(error);
        }
      }
      // Pre-token: suppressed — the wrapper decides (retry/failover/exhaust).
    });
  }
}
