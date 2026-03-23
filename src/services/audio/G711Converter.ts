import { EventEmitter } from 'events';
import SpeexResamplerClass from './speexResampler';
import type { IAudioConverter } from './IAudioConverter';
import type { AudioFormat } from '../../types/audio';
import { isG711Format, pcmSampleRate } from './AudioFormatUtils';

// ---------------------------------------------------------------------------
// ITU-T G.711 μ-law decode table (256 entries: byte → int16)
// Reference: ITU-T G.711 (11/1988), Sun Microsystems g711.c
// After inverting all bits: bit7=sign, bits6-4=exponent, bits3-0=mantissa
// ---------------------------------------------------------------------------
const MULAW_BIAS = 0x84;
const MULAW_DEC = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  const u = ~i & 0xff;
  const sign = u >> 7;
  const exp = (u >> 4) & 0x07;
  const mant = u & 0x0f;
  let val = ((mant << 3) + MULAW_BIAS) << exp;
  val -= MULAW_BIAS;
  MULAW_DEC[i] = sign ? -val : val;
}

// ---------------------------------------------------------------------------
// ITU-T G.711 A-law decode table (256 entries: byte → int16)
// XOR 0x55 restores the raw A-law code; bit7=sign, bits6-4=exp, bits3-0=mant
// ---------------------------------------------------------------------------
const ALAW_DEC = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  const a = (i ^ 0x55) & 0xff;
  const sign = a >> 7;
  const exp = (a >> 4) & 0x07;
  const mant = a & 0x0f;
  let val: number;
  if (exp === 0) {
    val = (mant << 1) | 1;
  } else {
    val = (mant | 0x10) << exp;
  }
  val <<= 3; // scale to 16-bit range (×8)
  ALAW_DEC[i] = sign ? val : -val;
}

type G711Mode = 'mulaw-to-pcm' | 'pcm-to-mulaw' | 'alaw-to-pcm' | 'pcm-to-alaw';

/**
 * G.711 μ-law/A-law ↔ 16-bit PCM converter with optional internal Speex resampling.
 * Fully synchronous: push() emits 'data' before returning.
 * Use the static create() factory instead of constructing directly.
 */
export class G711Converter extends EventEmitter implements IAudioConverter {
  private constructor(
    private readonly mode: G711Mode,
    private readonly resampler: any,
    private readonly resampleBeforeG711: boolean,
  ) {
    super();
  }

  /**
   * Creates a G711Converter for the given format pair.
   * Automatically adds an internal Speex resampler when the PCM side is not 8 kHz
   * (G.711 natively operates at 8000 Hz).
   */
  static async create(from: AudioFormat, to: AudioFormat): Promise<G711Converter> {
    const fromIsG711 = isG711Format(from);
    const g711Format = fromIsG711 ? from : to;
    const pcmFormat = fromIsG711 ? to : from;
    const pcmRate = pcmSampleRate(pcmFormat);
    const needsResample = pcmRate !== 8000;
    let resampler: any = null;

    if (needsResample) {
      await SpeexResamplerClass.initPromise;
      if (fromIsG711) {
        // decode: G711 → pcm_8000 → target PCM rate
        resampler = new SpeexResamplerClass(1, 8000, pcmRate, 3);
      } else {
        // encode: source PCM rate → pcm_8000 → G711
        resampler = new SpeexResamplerClass(1, pcmRate, 8000, 3);
      }
    }

    let mode: G711Mode;
    if (g711Format === 'mulaw') {
      mode = fromIsG711 ? 'mulaw-to-pcm' : 'pcm-to-mulaw';
    } else {
      mode = fromIsG711 ? 'alaw-to-pcm' : 'pcm-to-alaw';
    }

    // resampleBeforeG711 = true when encoding (PCM → resample → G711)
    return new G711Converter(mode, resampler, !fromIsG711);
  }

  /** Converts a chunk synchronously and emits 'data'. */
  push(chunk: Buffer): void {
    try {
      let output: Buffer;
      if (this.mode === 'mulaw-to-pcm' || this.mode === 'alaw-to-pcm') {
        // Decode: G711 → pcm_8000 → (optionally resample)
        const decoded = this.mode === 'mulaw-to-pcm' ? mulawToPcm(chunk) : alawToPcm(chunk);
        output = this.resampler ? this.resampler.processChunk(decoded) : decoded;
      } else {
        // Encode: (optionally resample) → pcm_8000 → G711
        const pcm8k = this.resampler ? this.resampler.processChunk(chunk) : chunk;
        output = this.mode === 'pcm-to-mulaw' ? pcmToMulaw(pcm8k) : pcmToAlaw(pcm8k);
      }
      this.emit('data', output);
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  /** Emits 'end' immediately — no buffering. */
  end(): void {
    this.emit('end');
  }

  /** No-op: Speex resampler and G.711 tables are stateless across calls. */
  reset(): void {}

  destroy(): void {}
}

// ---------------------------------------------------------------------------
// Pure-TS G.711 conversion helpers
// ---------------------------------------------------------------------------

function mulawToPcm(input: Buffer): Buffer {
  const output = Buffer.allocUnsafe(input.length * 2);
  for (let i = 0; i < input.length; i++) {
    output.writeInt16LE(MULAW_DEC[input[i]], i * 2);
  }
  return output;
}

function alawToPcm(input: Buffer): Buffer {
  const output = Buffer.allocUnsafe(input.length * 2);
  for (let i = 0; i < input.length; i++) {
    output.writeInt16LE(ALAW_DEC[input[i]], i * 2);
  }
  return output;
}

function pcmToMulaw(input: Buffer): Buffer {
  const output = Buffer.allocUnsafe(input.length >> 1);
  for (let i = 0; i < output.length; i++) {
    output[i] = encodeMulaw(input.readInt16LE(i * 2));
  }
  return output;
}

function pcmToAlaw(input: Buffer): Buffer {
  const output = Buffer.allocUnsafe(input.length >> 1);
  for (let i = 0; i < output.length; i++) {
    output[i] = encodeAlaw(input.readInt16LE(i * 2));
  }
  return output;
}

function encodeMulaw(pcm: number): number {
  let sign = 0;
  if (pcm < 0) { sign = 0x80; pcm = -pcm; }
  pcm += MULAW_BIAS;
  if (pcm > 32767) pcm = 32767;
  let exp = 7;
  for (let mask = 0x4000; (pcm & mask) === 0 && exp > 0; exp--, mask >>= 1) {}
  const mant = (pcm >> (exp + 3)) & 0x0f;
  return (~(sign | (exp << 4) | mant)) & 0xff;
}

function encodeAlaw(pcm: number): number {
  let sign = 0x80;
  if (pcm < 0) { sign = 0; pcm = -pcm - 1; }
  if (pcm > 32767) pcm = 32767;
  let exp: number;
  let mant: number;
  if (pcm < 256) {
    exp = 0;
    mant = pcm >> 3;
  } else {
    exp = 7;
    let mask = 0x4000;
    for (; (pcm & mask) === 0 && exp > 1; exp--, mask >>= 1) {}
    mant = (pcm >> (exp + 3)) & 0x0f;
  }
  return ((sign | (exp << 4) | mant) ^ 0x55) & 0xff;
}
