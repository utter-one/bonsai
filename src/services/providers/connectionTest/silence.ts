import type { AudioFormat } from '../../../types/audio';

/** Probe duration: ~500 ms of silence (TPC-03; shared with TPC-09). */
const SILENCE_MS = 500;

/** Telephony companded rates: 8 kHz, 1 byte per sample. */
const COMPANDED_RATE_HZ = 8_000;

/**
 * Builds ~500 ms of silence for a given ASR input format (TPC-03).
 *
 * - `pcm_<rate>` — 16-bit mono PCM (every ASR provider's first declared format):
 *   `rate / 1000 * 2` bytes per ms, all zeros. 16 kHz → 16 000 bytes of 0x00.
 * - `mulaw` — 8 kHz µ-law: silence is the constant byte 0xFF (4 000 bytes).
 * - `alaw` — 8 kHz A-law: silence is the constant byte 0x7F (4 000 bytes).
 *
 * Silence is the cheapest possible probe payload: it exercises the whole
 * session lifecycle (auth, WS, audio transport, server ack) without costing
 * a single unit of transcription and without producing any transcript.
 */
export function buildAsrSilence(format: AudioFormat): Buffer {
  if (format.startsWith('pcm_')) {
    const rateHz = Number.parseInt(format.slice('pcm_'.length), 10);
    if (!Number.isFinite(rateHz) || rateHz <= 0) {
      throw new Error(`Unsupported ASR input format for silence generation: ${format}`);
    }
    // 16-bit (2 bytes) mono: samples in window × 2 bytes.
    const bytes = Math.ceil((rateHz / 1000) * SILENCE_MS) * 2;
    return Buffer.alloc(bytes, 0);
  }
  if (format === 'mulaw' || format === 'alaw') {
    const bytes = Math.ceil((COMPANDED_RATE_HZ / 1000) * SILENCE_MS);
    return Buffer.alloc(bytes, format === 'mulaw' ? 0xff : 0x7f);
  }
  throw new Error(`Unsupported ASR input format for silence generation: ${format}`);
}
