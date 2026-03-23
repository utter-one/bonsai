import { EventEmitter } from 'events';
import SpeexResamplerClass from './speexResampler';
import type { IAudioConverter } from './IAudioConverter';
import type { AudioFormat } from '../../types/audio';
import { pcmSampleRate } from './AudioFormatUtils';
import { OpusFrameAligner } from './OpusFrameAligner';

/** Opus always operates at 48 kHz internally. */
const OPUS_NATIVE_RATE = 48000;
/** Mono audio. */
const OPUS_CHANNELS = 1;
/** Samples per 20 ms frame at 48 kHz. */
const OPUS_FRAME_SAMPLES = 960;

/**
 * Opus↔PCM converter using the @discordjs/opus libopus native binding.
 * When the PCM sample rate differs from 48 kHz, an internal Speex resampler
 * is automatically chained (PCM→48k before encode; 48k→PCM after decode).
 * All operations are synchronous after construction.
 * Use the static create() factory instead of constructing directly.
 */
export class OpusConverter extends EventEmitter implements IAudioConverter {
  private aligner: OpusFrameAligner;

  private constructor(
    private readonly direction: 'encode' | 'decode',
    private encoder: any,
    private decoder: any,
    private resampler: any,
  ) {
    super();
    this.aligner = new OpusFrameAligner();
  }

  /**
   * Creates an OpusConverter for the given direction.
   * @param direction 'encode' = PCM→Opus, 'decode' = Opus→PCM
   * @param pcmFormat The PCM format on the non-Opus side of the conversion
   */
  static async create(direction: 'encode' | 'decode', pcmFormat: AudioFormat): Promise<OpusConverter> {
    await SpeexResamplerClass.initPromise;

    const pcmRate = pcmSampleRate(pcmFormat);
    // OpusEncoder handles both encode and decode in @discordjs/opus
    const OpusEncoder = (await import('@discordjs/opus')).OpusEncoder;
    const codec = new OpusEncoder(OPUS_NATIVE_RATE, OPUS_CHANNELS);
    let resampler: any = null;

    if (direction === 'encode' && pcmRate !== OPUS_NATIVE_RATE) {
      resampler = new SpeexResamplerClass(OPUS_CHANNELS, pcmRate, OPUS_NATIVE_RATE, 3);
    } else if (direction === 'decode' && pcmRate !== OPUS_NATIVE_RATE) {
      resampler = new SpeexResamplerClass(OPUS_CHANNELS, OPUS_NATIVE_RATE, pcmRate, 3);
    }

    // Store codec in encoder slot for both directions
    return new OpusConverter(direction, codec, null, resampler);
  }

  /** Feed a chunk of PCM (encode) or an Opus packet (decode) into the converter. */
  push(chunk: Buffer): void {
    try {
      if (this.direction === 'encode') {
        this.pushEncode(chunk);
      } else {
        this.pushDecode(chunk);
      }
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Flushes the frame aligner (encode path only) and emits 'end'.
   * A zero-padded partial frame is encoded and emitted if any buffered data remains.
   */
  end(): void {
    try {
      if (this.direction === 'encode') {
        const remainder = this.aligner.flush();
        if (remainder) {
          const pcm48 = this.resampler ? this.resampler.processChunk(remainder) : remainder;
          const encoded = this.encoder.encode(pcm48);
          this.emit('data', encoded);
        }
      }
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
    this.emit('end');
  }

  /**
   * Resets the frame aligner for reuse in the next turn.
   * The Speex resampler and libopus encoder/decoder are stateless across calls
   * so no additional reset is required.
   */
  reset(): void {
    this.aligner.reset();
  }

  destroy(): void {}

  private pushEncode(chunk: Buffer): void {
    // Resample to 48 kHz if necessary, then align and encode
    const pcm48 = this.resampler ? this.resampler.processChunk(chunk) : chunk;
    const frames = this.aligner.push(pcm48);
    for (const frame of frames) {
      const encoded = this.encoder.encode(frame);
      this.emit('data', encoded);
    }
  }

  private pushDecode(chunk: Buffer): void {
    // Decode Opus packet → 48 kHz PCM, then resample down if necessary
    const pcm48 = this.encoder.decode(chunk);
    const output = this.resampler ? this.resampler.processChunk(pcm48) : pcm48;
    this.emit('data', output);
  }
}
