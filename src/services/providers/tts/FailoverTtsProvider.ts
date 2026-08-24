import type { SimpleCallback, ErrorCallback } from '../../../types/callbacks';
import type { GeneratedAudioChunk, ITtsProvider, SpeechGenerationCallback } from './ITtsProvider';
import type { AudioFormat } from '../../../types/audio';
import type { TtsProviderFactory, TtsSettings } from './TtsProviderFactory';
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
 * P3-04 — failover wrapper for conversation TTS sessions.
 *
 * TTS is session-based (one session per AI output turn: start → sendText per
 * LLM chunk → end), so the failover boundaries are:
 * - **session setup**: `init()`/`start()` rejection → next provider;
 * - **per-turn pre-audio**: `sendText()` rejection *before the first
 *   `onSpeechGenerating` chunk of the turn* → rebuild the session on the next
 *   provider (init + start + sendText).
 * After the first chunk of a turn, errors rethrow (no failover — audio is
 * already flowing downstream into the client's audio pipeline).
 *
 * The chain position **resets every turn**: each `start()` walks the chain
 * from the primary (a recovered primary gets its turns back; an open circuit
 * makes the skip instant). A mid-turn failover continues from the failed
 * provider's next position within that turn.
 *
 * Fallback instances are pre-created by the conversation builder (output-format
 * compatibility is checked against the instances) and passed in; each instance
 * is `init()`-ed exactly once (Deepgram TTS' init() opens a persistent
 * WebSocket). Transition rows + `fallback_attempts_total` /
 * `provider_chain_exhausted_total` mirror the P3-03 LLM wrapper; failed
 * attempts leave `tts.session` call-log rows (the base flushes on setup/send
 * failure) with `fallback_provider_id` stamped via `setFallbackOf`.
 *
 * `getOutputFormat()`/`getSupportedFormats()` delegate to the primary — the
 * chain is format-compatible by construction (compatible prefix, builder).
 */
export class FailoverTtsProvider implements ITtsProvider {
  /** The chain's primary provider id (audit / fallback_events semantics). */
  readonly primaryId: string;

  private readonly primary: ITtsProvider;
  private readonly fallbackSteps: FallbackStep[];
  private readonly baseSettings: TtsSettings;
  private readonly factory: TtsProviderFactory;
  private readonly breakerRegistry: CircuitBreakerRegistry;
  private readonly fallbackEvents: FallbackEventService;
  private readonly metrics: MetricsRegistry;

  /** Fallback instances, pre-created by the builder (format check). */
  private readonly instances = new Map<string, ITtsProvider>();
  /** Instances that have been init()-ed exactly once. */
  private readonly initialized = new Set<string>();
  /** Row id of the most recent transition event (into the step being attempted). */
  private lastTransitionRowId: string | null = null;

  /** The provider owning the current session (null until start() succeeds). */
  private active: ITtsProvider | null = null;
  /** Index of the active provider within the full chain ([primary, ...steps]). */
  private activeIndex = -1;
  /** True once any audio chunk was delivered downstream this turn. */
  private turnDelivered = false;

  private startedCallback?: SimpleCallback;
  private endedCallback?: SimpleCallback;
  private errorCallback?: ErrorCallback;
  private speechCallback?: SpeechGenerationCallback<GeneratedAudioChunk>;

  constructor(
    primaryId: string,
    primary: ITtsProvider,
    fallbackSteps: FallbackStep[],
    baseSettings: TtsSettings,
    deps: {
      factory: TtsProviderFactory;
      breakerRegistry: CircuitBreakerRegistry;
      fallbackEvents: FallbackEventService;
      metrics: MetricsRegistry;
      precreatedInstances?: Map<string, ITtsProvider>;
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
    if (deps.precreatedInstances) {
      for (const [providerId, instance] of deps.precreatedInstances) {
        this.instances.set(providerId, instance);
      }
    }
  }

  /** Number of providers in the chain (primary + fallbacks). */
  get providerCount(): number {
    return this.fallbackSteps.length + 1;
  }

  /** Initialises the primary. Fallback instances are initialised on first use. */
  async init(): Promise<void> {
    await this.primary.init();
    this.initialized.add(this.primaryId);
  }

  /** Primary only — the chain is format-compatible by construction. */
  getSupportedFormats(): AudioFormat[] {
    return this.primary.getSupportedFormats();
  }

  /** Primary only — the chain is format-compatible by construction. */
  getOutputFormat(): AudioFormat {
    return this.primary.getOutputFormat();
  }

  async start(): Promise<void> {
    this.turnDelivered = false;
    await this.runSetupChain(0, null);
  }

  async sendText(text: string): Promise<void> {
    if (!this.active) {
      throw new Error('TTS session not started');
    }
    try {
      await this.active.sendText(text);
      return;
    } catch (error) {
      if (this.turnDelivered) {
        // Mid-turn: audio is already flowing — surface exactly as without failover.
        throw error;
      }
      // Pre-audio failure this turn: rebuild the session further down the chain.
      await this.onSetupFailure(this.primaryIdForIndex(this.activeIndex), error, this.activeIndex);
      await this.runSetupChain(this.activeIndex + 1, text);
    }
  }

  /** Finalizes the active session (no failover). */
  async end(): Promise<void> {
    if (!this.active) return;
    await this.active.end();
  }

  /** Cancels the active session (barge-in; no failover). */
  async cancel(): Promise<void> {
    if (!this.active) return;
    await this.active.cancel?.();
  }

  setOnGenerationStarted(cb: SimpleCallback): void {
    this.startedCallback = cb;
  }

  setOnGenerationEnded(cb: SimpleCallback): void {
    this.endedCallback = cb;
  }

  setOnError(cb: ErrorCallback): void {
    this.errorCallback = cb;
  }

  setOnSpeechGenerating(cb: SpeechGenerationCallback<GeneratedAudioChunk>): void {
    this.speechCallback = cb;
  }

  /**
   * Forwards cleanup to the primary and every created fallback instance (a
   * superset of "the active session" — failed attempts may hold open sockets).
   */
  async cleanup(): Promise<void> {
    await this.primary.cleanup();
    for (const instance of this.instances.values()) {
      await instance.cleanup();
    }
  }

  // --- internals ---

  /** The provider id at a full-chain index (0 = primary). */
  private primaryIdForIndex(index: number): string {
    return index === 0 ? this.primaryId : this.fallbackSteps[index - 1].provider.id;
  }

  /**
   * Walks the chain from `startIndex` to (re)establish a session, optionally
   * immediately sending `text` on the provider that takes the session.
   * Throws the chain-exhaustion error when no provider takes it.
   */
  private async runSetupChain(startIndex: number, text: string | null): Promise<void> {
    let lastError: unknown = null;
    for (let i = startIndex; i <= this.fallbackSteps.length; i++) {
      const providerId = this.primaryIdForIndex(i);
      if (!passBreakerGate(this.breakerRegistry, providerId)) {
        continue;
      }
      const provider = await this.ensureInstance(i);
      try {
        if (!this.initialized.has(providerId)) {
          await provider.init();
          this.initialized.add(providerId);
        }
        this.wireCallbacks(provider);
        const attempt = async () => {
          await provider.start();
          if (text !== null) await provider.sendText(text);
        };
        await this.attemptWithRetry(providerId, attempt);
        this.active = provider;
        this.activeIndex = i;
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

  /** One retry (500 ms backoff) for setup-phase timeout/server_error. */
  private async attemptWithRetry<T>(providerId: string, attempt: () => Promise<T>): Promise<T> {
    try {
      return await attempt();
    } catch (error) {
      if (this.turnDelivered) {
        throw error;
      }
      if (isRetryableSetupError(error)) {
        logger.warn({ providerId, code: classifySetupError(error) }, 'Failover (TTS): setup-phase failure is retryable — one retry after 500 ms');
        await sleep(RETRY_BACKOFF_MS);
        return attempt();
      }
      throw error;
    }
  }

  /**
   * Setup-phase failure at full-chain index `stepIndex`: record the transition
   * event (when a next step exists) + the attempts counter, and let the walk
   * continue. Per-attempt onError deliveries are suppressed by the wiring —
   * the caller sees exactly one onError (exhaustion) or none (failover ok).
   */
  private async onSetupFailure(failedProviderId: string, error: unknown, stepIndex: number): Promise<void> {
    // The failed provider's base already flushed its `tts.session` row (ok=false).
    const code = classifySetupError(error);
    const nextStep = this.fallbackSteps[stepIndex];
    if (nextStep) {
      this.lastTransitionRowId = await recordTransition(this.fallbackEvents, {
        primaryProviderId: this.primaryId,
        failedProviderId,
        nextProviderId: nextStep.provider.id,
        reason: code,
        providerType: 'tts',
        operation: 'tts.session',
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
   * Resolves the instance at a full-chain index. Index 0 is the primary;
   * fallbacks come from the pre-created map (format-checked) and are stamped
   * with failover attribution on first use.
   */
  private async ensureInstance(index: number): Promise<ITtsProvider> {
    if (index === 0) return this.primary;
    const step = this.fallbackSteps[index - 1];
    let instance = this.instances.get(step.provider.id);
    if (!instance) {
      const settings = { ...this.baseSettings, ...(step.settings ?? {}) } as TtsSettings;
      instance = await this.factory.createProvider(step.provider, settings);
      this.instances.set(step.provider.id, instance);
    }
    // Idempotent: stamped on every use so pre-created instances (tests) are covered too.
    instance.setFallbackOf?.(this.primaryId);
    return instance;
  }

  /**
   * Wires the attempt's provider to the caller's callbacks with failover
   * state tracking. The chunk forwarder sets `turnDelivered`; onError is
   * suppressed for pre-audio deliveries (the chain may still succeed).
   */
  private wireCallbacks(provider: ITtsProvider): void {
    provider.setOnSpeechGenerating(async (chunk: GeneratedAudioChunk) => {
      this.turnDelivered = true;
      if (this.speechCallback) {
        await this.speechCallback(chunk);
      }
    });
    provider.setOnError(async (error: Error) => {
      if (this.turnDelivered) {
        // Mid-turn: surface exactly as without failover.
        if (this.errorCallback) {
          await this.errorCallback(error);
        }
      } else {
        // Pre-audio callback-channel error: the setup promises already
        // resolved, so the wrapper cannot rebuild the session — log and drop
        // (the runner's turn state is driven by the stream, not this error).
        logger.warn({ providerId: this.primaryIdForIndex(this.activeIndex) }, 'Failover (TTS): pre-audio error from provider callback — no failover (callback channel)');
      }
    });
    if (this.startedCallback) {
      provider.setOnGenerationStarted(async () => {
        await this.startedCallback!();
      });
    }
    if (this.endedCallback) {
      provider.setOnGenerationEnded(async () => {
        await this.endedCallback!();
      });
    }
  }
}
