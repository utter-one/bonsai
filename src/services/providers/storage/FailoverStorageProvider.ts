import type { ErrorCallback } from '../../../types/callbacks';
import type { IStorageProvider, StorageMetadata, StorageObject } from './IStorageProvider';
import type { StorageProviderFactory, StorageSettings } from './StorageProviderFactory';
import type { FallbackStep, ProviderRow } from '../FallbackResolver';
import type { CircuitBreakerRegistry } from '../../monitoring/CircuitBreakerRegistry';
import type { FallbackEventService } from '../../monitoring/FallbackEventService';
import type { MetricsRegistry } from '../../monitoring/MetricsRegistry';
import {
  classifySetupError,
  exhaustChain,
  isRetryableSetupError,
  markTransitionSucceeded,
  passBreakerGate,
  recordTransition,
  RETRY_BACKOFF_MS,
  sleep,
} from '../failoverCommon';

/**
 * P3-04 — failover wrapper for conversation storage operations.
 *
 * Storage is per-operation (no session): `upload()` and `download()` each walk
 * the full chain — one retry (500 ms) for `timeout`/`server_error` per
 * attempt, then the next provider. **Instance creation is part of the
 * attempt**: the factory's `createProvider` awaits `init()` (a network step —
 * e.g. S3 client bootstrap), so a primary whose init rejects fails over to
 * the next provider exactly like an operation failure. `delete`/
 * `getSignedUrl`/`exists`/`list` forward to the primary only.
 *
 * **No artifact migration**: an upload that lands on a fallback provider is
 * never copied to the primary. While the primary is down, reads fail over as
 * needed; once it recovers, new uploads go to the primary only (older
 * fallback-resident artifacts keep being reachable via failover).
 *
 * Transition rows + `fallback_attempts_total` /
 * `provider_chain_exhausted_total` mirror the P3-03 LLM wrapper; failed
 * upload/download attempts leave call-log rows with `fallback_provider_id`
 * stamped via `setFallbackOf` (instance-creation failures leave no row — the
 * factory rejected before the first operation). Per-attempt provider error
 * callbacks are suppressed; the registered `onError` fires exactly once on
 * exhaustion.
 */
export class FailoverStorageProvider implements IStorageProvider {
  /** The chain's primary provider id (audit / fallback_events semantics). */
  readonly primaryId: string;

  private readonly primaryRow: ProviderRow;
  private readonly fallbackSteps: FallbackStep[];
  private readonly baseSettings: StorageSettings;
  private readonly factory: StorageProviderFactory;
  private readonly breakerRegistry: CircuitBreakerRegistry;
  private readonly fallbackEvents: FallbackEventService;
  private readonly metrics: MetricsRegistry;

  private readonly instances = new Map<string, IStorageProvider>();
  private lastTransitionRowId: string | null = null;
  private errorCallback?: ErrorCallback;

