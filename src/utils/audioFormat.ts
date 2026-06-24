export const AUDIO_FORMATS: Record<string, string> = {
  'audio/pcm': '.raw',
  'audio/x-pcm': '.raw',
  'audio/basic': '.au',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/opus': '.opus',
  'audio/ogg': '.ogg',
  'audio/webm': '.webm',
  'audio/flac': '.flac',
  'audio/aac': '.aac',
  'audio/x-m4a': '.m4a',
};

export function getArtifactExtension(mimeType: string): string {
  if (AUDIO_FORMATS[mimeType]) return AUDIO_FORMATS[mimeType];
  if (mimeType.startsWith('audio/')) return '.bin';
  if (mimeType === 'text/plain') return '.txt';
  if (mimeType === 'application/json') return '.json';
  if (mimeType.startsWith('text/')) return '.txt';
  if (mimeType.startsWith('image/png')) return '.png';
  if (mimeType.startsWith('image/jpeg')) return '.jpg';
  if (mimeType.startsWith('image/')) return '.png';
  return '.bin';
}

export const RECORDING_FORMAT_MIME: Record<string, string> = {
  'pcm_8000': 'audio/pcm',
  'pcm_16000': 'audio/pcm',
  'pcm_22050': 'audio/pcm',
  'pcm_24000': 'audio/pcm',
  'pcm_44100': 'audio/pcm',
  'pcm_48000': 'audio/pcm',
  'mulaw': 'audio/basic',
  'alaw': 'audio/basic',
  'wav': 'audio/wav',
  'mp3': 'audio/mpeg',
  'opus': 'audio/opus',
  'ogg': 'audio/ogg',
  'flac': 'audio/flac',
  'aac': 'audio/aac',
};

export function getMimeTypeForRecordingFormat(format: string): string {
  return RECORDING_FORMAT_MIME[format] || 'application/octet-stream';
}
