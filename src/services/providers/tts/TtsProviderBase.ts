import { logger } from '../../../utils/logger';
import type { SimpleCallback, ErrorCallback } from '../../../types/callbacks';
import { GeneratedAudioChunk, ITtsProvider, SpeechGenerationCallback } from './ITtsProvider';
import type { AudioFormat } from '../../../types/audio';
import type { CallMetrics } from '../../../db/schema';
import { getMetricsRegistry, getProviderCallRecorder } from '../../monitoring/ProviderCallRecorder';
import type { ProviderCallRecord } from '../../monitoring/ProviderCallRecorder';
import type { MetricsRegistry } from '../../monitoring/MetricsRegistry';
import { classifyThirdPartyError } from '../../../utils/errorClassification';
import type { ConnectionTestOutcome } from '../connectionTest/types';

/** The fixed minimum-size test text (2–3 words, one sentence). */
const TTS_TEST_TEXT = 'Test connection.';

/** Per-session instrumentation state (one TTS session per AI output turn) — P1-03. */
interface TtsSessionStats {
  startedAt: number;
  firstAudioAt: number | null;
  audioBytes: number;
  audioDurationMs: number;
  hasAudioDuration: boolean;
  chunksCount: number;
  error: Error | null;
  recorded: boolean;
}

/**
 * Abstract base class for TTS provider implementations
 * Provides common functionality and callback management for text-to-speech providers
 * @template TConfig The type of provider-specific configuration
 * @template TChunk The type of audio chunk this provider generates
 */
export abstract class TtsProviderBase<TConfig = Record<string, any>, TChunk extends GeneratedAudioChunk = GeneratedAudioChunk> implements ITtsProvider<TChunk> {
  /** Counter for generating sequential ordinals for audio chunks */
  protected chunkOrdinal: number = 0;

  /** Callback for generation started event */
  protected onGenerationStartedCallback?: SimpleCallback;

  /** Callback for generation ended event */
  protected onGenerationEndedCallback?: SimpleCallback;

  /** Callback for fatal errors */
  protected onErrorCallback?: ErrorCallback;

  /** Callback for generated audio chunks */
  protected onSpeechGeneratingCallback?: SpeechGenerationCallback<TChunk>;

  /** Provider-specific configuration */
  protected config: TConfig;

  /** Stamped by TtsProviderFactory (P1-03). */
  providerId?: string;
  providerApiType?: string;

  /** Stamped by the P3-04 failover wrapper on non-primary instances — session rows carry `fallback_provider_id`. */
  fallbackOfProviderId?: string;

  /** P3-04 failover attribution — implemented for the `ITtsProvider` interface. */
  setFallbackOf(providerId: string): void {
    this.fallbackOfProviderId = providerId;
  }

  private activeSession: TtsSessionStats | null = null;

  /**
   * Creates a new TTS provider base instance
   * @param config Provider-specific configuration
   */
  constructor(config: TConfig) {
    this.config = config;
  }

  /**
   * Initializes the speech generation session
   * Subclasses must implement this to perform provider-specific initialization
   */
  abstract init(): Promise<void>;

  /**
   * Gets the list of supported audio output formats
   * Subclasses must implement this to expose provider capabilities
   */
  abstract getSupportedFormats(): AudioFormat[];

  /**
   * Returns the audio format this provider will produce, based on its internal configuration.
   * @returns The audio format this provider produces
   */
  abstract getOutputFormat(): AudioFormat;

