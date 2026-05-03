import { describe, it, expect } from 'vitest';
import {
  isPcmFormat,
  isG711Format,
  pcmSampleRate,
  selectConverterTier,
  toFfmpegInputArgs,
  toFfmpegOutputArgs,
  buildFfmpegArgs,
} from '../../../src/services/audio/AudioFormatUtils';
import type { AudioFormat } from '../../../src/types/audio';

const PCM_FORMATS: AudioFormat[] = [
  'pcm_8000',
  'pcm_16000',
  'pcm_22050',
  'pcm_24000',
  'pcm_44100',
  'pcm_48000',
];

const G711_FORMATS: AudioFormat[] = ['mulaw', 'alaw'];

const NON_PCM_NON_G711: AudioFormat[] = ['mp3', 'opus', 'aac', 'flac', 'wav'];

const ALL_FORMATS: AudioFormat[] = [
  ...PCM_FORMATS,
  ...G711_FORMATS,
  ...NON_PCM_NON_G711,
];

describe('AudioFormatUtils', () => {
  describe('isPcmFormat', () => {
    it('returns true for all PCM formats', () => {
      for (const format of PCM_FORMATS) {
        expect(isPcmFormat(format)).toBe(true);
      }
    });

    it('returns false for non-PCM formats', () => {
      for (const format of G711_FORMATS) {
        expect(isPcmFormat(format)).toBe(false);
      }
      for (const format of NON_PCM_NON_G711) {
        expect(isPcmFormat(format)).toBe(false);
      }
    });
  });

  describe('isG711Format', () => {
    it('returns true for G.711 formats', () => {
      expect(isG711Format('mulaw')).toBe(true);
      expect(isG711Format('alaw')).toBe(true);
    });

    it('returns false for non-G.711 formats', () => {
      for (const format of PCM_FORMATS) {
        expect(isG711Format(format)).toBe(false);
      }
      for (const format of NON_PCM_NON_G711) {
        expect(isG711Format(format)).toBe(false);
      }
    });
  });

  describe('pcmSampleRate', () => {
    it('returns correct sample rate for each PCM format', () => {
      expect(pcmSampleRate('pcm_8000')).toBe(8000);
      expect(pcmSampleRate('pcm_16000')).toBe(16000);
      expect(pcmSampleRate('pcm_22050')).toBe(22050);
      expect(pcmSampleRate('pcm_24000')).toBe(24000);
      expect(pcmSampleRate('pcm_44100')).toBe(44100);
      expect(pcmSampleRate('pcm_48000')).toBe(48000);
    });

    it('throws for non-PCM formats', () => {
      for (const format of G711_FORMATS) {
        expect(() => pcmSampleRate(format)).toThrow(`Not a PCM format: ${format}`);
      }
      for (const format of NON_PCM_NON_G711) {
        expect(() => pcmSampleRate(format)).toThrow(`Not a PCM format: ${format}`);
      }
    });
  });

  describe('selectConverterTier', () => {
    it('returns passthrough when from equals to', () => {
      for (const format of ALL_FORMATS) {
        expect(selectConverterTier(format, format)).toBe('passthrough');
      }
    });

    it('returns speex for PCM-to-PCM conversion', () => {
      expect(selectConverterTier('pcm_16000', 'pcm_48000')).toBe('speex');
      expect(selectConverterTier('pcm_8000', 'pcm_24000')).toBe('speex');
    });

    it('returns opus when either format is opus', () => {
      expect(selectConverterTier('opus', 'mp3')).toBe('opus');
      expect(selectConverterTier('mp3', 'opus')).toBe('opus');
      expect(selectConverterTier('opus', 'pcm_16000')).toBe('opus');
    });

    it('returns g711 for PCM-to-G.711 conversion', () => {
      expect(selectConverterTier('mulaw', 'pcm_16000')).toBe('g711');
      expect(selectConverterTier('pcm_16000', 'alaw')).toBe('g711');
    });

    it('returns ffmpeg as fallback for other combinations', () => {
      expect(selectConverterTier('mp3', 'aac')).toBe('ffmpeg');
      expect(selectConverterTier('flac', 'wav')).toBe('ffmpeg');
      expect(selectConverterTier('aac', 'mp3')).toBe('ffmpeg');
    });

    it('prefers opus tier over g711 when opus is involved with a PCM format', () => {
      expect(selectConverterTier('opus', 'pcm_16000')).toBe('opus');
    });

    it('g711-to-g711 conversion falls back to ffmpeg', () => {
      expect(selectConverterTier('mulaw', 'alaw')).toBe('ffmpeg');
    });
  });

  describe('toFfmpegInputArgs', () => {
    it('returns s16le args for PCM formats with correct sample rate', () => {
      expect(toFfmpegInputArgs('pcm_16000')).toEqual([
        '-f',
        's16le',
        '-ar',
        '16000',
        '-ac',
        '1',
      ]);
      expect(toFfmpegInputArgs('pcm_48000')).toEqual([
        '-f',
        's16le',
        '-ar',
        '48000',
        '-ac',
        '1',
      ]);
    });

    it('returns mulaw args for mulaw format', () => {
      expect(toFfmpegInputArgs('mulaw')).toEqual([
        '-f',
        'mulaw',
        '-ar',
        '8000',
        '-ac',
        '1',
      ]);
    });

    it('returns alaw args for alaw format', () => {
      expect(toFfmpegInputArgs('alaw')).toEqual([
        '-f',
        'alaw',
        '-ar',
        '8000',
        '-ac',
        '1',
      ]);
    });

    it('returns ogg args for opus format', () => {
      expect(toFfmpegInputArgs('opus')).toEqual(['-f', 'ogg']);
    });

    it('returns empty array for self-describing container formats', () => {
      expect(toFfmpegInputArgs('mp3')).toEqual([]);
      expect(toFfmpegInputArgs('aac')).toEqual([]);
      expect(toFfmpegInputArgs('flac')).toEqual([]);
      expect(toFfmpegInputArgs('wav')).toEqual([]);
    });
  });

  describe('toFfmpegOutputArgs', () => {
    it('returns s16le args for PCM formats with correct sample rate', () => {
      expect(toFfmpegOutputArgs('pcm_16000')).toEqual([
        '-f',
        's16le',
        '-ar',
        '16000',
        '-ac',
        '1',
      ]);
    });

    it('returns mulaw args for mulaw format', () => {
      expect(toFfmpegOutputArgs('mulaw')).toEqual([
        '-f',
        'mulaw',
        '-ar',
        '8000',
        '-ac',
        '1',
      ]);
    });

    it('returns alaw args for alaw format', () => {
      expect(toFfmpegOutputArgs('alaw')).toEqual([
        '-f',
        'alaw',
        '-ar',
        '8000',
        '-ac',
        '1',
      ]);
    });

    it('returns libopus/ogg args for opus format', () => {
      expect(toFfmpegOutputArgs('opus')).toEqual([
        '-c:a',
        'libopus',
        '-f',
        'ogg',
      ]);
    });

    it('returns correct args for container formats', () => {
      expect(toFfmpegOutputArgs('mp3')).toEqual(['-f', 'mp3']);
      expect(toFfmpegOutputArgs('aac')).toEqual(['-f', 'adts']);
      expect(toFfmpegOutputArgs('flac')).toEqual(['-f', 'flac']);
      expect(toFfmpegOutputArgs('wav')).toEqual(['-f', 'wav']);
    });
  });

  describe('buildFfmpegArgs', () => {
    it('builds correct args for PCM-to-PCM conversion', () => {
      const args = buildFfmpegArgs('pcm_16000', 'pcm_48000');
      expect(args).toEqual([
        '-f',
        's16le',
        '-ar',
        '16000',
        '-ac',
        '1',
        '-i',
        'pipe:0',
        '-f',
        's16le',
        '-ar',
        '48000',
        '-ac',
        '1',
        'pipe:1',
      ]);
    });

    it('builds correct args for container-to-PCM conversion', () => {
      const args = buildFfmpegArgs('mp3', 'pcm_16000');
      expect(args).toEqual([
        '-i',
        'pipe:0',
        '-f',
        's16le',
        '-ar',
        '16000',
        '-ac',
        '1',
        'pipe:1',
      ]);
    });

    it('builds correct args for PCM-to-container conversion', () => {
      const args = buildFfmpegArgs('pcm_48000', 'mp3');
      expect(args).toEqual([
        '-f',
        's16le',
        '-ar',
        '48000',
        '-ac',
        '1',
        '-i',
        'pipe:0',
        '-f',
        'mp3',
        'pipe:1',
      ]);
    });

    it('builds correct args for mulaw-to-alaw conversion', () => {
      const args = buildFfmpegArgs('mulaw', 'alaw');
      expect(args).toEqual([
        '-f',
        'mulaw',
        '-ar',
        '8000',
        '-ac',
        '1',
        '-i',
        'pipe:0',
        '-f',
        'alaw',
        '-ar',
        '8000',
        '-ac',
        '1',
        'pipe:1',
      ]);
    });

    it('always includes pipe:0 and pipe:1 for stdin/stdout', () => {
      const args = buildFfmpegArgs('mp3', 'aac');
      expect(args).toContain('-i');
      expect(args).toContain('pipe:0');
      expect(args).toContain('pipe:1');
    });

    it('places pipe:0 immediately after -i', () => {
      const args = buildFfmpegArgs('pcm_16000', 'opus');
      const iIndex = args.indexOf('-i');
      expect(args[iIndex + 1]).toBe('pipe:0');
    });

    it('places pipe:1 as the last argument', () => {
      const args = buildFfmpegArgs('flac', 'pcm_44100');
      expect(args[args.length - 1]).toBe('pipe:1');
    });
  });
});
