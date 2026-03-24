import type { AudioFormat } from '../../types/audio';
import type { ConverterTier } from './IAudioConverter';

const PCM_FORMATS = new Set<AudioFormat>(['pcm_8000', 'pcm_16000', 'pcm_22050', 'pcm_24000', 'pcm_44100', 'pcm_48000']);
const G711_FORMATS = new Set<AudioFormat>(['mulaw', 'alaw']);

/**
 * Returns true if the given format is a raw 16-bit signed LE PCM format.
 * All pcm_* variants qualify.
 */
export function isPcmFormat(format: AudioFormat): boolean {
  return PCM_FORMATS.has(format);
}

/**
 * Returns true if the given format is a G.711 compressed format (μ-law or A-law).
 */
export function isG711Format(format: AudioFormat): boolean {
  return G711_FORMATS.has(format);
}

/**
 * Returns the sample rate in Hz for a PCM format.
 * Throws if the format is not a PCM format.
 */
export function pcmSampleRate(format: AudioFormat): number {
  switch (format) {
    case 'pcm_8000': return 8000;
    case 'pcm_16000': return 16000;
    case 'pcm_22050': return 22050;
    case 'pcm_24000': return 24000;
    case 'pcm_44100': return 44100;
    case 'pcm_48000': return 48000;
    default: throw new Error(`Not a PCM format: ${format}`);
  }
}

/**
 * Selects the optimal conversion tier for the given format pair.
 * Tiers are ordered fastest-to-slowest: passthrough → speex → opus → g711 → ffmpeg.
 */
export function selectConverterTier(from: AudioFormat, to: AudioFormat): ConverterTier {
  if (from === to) return 'passthrough';
  if (isPcmFormat(from) && isPcmFormat(to)) return 'speex';
  if (from === 'opus' || to === 'opus') return 'opus';
  if ((isG711Format(from) && isPcmFormat(to)) || (isPcmFormat(from) && isG711Format(to))) return 'g711';
  return 'ffmpeg';
}

/**
 * Returns ffmpeg input format arguments for the given audio format.
 * Raw formats require explicit format, rate, and channel declarations.
 */
export function toFfmpegInputArgs(format: AudioFormat): string[] {
  if (isPcmFormat(format)) return ['-f', 's16le', '-ar', String(pcmSampleRate(format)), '-ac', '1'];
  if (format === 'mulaw') return ['-f', 'mulaw', '-ar', '8000', '-ac', '1'];
  if (format === 'alaw') return ['-f', 'alaw', '-ar', '8000', '-ac', '1'];
  if (format === 'opus') return ['-f', 'ogg'];
  // mp3, aac, flac, wav: self-describing containers — no input args needed
  return [];
}

/**
 * Returns ffmpeg output format arguments for the given audio format.
 */
export function toFfmpegOutputArgs(format: AudioFormat): string[] {
  if (isPcmFormat(format)) return ['-f', 's16le', '-ar', String(pcmSampleRate(format)), '-ac', '1'];
  if (format === 'mulaw') return ['-f', 'mulaw', '-ar', '8000', '-ac', '1'];
  if (format === 'alaw') return ['-f', 'alaw', '-ar', '8000', '-ac', '1'];
  if (format === 'opus') return ['-c:a', 'libopus', '-f', 'ogg'];
  if (format === 'mp3') return ['-f', 'mp3'];
  if (format === 'aac') return ['-f', 'adts'];
  if (format === 'flac') return ['-f', 'flac'];
  if (format === 'wav') return ['-f', 'wav'];
  return [];
}

/**
 * Builds the full ffmpeg argument list for piped stdin→stdout conversion.
 */
export function buildFfmpegArgs(from: AudioFormat, to: AudioFormat): string[] {
  return [...toFfmpegInputArgs(from), '-i', 'pipe:0', ...toFfmpegOutputArgs(to), 'pipe:1'];
}
