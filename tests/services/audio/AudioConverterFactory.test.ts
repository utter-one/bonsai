import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AudioFormat } from '../../../src/types/audio';

vi.mock('../../../src/services/audio/SpeexPcmResampler', () => {
  const create = vi.fn().mockResolvedValue({ push: vi.fn(), end: vi.fn(), reset: vi.fn(), destroy: vi.fn() });
  return {
    SpeexPcmResampler: { create },
    __mocks: { create },
  };
});

vi.mock('../../../src/services/audio/G711Converter', () => {
  const create = vi.fn().mockResolvedValue({ push: vi.fn(), end: vi.fn(), reset: vi.fn(), destroy: vi.fn() });
  return {
    G711Converter: { create },
    __mocks: { create },
  };
});

vi.mock('../../../src/services/audio/FfmpegAudioConverter', () => {
  const instance: any = {};
  return {
    FfmpegAudioConverter: class MockFfmpeg {
      constructor(from: string, to: string, ffmpegPath: string) {
        instance.from = from;
        instance.to = to;
        instance.ffmpegPath = ffmpegPath;
        instance.push = vi.fn();
        instance.end = vi.fn();
        instance.reset = vi.fn();
        instance.destroy = vi.fn();
      }
    },
    __mockInstance: instance,
  };
});

vi.mock('ffmpeg-static', () => ({
  default: '/fake/path/to/ffmpeg',
}));

