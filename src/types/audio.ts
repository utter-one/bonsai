import { z } from 'zod';

/**
 * Supported audio output formats for TTS providers
 */
export const audioFormatValues = [
  'mp3',
  'opus',
  'aac',
  'flac',
  'wav',
  'pcm_8000',
  'pcm_16000',
  'pcm_22050',
  'pcm_24000',
  'pcm_44100',
  'pcm_48000',
  'mulaw',
  'alaw',
  'linear16',
] as const;

/**
 * Zod schema for audio output format identifiers.
 */
export const audioFormatSchema = z.enum(audioFormatValues);

/**
 * Audio output format identifier
 */
export type AudioFormat = z.infer<typeof audioFormatSchema>;
