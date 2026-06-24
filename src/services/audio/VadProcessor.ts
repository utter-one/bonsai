import { EventEmitter } from 'events';
import { RealTimeVAD } from 'avr-vad';
import type { ServerVadConfig, LegacyVadConfig, SileroVadConfig, FireRedVadConfig } from '../../http/contracts/vad';
import type { AudioFormat } from '../../types/audio';
import { isPcmFormat, pcmSampleRate } from './AudioFormatUtils';
import { FireRedVadWrapper } from './FireRedVadWrapper';
import logger from '../../utils/logger';
import { RingBuffer } from './RingBuffer';

/** VAD aggressiveness mode → positive/negative speech probability thresholds. */
const MODE_THRESHOLDS = [
  { pos: 0.3, neg: 0.2 },
  { pos: 0.4, neg: 0.3 },
  { pos: 0.5, neg: 0.35 },
  { pos: 0.7, neg: 0.5 },
] as const;

/** Default values for legacy VAD configuration */
const LEGACY_DEFAULTS = {
  mode: 2,
  frameDurationMs: 20,
  silencePaddingMs: 300,
  autoEndSilenceDurationMs: 800,
  gracePeriodMs: 1000,
} as const;

/** Default values for Silero VAD configuration */
const SILERO_DEFAULTS = {
  positiveSpeechThreshold: 0.5,
  negativeSpeechThreshold: 0.35,
  frameSamples: 512,
  redemptionFrames: 8,
  preSpeechPadFrames: 1,
  minSpeechFrames: 3,
  gracePeriodMs: 1000,
} as const;

/** Default values for FireRedVAD configuration */
const FIRERED_DEFAULTS = {
  speechThreshold: 0.5,
  smoothWindowSize: 5,
  minSpeechFrame: 8,
  maxSpeechFrame: 6000,
  minSilenceFrame: 80,
  padStartFrame: 5,
  gracePeriodMs: 1000,
} as const;

/**
 * Converts a Buffer of 16-bit signed little-endian PCM samples to a Float32Array in the range [-1, 1].
 * @param buffer 16-bit PCM buffer
 */
function pcm16ToFloat32(buffer: Buffer): Float32Array {
  const samples = buffer.length / 2;
  const result = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    result[i] = buffer.readInt16LE(i * 2) / 32768;
  }
  return result;
}

/**
 * Converts a Float32Array in the range [-1, 1] to a Buffer of 16-bit signed little-endian PCM samples.
 * @param float32 Float32Array of audio samples
 */
function float32ToPcm16(float32: Float32Array): Buffer {
  const buffer = Buffer.allocUnsafe(float32.length * 2);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    buffer.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  return buffer;
}

/**
 * Wraps avr-vad's RealTimeVAD and exposes an EventEmitter-based interface compatible with
 * the ConversationRunner's audio pipeline.
 *
 * Emits:
 *   `'speech_start'` — emitted when VAD first detects the beginning of speech
 *   `'utterance_audio'` (audio: Float32Array) — emitted with the complete utterance as Float32Array [-1, 1] when speech ends
 *   `'data'` (audio: Buffer) — emitted with the complete utterance as a 16-bit PCM Buffer when speech ends
 *   `'end_of_utterance'` — emitted immediately after `'data'` when speech has finished
 */
export class VadProcessor extends EventEmitter {
  private vad: RealTimeVAD | FireRedVadWrapper | null = null;
  private readonly sampleRate: number;
  private readonly config: ServerVadConfig;
  private gracePeriodEnd: number = 0;
  private lastAudioPushTime: number = 0;
  private ringBuffer: RingBuffer;

  /**
   * @param sampleRate Sample rate of the incoming 16-bit PCM audio
   * @param config Server VAD configuration
   */
  constructor(sampleRate: 8000 | 16000 | 32000 | 48000, config: ServerVadConfig) {
    super();
    this.sampleRate = sampleRate;
    this.config = config;
    this.ringBuffer = new RingBuffer(sampleRate * 2); // buffer up to 1 second of audio for potential pre-speech inclusion
  }