  constructor(
    primary: ProviderRow,
    fallbackSteps: FallbackStep[],
    baseSettings: StorageSettings,
    deps: {
      factory: StorageProviderFactory;
      breakerRegistry: CircuitBreakerRegistry;
      fallbackEvents: FallbackEventService;
      metrics: MetricsRegistry;
    },
  ) {
    this.primaryId = primary.id;
    this.primaryRow = primary;
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

  /** Creates (and init()-es, via the factory) the primary instance. */
  async init(): Promise<void> {
    await this.ensureInstance(0);
  }

  /** Per-operation failover across the full chain. */
  async upload(key: string, data: Buffer, metadata?: StorageMetadata): Promise<string> {
    return await this.runOperation('storage.upload', (provider) => provider.upload(key, data, metadata));
  }

  /** Per-operation failover across the full chain. */
  async download(key: string): Promise<Buffer> {
    return await this.runOperation('storage.download', (provider) => provider.download(key));
  }

  /** Primary only. */
  async delete(key: string): Promise<void> {
    await (await this.ensureInstance(0)).delete(key);
  }

  /** Primary only. */
  async getSignedUrl(key: string, expiresIn: number): Promise<string> {
    return await (await this.ensureInstance(0)).getSignedUrl(key, expiresIn);
  }

  /** Primary only. */
  async exists(key: string): Promise<boolean> {
    return await (await this.ensureInstance(0)).exists(key);
  }

  /** Primary only. */
  async list(prefix?: string, maxResults?: number): Promise<StorageObject[]> {
    return await (await this.ensureInstance(0)).list(prefix, maxResults);
  }

  setOnError(cb: ErrorCallback): void {
    this.errorCallback = cb;
  }

  // --- internals ---

  /**
   * Runs one storage operation across the chain: primary first, then each
   * fallback (breaker-gated, one retry for timeout/server_error per attempt).
   * Returns the first success; exhaustion throws the last original error.
   */
  private async runOperation<T>(operation: string, op: (provider: IStorageProvider) => Promise<T>): Promise<T> {
    let lastError: unknown = null;
    for (let i = 0; i <= this.fallbackSteps.length; i++) {
      const providerId = i === 0 ? this.primaryId : this.fallbackSteps[i - 1].provider.id;
      if (!passBreakerGate(this.breakerRegistry, providerId)) {
        continue;
      }
      try {
        const provider = await this.ensureInstance(i);
        const result = await this.attemptWithRetry(providerId, () => op(provider));
        await markTransitionSucceeded(this.fallbackEvents, this.lastTransitionRowId);
        this.lastTransitionRowId = null;
        return result;
      } catch (error) {
        lastError = error;
        await this.onSetupFailure(operation, providerId, error, i);
      }
    }
    throw await this.exhaust(lastError);
  }

  /** One retry (500 ms backoff) for timeout/server_error. */
  private async attemptWithRetry<T>(providerId: string, attempt: () => Promise<T>): Promise<T> {
    try {
      return await attempt();
    } catch (error) {
      if (isRetryableSetupError(error)) {
        await sleep(RETRY_BACKOFF_MS);
        return attempt();
      }
      throw error;
    }
  }

  /**
   * Failed attempt at full-chain index `stepIndex`: record the transition
   * event (when a next step exists) + the attempts counter.
   */
  private async onSetupFailure(operation: string, failedProviderId: string, error: unknown, stepIndex: number): Promise<void> {
    const code = classifySetupError(error);
    const nextStep = this.fallbackSteps[stepIndex];
    if (nextStep) {
      this.lastTransitionRowId = await recordTransition(this.fallbackEvents, {
        primaryProviderId: this.primaryId,
        failedProviderId,
        nextProviderId: nextStep.provider.id,
        reason: code,
        providerType: 'storage',
        operation,
      });
    }
    this.metrics.inc('fallback_attempts_total', { provider_id: failedProviderId });
  }

  private async exhaust(lastError: unknown): Promise<Error> {
    return exhaustChain({
      metrics: this.metrics,
      primaryId: this.primaryId,
      providerCount: this.providerCount,
      onError: this.errorCallback,
      lastError,
    });
  }

  /**
   * Creates (and caches) the instance at a full-chain index — index 0 is the
   * primary. Creation goes through the factory (which init()-es the instance),
   * so a creation failure is an attempt failure for the caller's chain walk.
   * Non-primary instances are stamped with failover attribution; every
   * instance's error callback is suppressed (the wrapper delivers the
   * registered onError exactly once, on exhaustion).
   */
  private async ensureInstance(index: number): Promise<IStorageProvider> {
    const providerRow = index === 0 ? this.primaryRow : this.fallbackSteps[index - 1].provider;
    const providerId = providerRow.id;
    let instance = this.instances.get(providerId);
    if (!instance) {
      const settings = index === 0 ? this.baseSettings : ({ ...this.baseSettings, ...(this.fallbackSteps[index - 1].settings ?? {}) } as StorageSettings);
      instance = await this.factory.createProvider(providerRow, settings);
      if (index !== 0) {
        instance.setFallbackOf?.(this.primaryId);
      }
      instance.setOnError(async () => {
        // Suppressed per attempt — the chain walk decides (retry/failover/exhaust).
      });
      this.instances.set(providerId, instance);
    }
    return instance;
  }
}
