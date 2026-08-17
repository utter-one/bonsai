import { logger } from '../../../utils/logger';
import type { ErrorCallback } from '../../../types/callbacks';
import { IAsrProvider, TextChunk, TextRecognitionCallback } from './IAsrProvider';
import type { AudioFormat } from '../../../types/audio';
import type { CallMetrics } from '../../../db/schema';
import { getMetricsRegistry, getProviderCallRecorder } from '../../monitoring/ProviderCallRecorder';
import type { ProviderCallRecord } from '../../monitoring/ProviderCallRecorder';
import type { MetricsRegistry } from '../../monitoring/MetricsRegistry';
import { classifyThirdPartyError } from '../../../utils/errorClassification';

/** Per-session (per-utterance) instrumentation state — P1-03. */
interface AsrSessionStats {
  startedAt: number;
  setupMs: number | null;
  firstPartialAt: number | null;
  lastInputEndedAt: number | null;
  lastFinalAt: number | null;
  partialsCount: number;
  finalsCount: number;
  audioBytes: number;
  audioFormat: AudioFormat | null;
  error: Error | null;
  recorded: boolean;
}

/**
 * Abstract base class for ASR provider implementations
 * Provides common functionality and callback management for speech recognition providers.
 *
 * Instrumentation (P1-03): the runner opens one recognition session per user
 * utterance (VAD start -> stop), optionally pre-warmed. `start`/`stop`/`sendAudio`
 * are concrete template wrappers; subclasses implement `doStart`/`doStop`/
 * `doSendAudio`. Exactly one `asr.session` call-log row is recorded per
 * session — flushed at recognition-stopped, on fatal error, when superseded by
 * the next `start()`, or at `cleanup()`. Provider identity is stamped by
 * AsrProviderFactory.
 * @template TConfig The type of provider-specific configuration
 */
export abstract class AsrProviderBase<TConfig = Record<string, any>> implements IAsrProvider {
  /** Storage for recognized text chunks */
  protected textChunks: TextChunk[] = [];

  /** Stamped by AsrProviderFactory (P1-03). */
  providerId?: string;
  providerApiType?: string;

  private activeSession: AsrSessionStats | null = null;

  /** Callback for partial recognition results */
  protected onRecognizingCallback?: TextRecognitionCallback;

  /** Callback for finalized recognition results */
  protected onRecognizedCallback?: TextRecognitionCallback;

  /** Callback for recognition stopped event */
  protected onRecognitionStoppedCallback?: () => void;

  /** Callback for recognition started event */
  protected onRecognitionStartedCallback?: () => void;

  /** Callback for fatal errors */
  protected onErrorCallback?: ErrorCallback;

  /** Provider-specific configuration */
  protected config: TConfig;

  /**
   * Creates a new ASR provider base instance
   * @param config Provider-specific configuration
   */
  constructor(config: TConfig) {
    this.config = config;
  }

  /**
   * Initializes the speech recognition session
   * Subclasses should override this to perform provider-specific initialization
   * @param conversation The conversation data containing context and configuration
   */
  async init(): Promise<void> {
    logger.info(`Initializing ASR provider`);
    this.textChunks = [];
  }