  /**
   * Starts the speech generation session.
   * Template wrapper — opens a per-session instrumentation record; the actual
   * session start lives in `doStart`.
   */
  async start(): Promise<void> {
    this.activeSession = {
      startedAt: Date.now(),
      firstAudioAt: null,
      audioBytes: 0,
      audioDurationMs: 0,
      hasAudioDuration: false,
      chunksCount: 0,
      error: null,
      recorded: false,
    };
    try {
      await this.doStart();
    } catch (error) {
      // Failed setup: the session is dead — record the row so the failed
      // attempt is observable (and P3-04 failover transitions have a trace).
      this.failSession(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Stops and finalizes the speech generation session.
   * Template wrapper — flushes the session row (one `tts.session` row per
   * session); the actual session stop lives in `doEnd`.
   */
  async end(): Promise<void> {
    try {
      await this.doEnd();
      this.flushSession(null);
    } catch (error) {
      this.flushSession(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Cancels the speech generation session (barge-in).
   * The session is abandoned rather than completed: the row is flushed with
   * `metrics.canceled = true` (not an error). Providers without provider-side
   * abort just skip `doCancel` (default no-op).
   */
  async cancel(): Promise<void> {
    try {
      await this.doCancel();
      this.flushSession(null, true);
    } catch (error) {
      this.flushSession(error instanceof Error ? error : new Error(String(error)), true);
      throw error;
    }
  }

  /**
   * Sends text to the speech generation service.
   * Template wrapper — the actual send lives in `doSendText`.
   * @param text The text content to be converted to speech
   */
  async sendText(text: string): Promise<void> {
    try {
      await this.doSendText(text);
    } catch (error) {
      // A rejected send kills the session — record the row (P3-04 failover
      // decides from here whether to rebuild on the next provider).
      this.failSession(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Starts the speech generation session.
   * Must be implemented by subclasses (renamed from `start` — P1-03 template method).
   */
  protected abstract doStart(): Promise<void>;

  /**
   * Stops and finalizes the speech generation session.
   * Must be implemented by subclasses (renamed from `end` — P1-03 template method).
   */
  protected abstract doEnd(): Promise<void>;

  /**
   * Cancels the speech generation session.
   * Override in subclasses only when the provider API supports aborting an in-flight session
   * (renamed from `cancel` — P1-03 template method). Default: no provider-side action.
   */
  protected doCancel(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Sends text to the speech generation service.
   * Must be implemented by subclasses (renamed from `sendText` — P1-03 template method).
   * @param text The text content to be converted to speech
   */
  protected abstract doSendText(text: string): Promise<void>;

  /**
   * Fails the active session now (fatal error): records the row immediately.
   */
  private failSession(error: Error): void {
    this.flushSession(error);
  }

  /** Test seam — overridable so unit tests can redirect recording away from the DI container. */
  protected resolveCallRecorder(): { record(entry: ProviderCallRecord): void } {
    return getProviderCallRecorder();
  }

  /** Test seam — overridable so unit tests can redirect metric publication away from the DI container. */
  protected resolveMetricsRegistry(): MetricsRegistry | null {
    return getMetricsRegistry();
  }

  /**
   * Records one zero-cost liveness probe (P1-05b) as a plain `tts.ping` call-log row.
   * Probe rows feed the same window stats as real traffic; volume is bounded by the
   * HealthCheckService probe cooldown + recent-success skip. Callers: `ping()` implementations.
   */
  protected recordPingCall(startedAt: number, error?: Error): void {
    if (!this.providerId || !this.providerApiType) return;
    this.resolveCallRecorder().record({
      providerId: this.providerId,
      providerType: 'tts',
      apiType: this.providerApiType,
      operation: 'tts.ping',
      durationMs: Date.now() - startedAt,
      ok: !error,
      error,
    });
  }

  /**
   * Flushes the active session: records exactly one `tts.session` call-log row
   * + tts_ttfa_ms / tts_synthesis_ms histograms.
   */
  private flushSession(error: Error | null, canceled = false): void {
    const session = this.activeSession;
    if (!session || session.recorded) {
      this.activeSession = null;
      return;
    }
    session.recorded = true;
    this.activeSession = null;
    if (!this.providerId || !this.providerApiType) return; // constructed outside the factory — nothing to attribute to

    // A barge-in cancel is not an error — ok stays true, the row carries metrics.canceled
    const ok = !error;
    const metrics: CallMetrics = {};
    if (session.audioBytes > 0) metrics.audioBytesOut = session.audioBytes;
    if (session.hasAudioDuration) metrics.audioDurationMs = session.audioDurationMs;
    if (session.chunksCount > 0) metrics.chunksCount = session.chunksCount;
    if (canceled) metrics.canceled = true;

    this.resolveCallRecorder().record({
      providerId: this.providerId,
      providerType: 'tts',
      apiType: this.providerApiType,
      operation: 'tts.session',
      durationMs: Date.now() - session.startedAt,
      ok,
      error: error ?? undefined,
      fallbackProviderId: this.fallbackOfProviderId ?? null,
      metrics,
    });

    const registry = this.resolveMetricsRegistry();
    const labels: Record<string, unknown> = { provider_id: this.providerId, provider_type: 'tts', operation: 'tts.session', ok, error_code: error ? classifyThirdPartyError(error).code : 'none' };
    if (session.firstAudioAt !== null) {
      registry?.observe('tts_ttfa_ms', labels, session.firstAudioAt - session.startedAt);
    }
    registry?.observe('tts_synthesis_ms', labels, Date.now() - session.startedAt);
  }

  /**
   * Registers a callback for when speech generation begins
   * @param cb Callback function that is invoked when generation starts
   */
  setOnGenerationStarted(cb: SimpleCallback): void {
    this.onGenerationStartedCallback = cb;
  }

  /**
   * Registers a callback for when speech generation is completed
   * @param cb Callback function that is invoked when generation ends
   */
  setOnGenerationEnded(cb: SimpleCallback): void {
    this.onGenerationEndedCallback = cb;
  }

  /**
   * Registers a callback for handling speech generation errors
   * @param cb Callback function that receives the error
   */
  setOnError(cb: ErrorCallback): void {
    this.onErrorCallback = cb;
  }

  /**
   * Registers a callback for receiving generated audio chunks
   * @param cb Callback function that receives and processes each generated audio chunk
   */
  setOnSpeechGenerating(cb: SpeechGenerationCallback<TChunk>): void {
    this.onSpeechGeneratingCallback = cb;
  }

  /**
   * Helper method to handle generation started events
   * Called by subclasses when speech generation begins
   */
  protected handleGenerationStarted(): void {
    logger.info(`TTS generation started`);
    if (this.onGenerationStartedCallback) {
      this.onGenerationStartedCallback();
    }
  }

  /**
   * Helper method to handle generation ended events
   * Called by subclasses when speech generation is completed
   */
  protected handleGenerationEnded(): void {
    logger.info(`TTS generation ended`);
    if (this.onGenerationEndedCallback) {
      this.onGenerationEndedCallback();
    }
  }

  /**
   * Helper method to handle fatal errors
   * Called by subclasses when an unrecoverable error occurs
   * @param error Error object or error message
   */
  protected async handleError(error: Error | string): Promise<void> {
    const errorObj = typeof error === 'string' ? new Error(error) : error;
    logger.error(`TTS error: ${errorObj.message}`);
    // Fatal error — flush the session row immediately as failed (P1-03).
    this.failSession(errorObj);
    if (this.onErrorCallback) {
      await this.onErrorCallback(errorObj);
    }
  }

  /**
   * Helper method to handle speech generating events
   * Called by subclasses when audio chunks are generated
   * @param chunk The generated audio chunk
   */
  protected async handleSpeechGenerating(chunk: TChunk): Promise<void> {
    logger.debug(`TTS generating: chunkId=${chunk.chunkId}, ordinal=${chunk.ordinal}, isFinal=${chunk.isFinal}`);
    const session = this.activeSession;
    if (session && !session.recorded) {
      session.chunksCount += 1;
      if (session.firstAudioAt === null) session.firstAudioAt = Date.now();
      session.audioBytes += chunk.audio.length;
      if (chunk.durationMs !== undefined) {
        session.audioDurationMs += chunk.durationMs;
        session.hasAudioDuration = true;
      }
    }
    if (this.onSpeechGeneratingCallback) {
      await this.onSpeechGeneratingCallback(chunk);
    }
  }

  /**
   * Generates a unique chunk ID for audio generation
   * @returns A unique identifier string
   */
  protected generateChunkId(): string {
    return `chunk_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Gets the next ordinal number for audio chunks
   * @returns Sequential ordinal number
   */
  protected getNextOrdinal(): number {
    return this.chunkOrdinal++;
  }

  /**
   * Resets the chunk ordinal counter
   * Should be called when starting a new generation session
   */
  protected resetOrdinal(): void {
    this.chunkOrdinal = 0;
  }

  /**
   * Cleans up resources when the provider is no longer needed
   * Subclasses can override this to perform provider-specific cleanup
   */
  async cleanup(): Promise<void> {
    logger.info(`Cleaning up TTS provider resources`);
    // Conversation end — flush any pending session (e.g. started but never ended)
    this.flushSession(null);
    this.chunkOrdinal = 0;
    this.onGenerationStartedCallback = undefined;
    this.onGenerationEndedCallback = undefined;
    this.onErrorCallback = undefined;
    this.onSpeechGeneratingCallback = undefined;
  }

  /**
   * Minimal production-path connection test (TPC-04): the provider's own
   * streaming synthesis lifecycle on a 2–3 word test string — the same
   * transport, session and callbacks a conversation turn uses. Audio chunks
   * are counted, never persisted, returned, or played. The provider owns the
   * test; the tester owns the guards. `ok` = at least one audio chunk; zero
   * chunks after a clean end → structured server_error. Vendor failures
   * surface via the error callback and are rethrown for the tester to classify.
   * @param voice The voice input param, if any (null → the provider's default).
   */
  async testConnection(voice: string | null): Promise<ConnectionTestOutcome> {
    let bytes = 0;
    let vendorError: Error | null = null;
    // Some providers (e.g. ElevenLabs WS) deliver audio only AFTER end() returns
    // (EOS is fire-and-send), so completion = the provider's generation-ended
    // signal. The tester's hard timeout bounds this wait.
    let resolveEnded: () => void = () => undefined;
    const ended = new Promise<void>((resolve) => {
      resolveEnded = resolve;
    });

    this.setOnSpeechGenerating((chunk) => {
      bytes += chunk.audio.length; // counted, then discarded
      return Promise.resolve();
    });
    this.setOnError((err) => {
      vendorError = err;
      return Promise.resolve();
    });
    this.setOnGenerationEnded(() => {
      resolveEnded();
      return Promise.resolve();
    });

    // The production wrapper (init/start/sendText/end) runs the session
    // lifecycle and records the `tts.session` row — the same path a
    // conversation turn uses.
    await this.init();
    await this.start();
    await this.sendText(TTS_TEST_TEXT);
    await this.end();
    await ended;

    // Vendor failures surface through the error callback (the base wrapper
    // swallows them there) — rethrow so the tester classifies.
    if (vendorError) {
      throw vendorError;
    }
    if (bytes === 0) {
      // Clean stream end with no audio: auth and the session worked, but the
      // round trip produced nothing (bad voice/model, or a swallowed failure).
      return {
        ok: false,
        phase: 'session',
        errorCode: 'server_error',
        errorText: `TTS stream ended without producing any audio (voice: ${voice ?? 'provider default'})`,
        model: voice,
      };
    }
    return {
      ok: true,
      phase: 'first-data',
      errorCode: null,
      model: voice,
      detail: { voice, bytes },
    };
  }
}
