import { EventEmitter } from 'events';
import ffmpegPath from 'ffmpeg-static';
import type { IAudioConverter } from './IAudioConverter';
import type { AudioFormat } from '../../types/audio';
import { selectConverterTier } from './AudioFormatUtils';
import { SpeexPcmResampler } from './SpeexPcmResampler';
import { OpusConverter } from './OpusConverter';
import { G711Converter } from './G711Converter';
import { FfmpegAudioConverter } from './FfmpegAudioConverter';

/**
 * A no-op converter for identical format pairs.
 * Emits 'data' synchronously for each push() and 'end' on end().
 */
class PassthroughConverter extends EventEmitter implements IAudioConverter {
  push(chunk: Buffer): void { this.emit('data', chunk); }
  end(): void { this.emit('end'); }
  reset(): void {}
  destroy(): void {}
}

/**
 * Factory for bidirectional audio converters.
 * Selects the optimal in-process tier (passthrough → speex → opus → g711)
 * and falls back to an ffmpeg subprocess for unsupported format pairs.
 */
export class AudioConverterFactory {
  /**
   * Creates the optimal converter for the given format pair.
   * Returns a PassthroughConverter when from === to (formats are identical).
   */
  static async create(from: AudioFormat, to: AudioFormat): Promise<IAudioConverter> {
    const tier = selectConverterTier(from, to);

    switch (tier) {
      case 'passthrough':
        return new PassthroughConverter();

      case 'speex':
        return SpeexPcmResampler.create(from, to);

      case 'opus': {
        const direction = from === 'opus' ? 'decode' : 'encode';
        const pcmFormat = direction === 'decode' ? to : from;
        return OpusConverter.create(direction, pcmFormat);
      }

      case 'g711':
        return G711Converter.create(from, to);

      case 'ffmpeg': {
        if (!ffmpegPath) throw new Error('ffmpeg-static: binary not found');
        return new FfmpegAudioConverter(from, to, ffmpegPath);
      }
    }
  }
}
