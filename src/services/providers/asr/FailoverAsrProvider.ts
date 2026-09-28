import type { ErrorCallback } from '../../../types/callbacks';
import type { AudioFormat } from '../../../types/audio';
import type { IAsrProvider, TextChunk, TextRecognitionCallback } from './IAsrProvider';
import type { AsrProviderFactory } from './AsrProviderFactory';
import type { FallbackStep } from '../FallbackResolver';
import type { CircuitBreakerRegistry } from '../../monitoring/CircuitBreakerRegistry';
import type { FallbackEventService } from '../../monitoring/FallbackEventService';
import type { MetricsRegistry } from '../../monitoring/MetricsRegistry';
import { logger } from '../../../utils/logger';
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
 * P3-04 — failover wrapper for conversation ASR sessions.
 *
 * ASR is session-based (pre-warmed across turns: init once, start per VAD
 * turn, sendAudio while the VAD is open). Failover applies **only to session
 * setup** — `init()` and `start()` rejections. Mid-session failures
 * (`sendAudio` rejection, recognition error callback) never fail over: audio
 * is already flowing and a new provider would only see the tail of the
 * utterance (the lost head is unrecoverable — documented limitation).
 *
 * The chain position resets on every `start()` (each VAD turn re-walks the
 * chain from the primary, so a recovered primary takes its turns back).
 * Instances are created lazily on first attempt and cached; each instance is
 * `init()`-ed exactly once. Transition rows + `fallback_attempts_total` /
 * `provider_chain_exhausted_total` mirror the P3-03 LLM wrapper; failed
 * attempts leave `asr.session` call-log rows with `fallback_provider_id`
 * stamped via `setFallbackOf`.
 */
export class FailoverAsrProvider implements IAsrProvider {
  /** The chain's primary provider id (audit / fallback_events semantics). */
  readonly primaryId: string;

  private readonly primary: IAsrProvider;
  private readonly fallbackSteps: FallbackStep[];
  private readonly baseSettings: unknown;
  private readonly factory: AsrProviderFactory;
  private readonly breakerRegistry: CircuitBreakerRegistry;
  private readonly fallbackEvents: FallbackEventService;
  private readonly metrics: MetricsRegistry;

  private readonly instances = new Map<string, IAsrProvider>();
  private readonly initialized = new Set<string>();
  private lastTransitionRowId: string | null = null;

  /** The provider owning the current session (null until init/start succeeds). */
  private active: IAsrProvider | null = null;

  private recognizingCallback?: TextRecognitionCallback;
  private recognizedCallback?: TextRecognitionCallback;
  private stoppedCallback?: () => void;
  private startedCallback?: () => void;
  private errorCallback?: ErrorCallback;