  /**
   * Asynchronously initializes the underlying RealTimeVAD model. Must be called before push().
   */
  async init(): Promise<void> {
    logger.info({ sampleRate: this.sampleRate, config: this.config }, 'Initializing VadProcessor with configuration');
    if (this.config.algorithm === 'silero') {
      await this.initSilero(this.config);
    } else if (this.config.algorithm === 'firered') {
      await this.initFireRed(this.config);
    } else {
      await this.initLegacy(this.config);
    }
  }

  async initLegacy(config: LegacyVadConfig): Promise<void> {
    const mode = config.mode ?? LEGACY_DEFAULTS.mode;
    const frameDurationMs = config.frameDurationMs ?? LEGACY_DEFAULTS.frameDurationMs;
    const { pos, neg } = MODE_THRESHOLDS[mode];
    const frameSamples = Math.round(this.sampleRate * frameDurationMs / 1000);
    const redemptionFrames = Math.round((config.autoEndSilenceDurationMs ?? LEGACY_DEFAULTS.autoEndSilenceDurationMs) / frameDurationMs);
    const preSpeechPadFrames = Math.round((config.silencePaddingMs ?? LEGACY_DEFAULTS.silencePaddingMs) / frameDurationMs);

    this.gracePeriodEnd = Date.now() + (config.gracePeriodMs ?? LEGACY_DEFAULTS.gracePeriodMs);
    const legacyOptions = {
      //sampleRate: this.sampleRate,
      positiveSpeechThreshold: pos,
      negativeSpeechThreshold: neg,
      frameSamples,
      redemptionFrames,
      preSpeechPadFrames,
    };
    logger.info({ options: legacyOptions }, 'RealTimeVAD init (legacy)');
    this.vad = await RealTimeVAD.new({
      ...legacyOptions,
      onSpeechStart: () => {
        if (Date.now() < this.gracePeriodEnd) return;
        this.emit('speech_start');
      },
      onSpeechEnd: (audio: Float32Array) => {
        this.emit('utterance_audio', audio);
        this.emit('data', float32ToPcm16(audio));
        this.emit('end_of_utterance');
      },
      onFrameProcessed: () => {},
      onVADMisfire: () => {},
    });
    this.vad.start();
  }

  async initSilero(config: SileroVadConfig): Promise<void> {
   this.gracePeriodEnd = Date.now() + (config.gracePeriodMs ?? SILERO_DEFAULTS.gracePeriodMs);
    const sileroOptions = {
      //sampleRate: this.sampleRate,
      model: config.model,
      positiveSpeechThreshold: config.positiveSpeechThreshold ?? SILERO_DEFAULTS.positiveSpeechThreshold,
      negativeSpeechThreshold: config.negativeSpeechThreshold ?? SILERO_DEFAULTS.negativeSpeechThreshold,
      frameSamples: config.frameSamples ?? SILERO_DEFAULTS.frameSamples,
      redemptionFrames: config.redemptionFrames ?? SILERO_DEFAULTS.redemptionFrames,
      preSpeechPadFrames: config.preSpeechPadFrames ?? SILERO_DEFAULTS.preSpeechPadFrames,
      minSpeechFrames: config.minSpeechFrames ?? SILERO_DEFAULTS.minSpeechFrames,
      submitUserSpeechOnPause: config.submitUserSpeechOnPause,
    };
    logger.info({ options: sileroOptions }, 'RealTimeVAD init (silero)');
    this.vad = await RealTimeVAD.new({
      ...sileroOptions,
      onSpeechStart: () => {
        if (Date.now() < this.gracePeriodEnd) return;
        this.emit('speech_start');
      },
      onSpeechEnd: (audio: Float32Array) => {
        this.emit('utterance_audio', audio);
        this.emit('data', float32ToPcm16(audio));
        this.emit('end_of_utterance');
      },
      onFrameProcessed: () => {},
      onVADMisfire: () => {},
    });
    this.vad.start();
  }

