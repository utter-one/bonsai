import { EventEmitter } from 'events';
import SpeexResamplerClass from './speexResampler';
import type { IAudioConverter } from './IAudioConverter';
import type { AudioFormat } from '../../types/audio';
import { pcmSampleRate } from './AudioFormatUtils';

type SpeexResamplerInstance = {
  processChunk(chunk: Buffer): Buffer;
};

/**
 * PCM↔PCM sample-rate converter backed by the libspeex DSP resampler (speex-resampler package).
 * Conversion is synchronous and stateless across calls; reset() is a no-op.
 * Use the static create() factory instead of constructing directly.
 */
export class SpeexPcmResampler extends EventEmitter implements IAudioConverter {
  private constructor(private readonly resampler: SpeexResamplerInstance) {
    super();
  }

  /**
   * Creates a SpeexPcmResampler that converts between two PCM formats.
   * Quality 3 is a good balance between CPU cost and audio fidelity.
   */
  static async create(from: AudioFormat, to: AudioFormat): Promise<SpeexPcmResampler> {
    await SpeexResamplerClass.initPromise;
    const resampler = new SpeexResamplerClass(1, pcmSampleRate(from), pcmSampleRate(to), 3);
    return new SpeexPcmResampler(resampler);
  }

  /** Resamples the chunk synchronously and immediately emits 'data'. */
  push(chunk: Buffer): void {
    try {
      const output = this.resampler.processChunk(chunk);
      this.emit('data', output);
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  /** Emits 'end' immediately — no buffering. */
  end(): void {
    this.emit('end');
  }

  /** No-op: the Speex resampler is stateless across processChunk calls. */
  reset(): void {}

  destroy(): void {}
}