  constructor(
    primaryId: string,
    primary: IAsrProvider,
    fallbackSteps: FallbackStep[],
    baseSettings: unknown,
    deps: {
      factory: AsrProviderFactory;
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

  /**
   * Initialises a provider from the chain (primary first). A setup failure
   * fails over; exhaustion throws the last original error.
   */
  async init(): Promise<void> {
    let lastError: unknown = null;
    for (let i = 0; i <= this.fallbackSteps.length; i++) {
      const providerId = this.providerIdForIndex(i);
      if (!passBreakerGate(this.breakerRegistry, providerId)) {
        continue;
      }
      try {
        const provider = await this.ensureInstance(i);
        if (!this.initialized.has(providerId)) {
          await provider.init();
          this.initialized.add(providerId);
        }
        this.wireCallbacks(provider);
        this.active = provider;
        await markTransitionSucceeded(this.fallbackEvents, this.lastTransitionRowId);
        this.lastTransitionRowId = null;
        return;
      } catch (error) {
        lastError = error;
        await this.onSetupFailure(providerId, error, i);
      }
    }
    throw await this.exhaust(lastError);
  }

  /**
   * Starts a recognition session, walking the chain from the primary (the
   * chain position resets per turn). One retry (500 ms) for
   * timeout/server_error on each attempt.
   */
  async start(): Promise<void> {
    let lastError: unknown = null;
    for (let i = 0; i <= this.fallbackSteps.length; i++) {
      const providerId = this.providerIdForIndex(i);
      if (!passBreakerGate(this.breakerRegistry, providerId)) {
        continue;
      }
      try {
        const provider = await this.ensureInstance(i);
        if (!this.initialized.has(providerId)) {
          await provider.init();
          this.initialized.add(providerId);
        }
        this.wireCallbacks(provider);
        await this.attemptWithRetry(providerId, () => provider.start());
        this.active = provider;
        await markTransitionSucceeded(this.fallbackEvents, this.lastTransitionRowId);
        this.lastTransitionRowId = null;
        return;
      } catch (error) {
        lastError = error;
        await this.onSetupFailure(providerId, error, i);
      }
    }
    throw await this.exhaust(lastError);
  }

  /** Mid-session: no failover — surface exactly as without failover. */
  async sendAudio(audio: Buffer, format?: AudioFormat): Promise<void> {
    await this.requireActive().sendAudio(audio, format);
  }

  /** Mid-session: no failover. */
  markInputEnded(ts?: number): void {
    this.active?.markInputEnded(ts);
  }

  /** Mid-session: no failover — the session row is flushed by the base. */
  async stop(): Promise<void> {
    await this.requireActive().stop();
  }

  setOnRecognizing(cb: TextRecognitionCallback): void {
    this.recognizingCallback = cb;
  }

  setOnRecognized(cb: TextRecognitionCallback): void {
    this.recognizedCallback = cb;
  }

  setOnRecognitionStopped(cb: () => void): void {
    this.stoppedCallback = cb;
  }

  setOnRecognitionStarted(cb: () => void): void {
    this.startedCallback = cb;
  }

  setOnError(cb: ErrorCallback): void {
    this.errorCallback = cb;
  }

  getAllTextChunks(): TextChunk[] {
    return this.requireActive().getAllTextChunks();
  }

  resetForNewTurn(): void {
    this.requireActive().resetForNewTurn();
  }

  /** The active provider's input formats (primary's before a session exists). */
  getSupportedInputFormats(): AudioFormat[] {
    return (this.active ?? this.primary).getSupportedInputFormats();
  }

  /** Forwards cleanup to the primary and every created fallback instance. */
  async cleanup(): Promise<void> {
    await this.primary.cleanup();
    for (const instance of this.instances.values()) {
      await instance.cleanup();
    }
  }

  // --- internals ---

  private requireActive(): IAsrProvider {
    if (!this.active) {
      throw new Error('ASR session not initialised');
    }
    return this.active;
  }

  private providerIdForIndex(index: number): string {
    return index === 0 ? this.primaryId : this.fallbackSteps[index - 1].provider.id;
  }

  /** One retry (500 ms backoff) for setup-phase timeout/server_error. */
  private async attemptWithRetry<T>(providerId: string, attempt: () => Promise<T>): Promise<T> {
    try {
      return await attempt();
    } catch (error) {
      if (isRetryableSetupError(error)) {
        logger.warn({ providerId, code: classifySetupError(error) }, 'Failover (ASR): setup-phase failure is retryable — one retry after 500 ms');
        await sleep(RETRY_BACKOFF_MS);
        return attempt();
      }
      throw error;
    }
  }

  /**
   * Setup-phase failure at full-chain index `stepIndex`: record the transition
   * event (when a next step exists) + the attempts counter. The failed
   * provider's base already flushed its `asr.session` row (ok=false).
   */
  private async onSetupFailure(failedProviderId: string, error: unknown, stepIndex: number): Promise<void> {
    const code = classifySetupError(error);
    const nextStep = this.fallbackSteps[stepIndex];
    if (nextStep) {
      this.lastTransitionRowId = await recordTransition(this.fallbackEvents, {
        primaryProviderId: this.primaryId,
        failedProviderId,
        nextProviderId: nextStep.provider.id,
        reason: code,
        providerType: 'asr',
        operation: 'asr.session',
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

  /** Lazily creates (and caches) the instance at a full-chain index; stamps failover attribution. */
  private async ensureInstance(index: number): Promise<IAsrProvider> {
    if (index === 0) return this.primary;
    const step = this.fallbackSteps[index - 1];
    let instance = this.instances.get(step.provider.id);
    if (!instance) {
      const settings = { ...(this.baseSettings as Record<string, unknown>), ...(step.settings ?? {}) };
      instance = await this.factory.createProvider(step.provider, settings);
      this.instances.set(step.provider.id, instance);
    }
    // Idempotent: stamped on every use so pre-created instances (tests) are covered too.
    instance.setFallbackOf?.(this.primaryId);
    return instance;
  }

  /**
   * Wires the provider to the caller's callbacks. No suppression: a resolved
   * start() means the session is live, so mid-session errors surface exactly
   * as without failover.
   */
  private wireCallbacks(provider: IAsrProvider): void {
    if (this.recognizingCallback) {
      provider.setOnRecognizing((chunkId, text) => this.recognizingCallback!(chunkId, text));
    }
    if (this.recognizedCallback) {
      provider.setOnRecognized((chunkId, text) => this.recognizedCallback!(chunkId, text));
    }
    if (this.stoppedCallback) {
      provider.setOnRecognitionStopped(() => this.stoppedCallback!());
    }
    if (this.startedCallback) {
      provider.setOnRecognitionStarted(() => this.startedCallback!());
    }
    if (this.errorCallback) {
      provider.setOnError(async (error: Error) => {
        await this.errorCallback!(error);
      });
    }
  }
}