  /**
   * Starts the speech recognition session.
   * Template wrapper — opens a new per-session instrumentation record (flushing
   * any superseded pending session first) and records `setupMs`; the actual
   * session start lives in `doStart`.
   */
  async start(): Promise<void> {
    this.flushSession('superseded');
    this.activeSession = {
      startedAt: Date.now(),
      setupMs: null,
      firstPartialAt: null,
      lastInputEndedAt: null,
      lastFinalAt: null,
      partialsCount: 0,
      finalsCount: 0,
      audioBytes: 0,
      audioFormat: null,
      error: null,
      recorded: false,
    };
    const startedAt = Date.now();
    try {
      await this.doStart();
      if (this.activeSession) this.activeSession.setupMs = Date.now() - startedAt;
    } catch (error) {
      this.failSession(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Gets the list of supported audio input formats
   * Subclasses must implement this to expose provider capabilities
   */
  abstract getSupportedInputFormats(): AudioFormat[];

  /**
   * Stops the speech recognition session.
   * Template wrapper — the session row is NOT flushed here: the provider may
   * still deliver final results after stop() (EOF finalization); the flush
   * happens at `handleRecognitionStopped()` (or on error/cleanup).
   * The actual session stop lives in `doStop`.
   */
  async stop(): Promise<void> {
    try {
      await this.doStop();
    } catch (error) {
      // Stopping the session failed — the session is unusable; flush as failed now.
      this.failSession(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Sends audio data to the speech recognition service.
   * Template wrapper — accumulates audio bytes for `sessionAudioMs` estimation;
   * the actual send lives in `doSendAudio`.
   * @param audio Binary audio data buffer to be processed
   */
  async sendAudio(audio: Buffer, format?: AudioFormat): Promise<void> {
    const session = this.activeSession;
    if (session) {
      session.audioBytes += audio.length;
      if (format) session.audioFormat = format;
    }
    await this.doSendAudio(audio, format);
  }

  /**
   * Marks the user end-of-speech timestamp for the active session (P1-03).
   * Called by the ConversationRunner at VAD end-of-utterance.
   * @param ts Unix timestamp in ms; defaults to now
   */
  markInputEnded(ts?: number): void {
    if (this.activeSession) {
      this.activeSession.lastInputEndedAt = ts ?? Date.now();
    }
  }

  /**
   * Starts the speech recognition session.
   * Must be implemented by subclasses (renamed from `start` — P1-03 template method).
   */
  protected abstract doStart(): Promise<void>;

  /**
   * Stops the speech recognition session.
   * Must be implemented by subclasses (renamed from `stop` — P1-03 template method).
   */
  protected abstract doStop(): Promise<void>;

  /**
   * Sends audio data to the speech recognition service.
   * Must be implemented by subclasses (renamed from `sendAudio` — P1-03 template method).
   * @param audio Binary audio data buffer to be processed
   */
  protected abstract doSendAudio(audio: Buffer, format?: AudioFormat): Promise<void>;

  /**
   * Fails the active session now (fatal error): records the row immediately.
   */
  private failSession(error: Error): void {
    if (this.activeSession && !this.activeSession.recorded) {
      this.activeSession.error = error;
      this.flushSession('error');
    }
  }

  /**
   * Flushes the active session: records exactly one `asr.session` call-log row
   * + per-session histograms. `reason` is 'stopped' | 'error' | 'superseded' | 'cleanup'.
   */
  private flushSession(reason: 'stopped' | 'error' | 'superseded' | 'cleanup'): void {
    const session = this.activeSession;
    if (!session || session.recorded) {
      this.activeSession = null;
      return;
    }
    session.recorded = true;
    this.activeSession = null;
    if (!this.providerId || !this.providerApiType) return; // constructed outside the factory — nothing to attribute to

    const ok = !session.error && session.finalsCount > 0;
    const error = session.error ?? undefined;

    const metrics: CallMetrics = {
      partialsCount: session.partialsCount,
      finalsCount: session.finalsCount,
    };
    if (session.setupMs !== null) metrics.setupMs = session.setupMs;
    if (session.firstPartialAt !== null) metrics.timeToFirstPartialMs = session.firstPartialAt - session.startedAt;
    if (session.lastInputEndedAt !== null && session.lastFinalAt !== null) metrics.eosToFinalMs = session.lastFinalAt - session.lastInputEndedAt;
    const audioMs = this.estimateAudioMs(session.audioBytes, session.audioFormat ?? this.defaultInputFormat());
    if (audioMs !== null) metrics.sessionAudioMs = audioMs;

    this.resolveCallRecorder().record({
      providerId: this.providerId,
      providerType: 'asr',
      apiType: this.providerApiType,
      operation: 'asr.session',
      durationMs: Date.now() - session.startedAt,
      ok,
      error,
      metrics,
    });

    const registry = this.resolveMetricsRegistry();
    const labels: Record<string, unknown> = { provider_id: this.providerId, provider_type: 'asr', operation: 'asr.session', ok, error_code: session.error ? classifyThirdPartyError(session.error).code : 'none' };
    if (session.setupMs !== null) registry?.observe('asr_setup_ms', labels, session.setupMs);
    if (session.lastInputEndedAt !== null && session.lastFinalAt !== null) registry?.observe('asr_eos_to_final_ms', labels, session.lastFinalAt - session.lastInputEndedAt);
    if (reason === 'superseded' || reason === 'cleanup') {
      logger.warn({ providerId: this.providerId, reason }, 'ASR session row flushed without recognition-stopped event');
    }
  }

  /** Test seam — overridable so unit tests can redirect recording away from the DI container. */
  protected resolveCallRecorder(): { record(entry: ProviderCallRecord): void } {
    return getProviderCallRecorder();
  }

  /** Test seam — overridable so unit tests can redirect metric publication away from the DI container. */
  protected resolveMetricsRegistry(): MetricsRegistry | null {
    return getMetricsRegistry();
  }

  /** First declared input format — used to estimate sessionAudioMs when sendAudio() omits the format. */
  private defaultInputFormat(): AudioFormat | null {
    try {
      const formats = this.getSupportedInputFormats();
      return formats.length > 0 ? formats[0] : null;
    } catch {
      return null;
    }
  }

  /** Estimates audio duration in ms from bytes when the format has a known sample rate (16-bit mono PCM, 8 kHz u/a-law). */
  private estimateAudioMs(bytes: number, format: AudioFormat | null): number | null {
    if (bytes <= 0 || !format) return null;
    const pcm = /^pcm_(\d+)$/.exec(format);
    if (pcm) {
      return Math.round((bytes / (2 * Number(pcm[1]))) * 1000);
    }
    if (format === 'mulaw' || format === 'alaw') {
      return Math.round((bytes / 8000) * 1000);
    }
    return null;
  }
  /**
   * Registers a callback for partial speech recognition results
   * @param cb Callback function that receives chunk ID and partial text
   */
  setOnRecognizing(cb: TextRecognitionCallback): void {
    this.onRecognizingCallback = cb;
  }

  /**
   * Registers a callback for finalized speech recognition results
   * @param cb Callback function that receives chunk ID and final text
   */
  setOnRecognized(cb: TextRecognitionCallback): void {
    this.onRecognizedCallback = cb;
  }

  /**
   * Registers a callback for when the speech recognition session is stopped
   * @param cb Callback function that is invoked when recognition stops
   */
  setOnRecognitionStopped(cb: () => void): void {
    this.onRecognitionStoppedCallback = cb;
  }

  /**
   * Registers a callback for when the speech recognition session is started
   * @param cb Callback function that is invoked when recognition starts
   */
  setOnRecognitionStarted(cb: () => void): void {
    this.onRecognitionStartedCallback = cb;
  }

  /**
   * Registers a callback for handling fatal recognition errors
   * @param cb Callback function that receives the error
   */
  setOnError(cb: ErrorCallback): void {
    this.onErrorCallback = cb;
  }

  /**
   * Retrieves all text chunks recognized since the last start() call
   * @returns Array of all recognized text chunks with their metadata
   */
  getAllTextChunks(): TextChunk[] {
    return [...this.textChunks];
  }

  /**
   * Resets per-turn state without stopping the session. Used when a pre-warmed ASR session is
   * claimed by an incoming VAD turn so stale state from the idle period is cleared.
   */
  resetForNewTurn(): void {
    this.textChunks = [];
  }

  /**
   * Helper method to handle recognizing events (partial results)
   * Called by subclasses when partial recognition results are available
   * @param chunkId Unique identifier for the text chunk
   * @param text The partial recognized text
   */
  protected handleRecognizing(chunkId: string, text: string): void {
    const session = this.activeSession;
    if (session && !session.recorded) {
      session.partialsCount += 1;
      if (session.firstPartialAt === null) session.firstPartialAt = Date.now();
    }
    if (this.onRecognizingCallback) {
      this.onRecognizingCallback(chunkId, text);
    }
  }

  /**
   * Helper method to handle recognized events (final results)
   * Called by subclasses when final recognition results are available
   * @param chunkId Unique identifier for the text chunk
   * @param text The final recognized text
   */
  protected handleRecognized(chunkId: string, text: string): void {
    const chunk: TextChunk = { chunkId, text, timestamp: new Date() };
    this.textChunks.push(chunk);
    const session = this.activeSession;
    if (session && !session.recorded) {
      session.finalsCount += 1;
      session.lastFinalAt = Date.now();
    }
    if (this.onRecognizedCallback) {
      this.onRecognizedCallback(chunkId, text);
    }
  }

  /**
   * Helper method to handle recognition stopped events
   * Called by subclasses when recognition is stopped
   */
  protected handleRecognitionStopped(): void {
    logger.info(`ASR recognition stopped`);
    // Normal session end — flush the per-session call-log row here (P1-03).
    this.flushSession('stopped');
    if (this.onRecognitionStoppedCallback) {
      this.onRecognitionStoppedCallback();
    }
  }

  /**
   * Helper method to handle fatal errors
   * Called by subclasses when an unrecoverable error occurs
   * @param error Error object or error message
   */
  protected async handleError(error: Error | string): Promise<void> {
    const errorObj = typeof error === 'string' ? new Error(error) : error;
    logger.error(`ASR error: ${errorObj.message}`);
    // Fatal error — flush the session row immediately as failed (P1-03).
    this.failSession(errorObj);
    if (this.onErrorCallback) {
      await this.onErrorCallback(errorObj);
    }
  }

  /**
   * Generates a unique chunk ID for text recognition
   * @returns A unique identifier string
   */
  protected generateChunkId(): string {
    return `chunk_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Cleans up resources when the provider is no longer needed
   * Subclasses can override this to perform provider-specific cleanup
   */
  async cleanup(): Promise<void> {
    logger.info(`Cleaning up ASR provider resources`);
    // Conversation end — flush any pending session (e.g. pre-warmed but unused)
    this.flushSession('cleanup');
    this.textChunks = [];
    this.onRecognizingCallback = undefined;
    this.onRecognizedCallback = undefined;
    this.onRecognitionStoppedCallback = undefined;
    this.onErrorCallback = undefined;
  }
}
