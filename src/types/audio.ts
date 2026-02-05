/**
 * Supported audio output formats for TTS providers
 */
export const audioFormatValues = [
  'pcm_16000',
  'pcm_22050',
  'pcm_44100',
] as const;

/**
 * Audio output format identifier
 */
export type AudioFormat = typeof audioFormatValues[number];
