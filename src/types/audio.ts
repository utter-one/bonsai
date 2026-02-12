/**
 * Supported audio output formats for TTS providers
 */
export const audioFormatValues = [
  'mp3',
  'opus',
  'aac',
  'flac',
  'wav',
  'pcm_16000',
  'pcm_22050',
  'pcm_24000',
  'pcm_44100',
] as const;

/**
 * Audio output format identifier
 */
export type AudioFormat = typeof audioFormatValues[number];