vi.mock('../../../src/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { AudioConverterFactory } from '../../../src/services/audio/AudioConverterFactory';
import { __mocks as speexMocks } from '../../../src/services/audio/SpeexPcmResampler';
import { __mocks as g711Mocks } from '../../../src/services/audio/G711Converter';
import { __mockInstance as mockFfmpegInstance } from '../../../src/services/audio/FfmpegAudioConverter';

const mockSpeexCreate = speexMocks.create;
const mockG711Create = g711Mocks.create;

describe('AudioConverterFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('passthrough tier', () => {
    it('returns passthrough for identical PCM formats', async () => {
      const converter = await AudioConverterFactory.create('pcm_16000' as AudioFormat, 'pcm_16000' as AudioFormat);
      expect(converter).toBeDefined();
      expect(mockSpeexCreate).not.toHaveBeenCalled();

      const dataChunks: Buffer[] = [];
      converter.on('data', (chunk: Buffer) => dataChunks.push(chunk));

      converter.push(Buffer.from([1, 2, 3]));
      expect(dataChunks).toHaveLength(1);
      expect(dataChunks[0]).toEqual(Buffer.from([1, 2, 3]));
    });

    it('returns passthrough for identical non-PCM formats', async () => {
      const converter = await AudioConverterFactory.create('mp3' as AudioFormat, 'mp3' as AudioFormat);
      expect(converter).toBeDefined();
      expect(mockSpeexCreate).not.toHaveBeenCalled();
    });

    it('passthrough emits end on end()', async () => {
      const converter = await AudioConverterFactory.create('pcm_16000' as AudioFormat, 'pcm_16000' as AudioFormat);
      let ended = false;
      converter.on('end', () => { ended = true; });

      converter.end();
      expect(ended).toBe(true);
    });

    it('passthrough reset and destroy are no-ops', async () => {
      const converter = await AudioConverterFactory.create('pcm_16000' as AudioFormat, 'pcm_16000' as AudioFormat);
      expect(() => converter.reset()).not.toThrow();
      expect(() => converter.destroy()).not.toThrow();
    });
  });

  describe('speex tier', () => {
    it('dispatches to SpeexPcmResampler for PCM-to-PCM conversion', async () => {
      await AudioConverterFactory.create('pcm_16000' as AudioFormat, 'pcm_48000' as AudioFormat);
      expect(mockSpeexCreate).toHaveBeenCalledWith('pcm_16000', 'pcm_48000');
    });

    it('dispatches to SpeexPcmResampler for all PCM format pairs', async () => {
      await AudioConverterFactory.create('pcm_8000' as AudioFormat, 'pcm_24000' as AudioFormat);
      expect(mockSpeexCreate).toHaveBeenCalledWith('pcm_8000', 'pcm_24000');
    });

    it('returns the Speex resampler instance', async () => {
      const mockResampler = { push: vi.fn(), end: vi.fn(), reset: vi.fn(), destroy: vi.fn() };
      mockSpeexCreate.mockResolvedValueOnce(mockResampler);

      const converter = await AudioConverterFactory.create('pcm_16000' as AudioFormat, 'pcm_48000' as AudioFormat);
      expect(converter).toBe(mockResampler);
    });
  });

  describe('g711 tier', () => {
    it('dispatches to G711Converter for mulaw-to-PCM conversion', async () => {
      await AudioConverterFactory.create('mulaw' as AudioFormat, 'pcm_16000' as AudioFormat);
      expect(mockG711Create).toHaveBeenCalledWith('mulaw', 'pcm_16000');
    });

    it('dispatches to G711Converter for PCM-to-alaw conversion', async () => {
      await AudioConverterFactory.create('pcm_48000' as AudioFormat, 'alaw' as AudioFormat);
      expect(mockG711Create).toHaveBeenCalledWith('pcm_48000', 'alaw');
    });

    it('returns the G711 converter instance', async () => {
      const mockConv = { push: vi.fn(), end: vi.fn(), reset: vi.fn(), destroy: vi.fn() };
      mockG711Create.mockResolvedValueOnce(mockConv);

      const converter = await AudioConverterFactory.create('mulaw' as AudioFormat, 'pcm_16000' as AudioFormat);
      expect(converter).toBe(mockConv);
    });
  });

  describe('ffmpeg tier', () => {
    it('dispatches to FfmpegAudioConverter for mp3 conversions', async () => {
      await AudioConverterFactory.create('pcm_16000' as AudioFormat, 'mp3' as AudioFormat);
      expect(mockFfmpegInstance.from).toBe('pcm_16000');
      expect(mockFfmpegInstance.to).toBe('mp3');
      expect(mockFfmpegInstance.ffmpegPath).toBe('/fake/path/to/ffmpeg');
    });

    it('dispatches to FfmpegAudioConverter for aac conversions', async () => {
      await AudioConverterFactory.create('aac' as AudioFormat, 'pcm_16000' as AudioFormat);
      expect(mockFfmpegInstance.from).toBe('aac');
      expect(mockFfmpegInstance.to).toBe('pcm_16000');
    });

    it('dispatches to FfmpegAudioConverter for flac conversions', async () => {
      await AudioConverterFactory.create('flac' as AudioFormat, 'pcm_16000' as AudioFormat);
      expect(mockFfmpegInstance.from).toBe('flac');
    });

    it('dispatches to FfmpegAudioConverter for wav conversions', async () => {
      await AudioConverterFactory.create('wav' as AudioFormat, 'pcm_16000' as AudioFormat);
      expect(mockFfmpegInstance.from).toBe('wav');
    });

    it('dispatches to FfmpegAudioConverter for opus conversions', async () => {
      await AudioConverterFactory.create('opus' as AudioFormat, 'pcm_16000' as AudioFormat);
      expect(mockFfmpegInstance.from).toBe('opus');
    });

    it('uses ffmpegPath from ffmpeg-static', async () => {
      await AudioConverterFactory.create('mp3' as AudioFormat, 'wav' as AudioFormat);
      expect(mockFfmpegInstance.ffmpegPath).toBe('/fake/path/to/ffmpeg');
    });
  });

  describe('tier selection via selectConverterTier', () => {
    it('selects passthrough for identical formats across all types', async () => {
      const formats: AudioFormat[] = ['pcm_16000', 'mulaw', 'alaw', 'mp3', 'aac', 'flac', 'wav'];
      for (const fmt of formats) {
        const converter = await AudioConverterFactory.create(fmt, fmt);
        expect(converter).toBeDefined();
        expect(mockSpeexCreate).not.toHaveBeenCalledWith(fmt, fmt);
        expect(mockG711Create).not.toHaveBeenCalledWith(fmt, fmt);
      }
    });

    it('selects speex for any PCM-to-PCM pair (different rates)', async () => {
      const pcmFormats: AudioFormat[] = ['pcm_8000', 'pcm_16000', 'pcm_22050', 'pcm_24000', 'pcm_44100', 'pcm_48000'];
      for (let i = 0; i < pcmFormats.length; i++) {
        for (let j = i + 1; j < pcmFormats.length; j++) {
          mockSpeexCreate.mockResolvedValue({ push: vi.fn(), end: vi.fn(), reset: vi.fn(), destroy: vi.fn() });
          await AudioConverterFactory.create(pcmFormats[i], pcmFormats[j]);
          expect(mockSpeexCreate).toHaveBeenCalledWith(pcmFormats[i], pcmFormats[j]);
        }
      }
    });

    it('selects g711 for mulaw-to-alaw conversion (falls to ffmpeg since not direct g711)', async () => {
      await AudioConverterFactory.create('mulaw' as AudioFormat, 'alaw' as AudioFormat);
      expect(mockG711Create).not.toHaveBeenCalled();
      expect(mockFfmpegInstance.from).toBe('mulaw');
    });

    it('selects ffmpeg for mp3-to-aac conversion', async () => {
      await AudioConverterFactory.create('mp3' as AudioFormat, 'aac' as AudioFormat);
      expect(mockSpeexCreate).not.toHaveBeenCalled();
      expect(mockG711Create).not.toHaveBeenCalled();
      expect(mockFfmpegInstance.from).toBe('mp3');
      expect(mockFfmpegInstance.to).toBe('aac');
    });
  });

  describe('error handling', () => {
    it('propagates errors from SpeexPcmResampler.create', async () => {
      mockSpeexCreate.mockRejectedValueOnce(new Error('speex init failed'));
      await expect(AudioConverterFactory.create('pcm_16000' as AudioFormat, 'pcm_48000' as AudioFormat))
        .rejects.toThrow('speex init failed');
    });

    it('propagates errors from G711Converter.create', async () => {
      mockG711Create.mockRejectedValueOnce(new Error('g711 init failed'));
      await expect(AudioConverterFactory.create('mulaw' as AudioFormat, 'pcm_16000' as AudioFormat))
        .rejects.toThrow('g711 init failed');
    });
  });

  describe('PassthroughConverter behavior', () => {
    it('emits data synchronously on push', async () => {
      const converter = await AudioConverterFactory.create('pcm_16000' as AudioFormat, 'pcm_16000' as AudioFormat);
      const chunks: Buffer[] = [];
      converter.on('data', (chunk: Buffer) => chunks.push(chunk));

      const input = Buffer.from([1, 2, 3, 4, 5]);
      converter.push(input);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual(input);
    });

    it('handles multiple pushes correctly', async () => {
      const converter = await AudioConverterFactory.create('pcm_16000' as AudioFormat, 'pcm_16000' as AudioFormat);
      const chunks: Buffer[] = [];
      converter.on('data', (chunk: Buffer) => chunks.push(chunk));

      converter.push(Buffer.from([1, 2]));
      converter.push(Buffer.from([3, 4]));
      expect(chunks).toHaveLength(2);
    });
  });
});