  async initFireRed(config: FireRedVadConfig): Promise<void> {
    this.gracePeriodEnd = Date.now() + (config.gracePeriodMs ?? FIRERED_DEFAULTS.gracePeriodMs);
    const fireredConfig = {
      speechThreshold: config.speechThreshold ?? FIRERED_DEFAULTS.speechThreshold,
      smoothWindowSize: config.smoothWindowSize ?? FIRERED_DEFAULTS.smoothWindowSize,
      minSpeechFrame: config.minSpeechFrame ?? FIRERED_DEFAULTS.minSpeechFrame,
      maxSpeechFrame: config.maxSpeechFrame ?? FIRERED_DEFAULTS.maxSpeechFrame,
      minSilenceFrame: config.minSilenceFrame ?? FIRERED_DEFAULTS.minSilenceFrame,
      padStartFrame: config.padStartFrame ?? FIRERED_DEFAULTS.padStartFrame,
      gracePeriodMs: config.gracePeriodMs ?? FIRERED_DEFAULTS.gracePeriodMs,
    };
    logger.info({ options: fireredConfig }, 'FireRedVadWrapper init');
    this.vad = new FireRedVadWrapper(this.sampleRate, fireredConfig, {
      onSpeechStart: () => {
        this.emit('speech_start');
      },
      onSpeechEnd: (audio: Float32Array) => {
        this.emit('utterance_audio', audio);
        this.emit('data', float32ToPcm16(audio));
        this.emit('end_of_utterance');
      },
    });
    await this.vad.init();
    await this.vad.initResampler(this.sampleRate);
  }

  /**
   * Feeds a chunk of 16-bit signed little-endian PCM audio into the VAD.
   * @param chunk 16-bit PCM Buffer
   */
  push(chunk: Buffer): void {
    if (!this.vad) return;

    this.ringBuffer.push(chunk);
    this.lastAudioPushTime = Date.now();
    if (this.vad instanceof FireRedVadWrapper) {
      this.vad.processAudio(chunk);
    } else {
      this.vad.processAudio(pcm16ToFloat32(chunk)).catch(() => {});
    }
  }

  /**
   * Flushes any buffered audio into the VAD, potentially triggering a final speech_end event.
   */
  async flush(): Promise<void> {
    if (this.vad) await this.vad.flush();
  }

  /**
   * Resets internal VAD state; call when transitioning to awaiting_user_input to prepare for
   * the next utterance.
   */
  reset(): void {
    if (this.vad) this.vad.reset();
    this.lastAudioPushTime = 0;
  }

  /**
   * Returns true if audio was pushed within the given threshold, indicating the user may
   * still be speaking and VAD hasn't committed to speech_start yet.
   * @param thresholdMs Window in milliseconds
   */
  hasRecentAudio(thresholdMs: number): boolean {
    return this.lastAudioPushTime > 0 && Date.now() - this.lastAudioPushTime < thresholdMs;
  }

  /**
   * Returns the audio currently buffered in the RingBuffer as a single Buffer. This is used by the ConversationRunner
   * to retrieve pre-VAD audio for inclusion in the ASR input when the VAD emits 'speech_start'.
   */
  getBufferedAudio(): Buffer {
    const contents = this.ringBuffer.getContents();
    logger.info({ bufferedAudioLength: contents.length }, 'Retrieving buffered audio from RingBuffer');
    return contents;
  }

  /**
   * Clears the RingBuffer of any buffered audio. This should be called by the ConversationRunner after retrieving buffered audio with getBufferedAudio(),
   * to prevent old audio from being included in the next utterance after a long pause between speech segments.
   */
  clearBufferedAudio(): void {
    this.ringBuffer.clear();
  }

  /**
   * Destroys the underlying VAD instance and releases ONNX model resources.
   */
  destroy(): void {
    if (this.vad) {
      this.vad.destroy();
      this.vad = null;
    }
  }

  /**
   * Returns the PCM sample rate in Hz for the given AudioFormat, or null if the format is not PCM.
   * Used by the ConversationRunner to decide whether server VAD is applicable for a given ASR format.
   * @param format AudioFormat to inspect
   */
  static getSampleRateFromFormat(format: AudioFormat): number | null {
    if (!isPcmFormat(format)) return null;
    return pcmSampleRate(format);
  }
}
