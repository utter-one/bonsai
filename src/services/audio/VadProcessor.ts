import { EventEmitter } from 'events';
import { RealTimeVAD } from 'avr-vad';
import type { ServerVadConfig } from '../../http/contracts/vad';
import type { AudioFormat } from '../../types/audio';
import { isPcmFormat, pcmSampleRate } from './AudioFormatUtils';

/** VAD aggressiveness mode → positive/negative speech probability thresholds. */
const MODE_THRESHOLDS = [
  { pos: 0.3, neg: 0.2 },  // mode 0 — permissive
  { pos: 0.4, neg: 0.3 },  // mode 1 — moderate-low
  { pos: 0.5, neg: 0.35 }, // mode 2 — moderate (default)
  { pos: 0.7, neg: 0.5 },  // mode 3 — aggressive
] as const;

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
 *   `'data'` (audio: Buffer) — emitted with the complete utterance as a 16-bit PCM Buffer when speech ends
 *   `'end_of_utterance'` — emitted immediately after `'data'` when speech has finished
 */
export class VadProcessor extends EventEmitter {
  private vad: RealTimeVAD | null = null;
  private readonly sampleRate: number;
  private readonly config: Required<ServerVadConfig>;

  /**
   * @param sampleRate Sample rate of the incoming 16-bit PCM audio
   * @param config Server VAD configuration
   */
  constructor(sampleRate: 8000 | 16000 | 32000 | 48000, config: ServerVadConfig) {
    super();
    this.sampleRate = sampleRate;
    this.config = {
      mode: config.mode ?? 2,
      frameDurationMs: config.frameDurationMs ?? 20,
      silencePaddingMs: config.silencePaddingMs ?? 300,
      autoEndSilenceDurationMs: config.autoEndSilenceDurationMs ?? 800,
    };
  }

  /**
   * Asynchronously initializes the underlying RealTimeVAD model. Must be called before push().
   */
  async init(): Promise<void> {
    const { pos, neg } = MODE_THRESHOLDS[this.config.mode];
    const frameSamples = Math.round(this.sampleRate * this.config.frameDurationMs / 1000);
    const redemptionFrames = Math.round(this.config.autoEndSilenceDurationMs / this.config.frameDurationMs);
    const preSpeechPadFrames = Math.round(this.config.silencePaddingMs / this.config.frameDurationMs);

    this.vad = await RealTimeVAD.new({
      sampleRate: this.sampleRate,
      positiveSpeechThreshold: pos,
      negativeSpeechThreshold: neg,
      frameSamples,
      redemptionFrames,
      preSpeechPadFrames,
      onSpeechStart: () => { this.emit('speech_start'); },
      onSpeechEnd: (audio: Float32Array) => {
        this.emit('data', float32ToPcm16(audio));
        this.emit('end_of_utterance');
      },
      onFrameProcessed: () => {},
      onVADMisfire: () => {},
    });
    this.vad.start();
  }

  /**
   * Feeds a chunk of 16-bit signed little-endian PCM audio into the VAD.
   * @param chunk 16-bit PCM Buffer
   */
  push(chunk: Buffer): void {
    if (!this.vad) return;
    this.vad.processAudio(pcm16ToFloat32(chunk)).catch(() => {});
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
