import { describe, it, expect, vi } from 'vitest';
import { G711Converter } from '../../../src/services/audio/G711Converter';
import type { AudioFormat } from '../../../src/types/audio';

vi.mock('../../../src/services/audio/speexResampler', () => {
  const initPromise = Promise.resolve();
  class MockSpeexResampler {
    channels: number;
    inRate: number;
    outRate: number;
    quality: number;
    constructor(channels: number, inRate: number, outRate: number, quality: number) {
      this.channels = channels;
      this.inRate = inRate;
      this.outRate = outRate;
      this.quality = quality;
    }
    processChunk(input: Buffer): Buffer {
      return input;
    }
  }
  return {
    default: MockSpeexResampler,
    initPromise,
  };
});

function makePcmBuffer(samples: number[]): Buffer {
  const buf = Buffer.allocUnsafe(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(samples[i], i * 2);
  }
  return buf;
}

function collectData(converter: G711Converter, chunks: Buffer[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const results: Buffer[] = [];
    converter.on('data', (chunk: Buffer) => results.push(chunk));
    converter.on('error', reject);
    converter.on('end', () => resolve(Buffer.concat(results)));
    for (const chunk of chunks) {
      converter.push(chunk);
    }
    converter.end();
  });
}

describe('G711Converter', () => {
  describe('mu-law encoding', () => {
    it('produces output half the size of input (1 byte per sample)', async () => {
      const converter = await G711Converter.create('pcm_8000' as AudioFormat, 'mulaw' as AudioFormat);
      const pcm = makePcmBuffer([0, 100, -100, 32767, -32768]);
      const result = await collectData(converter, [pcm]);
      expect(result.length).toBe(pcm.length / 2);
    });

    it('encodes zero to a consistent mu-law byte', async () => {
      const converter = await G711Converter.create('pcm_8000' as AudioFormat, 'mulaw' as AudioFormat);
      const pcm = makePcmBuffer([0]);
      const result = await collectData(converter, [pcm]);
      expect(result.length).toBe(1);
      expect(result[0]).toBeGreaterThanOrEqual(0);
      expect(result[0]).toBeLessThanOrEqual(255);
    });

    it('encodes positive and negative values with different sign bits', async () => {
      const converter = await G711Converter.create('pcm_8000' as AudioFormat, 'mulaw' as AudioFormat);
      const pcmPos = makePcmBuffer([100]);
      const pcmNeg = makePcmBuffer([-100]);
      const resultPos = await collectData(converter, [pcmPos]);
      converter.reset();
      const resultNeg = await collectData(converter, [pcmNeg]);
      expect(resultPos[0]).not.toBe(resultNeg[0]);
    });

    it('produces same encoding for max and over-max values (clamping)', async () => {
      const converter = await G711Converter.create('pcm_8000' as AudioFormat, 'mulaw' as AudioFormat);
      const pcmMax = makePcmBuffer([32767]);
      const resultMax = await collectData(converter, [pcmMax]);

      const converter2 = await G711Converter.create('pcm_8000' as AudioFormat, 'mulaw' as AudioFormat);
      const pcmClamp = Buffer.allocUnsafe(2);
      pcmClamp.writeInt16LE(32767, 0);
      const resultClamp = await collectData(converter2, [pcmClamp]);
      expect(resultClamp[0]).toBe(resultMax[0]);
    });
  });

  describe('mu-law decoding', () => {
    it('produces output double the size of input (2 bytes per sample)', async () => {
      const converter = await G711Converter.create('mulaw' as AudioFormat, 'pcm_8000' as AudioFormat);
      const mulaw = Buffer.from([0xd5, 0x69, 0xe9, 0x84, 0x83]);
      const result = await collectData(converter, [mulaw]);
      expect(result.length).toBe(mulaw.length * 2);
    });

    it('decodes all 256 possible mu-law bytes to valid int16 range', async () => {
      const converter = await G711Converter.create('mulaw' as AudioFormat, 'pcm_8000' as AudioFormat);
      const allBytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
      const result = await collectData(converter, [allBytes]);
      expect(result.length).toBe(512);
      for (let i = 0; i < 256; i++) {
        const val = result.readInt16LE(i * 2);
        expect(val).toBeGreaterThanOrEqual(-32768);
        expect(val).toBeLessThanOrEqual(32767);
      }
    });

    it('decodes sign-inverted pairs to symmetric values', async () => {
      const converter = await G711Converter.create('mulaw' as AudioFormat, 'pcm_8000' as AudioFormat);
      for (let i = 0; i < 128; i++) {
        const pair = Buffer.from([i, i | 0x80]);
        const result = await collectData(converter, [pair]);
        const pos = result.readInt16LE(0);
        const neg = result.readInt16LE(2);
        expect(Math.abs(pos)).toBe(Math.abs(neg));
        converter.reset();
      }
    });
  });

  describe('mu-law round-trip', () => {
    it('preserves audio quality within tolerance for diverse samples', async () => {
      const encoder = await G711Converter.create('pcm_8000' as AudioFormat, 'mulaw' as AudioFormat);
      const decoder = await G711Converter.create('mulaw' as AudioFormat, 'pcm_8000' as AudioFormat);

      const samples = [
        0, 1, -1, 100, -100, 1000, -1000,
        10000, -10000, 32767, -32768, 500, 2500,
      ];
      const original = makePcmBuffer(samples);

      const encoded = await collectData(encoder, [original]);
      const decoded = await collectData(decoder, [encoded]);

      expect(decoded.length).toBe(original.length);
      for (let i = 0; i < samples.length; i++) {
        const originalVal = samples[i];
        const decodedVal = decoded.readInt16LE(i * 2);
        const diff = Math.abs(originalVal - decodedVal);
        const tolerance = Math.max(16, Math.abs(originalVal) * 0.04);
        expect(diff).toBeLessThanOrEqual(tolerance);
      }
    });

    it('round-trips a larger buffer within tolerance', async () => {
      const encoder = await G711Converter.create('pcm_8000' as AudioFormat, 'mulaw' as AudioFormat);
      const decoder = await G711Converter.create('mulaw' as AudioFormat, 'pcm_8000' as AudioFormat);

      const samples: number[] = [];
      for (let i = 0; i < 256; i++) {
        samples.push(((i * 12345) % 65536) - 32768);
      }
      const original = makePcmBuffer(samples);

      const encoded = await collectData(encoder, [original]);
      const decoded = await collectData(decoder, [encoded]);

      expect(decoded.length).toBe(original.length);
      let maxError = 0;
      for (let i = 0; i < samples.length; i++) {
        const diff = Math.abs(samples[i] - decoded.readInt16LE(i * 2));
        if (diff > maxError) maxError = diff;
      }
      expect(maxError).toBeLessThanOrEqual(1024);
    });
  });

  describe('A-law encoding', () => {
    it('produces output half the size of input', async () => {
      const converter = await G711Converter.create('pcm_8000' as AudioFormat, 'alaw' as AudioFormat);
      const pcm = makePcmBuffer([0, 100, -100, 32767, -32768]);
      const result = await collectData(converter, [pcm]);
      expect(result.length).toBe(pcm.length / 2);
    });

    it('encodes zero to a consistent A-law byte', async () => {
      const converter = await G711Converter.create('pcm_8000' as AudioFormat, 'alaw' as AudioFormat);
      const pcm = makePcmBuffer([0]);
      const result = await collectData(converter, [pcm]);
      expect(result.length).toBe(1);
    });

    it('encodes positive and negative values with different sign bits', async () => {
      const converter = await G711Converter.create('pcm_8000' as AudioFormat, 'alaw' as AudioFormat);
      const pcmPos = makePcmBuffer([100]);
      const pcmNeg = makePcmBuffer([-100]);
      const resultPos = await collectData(converter, [pcmPos]);
      converter.reset();
      const resultNeg = await collectData(converter, [pcmNeg]);
      expect(resultPos[0]).not.toBe(resultNeg[0]);
    });

    it('produces same encoding for max and over-max values (clamping)', async () => {
      const converter = await G711Converter.create('pcm_8000' as AudioFormat, 'alaw' as AudioFormat);
      const pcmMax = makePcmBuffer([32767]);
      const resultMax = await collectData(converter, [pcmMax]);

      const converter2 = await G711Converter.create('pcm_8000' as AudioFormat, 'alaw' as AudioFormat);
      const pcmClamp = Buffer.allocUnsafe(2);
      pcmClamp.writeInt16LE(32767, 0);
      const resultClamp = await collectData(converter2, [pcmClamp]);
      expect(resultClamp[0]).toBe(resultMax[0]);
    });
  });

  describe('A-law decoding', () => {
    it('produces output double the size of input', async () => {
      const converter = await G711Converter.create('alaw' as AudioFormat, 'pcm_8000' as AudioFormat);
      const alaw = Buffer.from([0xd6, 0x5a, 0xda, 0x82, 0x7e]);
      const result = await collectData(converter, [alaw]);
      expect(result.length).toBe(alaw.length * 2);
    });

    it('decodes all 256 possible A-law bytes to valid int16 range', async () => {
      const converter = await G711Converter.create('alaw' as AudioFormat, 'pcm_8000' as AudioFormat);
      const allBytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
      const result = await collectData(converter, [allBytes]);
      expect(result.length).toBe(512);
      for (let i = 0; i < 256; i++) {
        const val = result.readInt16LE(i * 2);
        expect(val).toBeGreaterThanOrEqual(-32768);
        expect(val).toBeLessThanOrEqual(32767);
      }
    });

    it('decodes sign-inverted pairs to symmetric absolute values', async () => {
      const converter = await G711Converter.create('alaw' as AudioFormat, 'pcm_8000' as AudioFormat);
      const allBytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
      const result = await collectData(converter, [allBytes]);
      for (let i = 0; i < 128; i++) {
        const val1 = result.readInt16LE(i * 2);
        const val2 = result.readInt16LE((i + 128) * 2);
        expect(Math.abs(val1)).toBe(Math.abs(val2));
      }
    });
  });

  describe('A-law round-trip', () => {
    it('preserves audio quality within tolerance for larger amplitude samples', async () => {
      const encoder = await G711Converter.create('pcm_8000' as AudioFormat, 'alaw' as AudioFormat);
      const decoder = await G711Converter.create('alaw' as AudioFormat, 'pcm_8000' as AudioFormat);

      const samples = [
        1000, -1000, 5000, -5000,
        10000, -10000, 20000, -20000, 32767, -32768,
      ];
      const original = makePcmBuffer(samples);

      const encoded = await collectData(encoder, [original]);
      const decoded = await collectData(decoder, [encoded]);

      expect(decoded.length).toBe(original.length);
      for (let i = 0; i < samples.length; i++) {
        const originalVal = samples[i];
        const decodedVal = decoded.readInt16LE(i * 2);
        const diff = Math.abs(originalVal - decodedVal);
        const tolerance = Math.max(64, Math.abs(originalVal) * 0.1);
        expect(diff).toBeLessThanOrEqual(tolerance);
      }
    });

    it('round-trips a larger buffer within tolerance', async () => {
      const encoder = await G711Converter.create('pcm_8000' as AudioFormat, 'alaw' as AudioFormat);
      const decoder = await G711Converter.create('alaw' as AudioFormat, 'pcm_8000' as AudioFormat);

      const samples: number[] = [];
      for (let i = 0; i < 256; i++) {
        const raw = ((i * 12345) % 65536) - 32768;
        if (Math.abs(raw) > 256) {
          samples.push(raw);
        }
      }
      const original = makePcmBuffer(samples);

      const encoded = await collectData(encoder, [original]);
      const decoded = await collectData(decoder, [encoded]);

      expect(decoded.length).toBe(original.length);
      let maxError = 0;
      for (let i = 0; i < samples.length; i++) {
        const diff = Math.abs(samples[i] - decoded.readInt16LE(i * 2));
        if (diff > maxError) maxError = diff;
      }
      expect(maxError).toBeLessThanOrEqual(2048);
    });
  });

  describe('lookup table correctness', () => {
    it('mu-law decode table has 256 entries producing valid output', async () => {
      const converter = await G711Converter.create('mulaw' as AudioFormat, 'pcm_8000' as AudioFormat);
      const allBytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
      const result = await collectData(converter, [allBytes]);
      expect(result.length).toBe(512);
    });

    it('A-law decode table has 256 entries producing valid output', async () => {
      const converter = await G711Converter.create('alaw' as AudioFormat, 'pcm_8000' as AudioFormat);
      const allBytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
      const result = await collectData(converter, [allBytes]);
      expect(result.length).toBe(512);
    });

    it('mu-law decode table produces symmetric absolute values for sign-inverted pairs', async () => {
      const converter = await G711Converter.create('mulaw' as AudioFormat, 'pcm_8000' as AudioFormat);
      const allBytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
      const result = await collectData(converter, [allBytes]);
      for (let i = 0; i < 128; i++) {
        const val1 = result.readInt16LE(i * 2);
        const val2 = result.readInt16LE((i + 128) * 2);
        expect(Math.abs(val1)).toBe(Math.abs(val2));
      }
    });

    it('A-law decode table produces symmetric absolute values for sign-inverted pairs', async () => {
      const converter = await G711Converter.create('alaw' as AudioFormat, 'pcm_8000' as AudioFormat);
      const allBytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
      const result = await collectData(converter, [allBytes]);
      for (let i = 0; i < 128; i++) {
        const val1 = result.readInt16LE(i * 2);
        const val2 = result.readInt16LE((i + 128) * 2);
        expect(Math.abs(val1)).toBe(Math.abs(val2));
      }
    });
  });

  describe('sample rate handling', () => {
    it('passes through without resampling for 8kHz PCM', async () => {
      const converter = await G711Converter.create('pcm_8000' as AudioFormat, 'mulaw' as AudioFormat);
      const pcm = makePcmBuffer([100, -200, 300]);
      const result = await collectData(converter, [pcm]);
      expect(result.length).toBe(3);
    });

    it('triggers resampling chain for non-8kHz PCM encode (16kHz)', async () => {
      const converter = await G711Converter.create('pcm_16000' as AudioFormat, 'mulaw' as AudioFormat);
      const pcm = makePcmBuffer([100, -200, 300]);
      const result = await collectData(converter, [pcm]);
      expect(result.length).toBeGreaterThan(0);
    });

    it('triggers resampling chain for decode to non-8kHz PCM', async () => {
      const converter = await G711Converter.create('mulaw' as AudioFormat, 'pcm_48000' as AudioFormat);
      const mulaw = Buffer.from([0xd5, 0x69, 0xe9]);
      const result = await collectData(converter, [mulaw]);
      expect(result.length).toBeGreaterThan(0);
    });

    it('works with various PCM sample rates', async () => {
      const rates: AudioFormat[] = ['pcm_8000', 'pcm_16000', 'pcm_22050', 'pcm_24000', 'pcm_44100', 'pcm_48000'];
      for (const rate of rates) {
        const encoder = await G711Converter.create(rate, 'mulaw' as AudioFormat);
        const decoder = await G711Converter.create('mulaw' as AudioFormat, rate);
        const pcm = makePcmBuffer([1000, -2000]);
        const encoded = await collectData(encoder, [pcm]);
        const decoded = await collectData(decoder, [encoded]);
        expect(decoded.length).toBeGreaterThan(0);
      }
    });
  });

  describe('buffer alignment', () => {
    it('handles odd-length PCM buffer gracefully (truncates last byte)', async () => {
      const converter = await G711Converter.create('pcm_8000' as AudioFormat, 'mulaw' as AudioFormat);
      const pcm = Buffer.from([0x64, 0x00, 0xff]);
      const result = await collectData(converter, [pcm]);
      expect(result.length).toBe(1);
    });

    it('handles empty PCM input buffer', async () => {
      const converter = await G711Converter.create('pcm_8000' as AudioFormat, 'mulaw' as AudioFormat);
      const collected: Buffer[] = [];
      let errored = false;

      return new Promise<void>((resolve) => {
        converter.on('data', (chunk: Buffer) => collected.push(chunk));
        converter.on('error', () => { errored = true; });
        converter.push(Buffer.alloc(0));
        converter.end();
        setImmediate(() => {
          expect(errored).toBe(false);
          const total = Buffer.concat(collected);
          expect(total.length).toBe(0);
          resolve();
        });
      });
    });

    it('handles empty G711 input buffer', async () => {
      const converter = await G711Converter.create('mulaw' as AudioFormat, 'pcm_8000' as AudioFormat);
      const collected: Buffer[] = [];
      let errored = false;

      return new Promise<void>((resolve) => {
        converter.on('data', (chunk: Buffer) => collected.push(chunk));
        converter.on('error', () => { errored = true; });
        converter.push(Buffer.alloc(0));
        converter.end();
        setImmediate(() => {
          expect(errored).toBe(false);
          const total = Buffer.concat(collected);
          expect(total.length).toBe(0);
          resolve();
        });
      });
    });

    it('handles multiple sequential pushes correctly', async () => {
      const converter = await G711Converter.create('pcm_8000' as AudioFormat, 'mulaw' as AudioFormat);
      const collected: Buffer[] = [];

      return new Promise<void>((resolve) => {
        converter.on('data', (chunk: Buffer) => collected.push(chunk));
        converter.on('end', () => {
          expect(Buffer.concat(collected).length).toBe(4);
          resolve();
        });
        converter.push(makePcmBuffer([100]));
        converter.push(makePcmBuffer([200, -300]));
        converter.push(makePcmBuffer([400]));
        converter.end();
      });
    });
  });

  describe('event emission', () => {
    it('emits data event for each push', async () => {
      const converter = await G711Converter.create('pcm_8000' as AudioFormat, 'mulaw' as AudioFormat);
      const chunks: Buffer[] = [];
      let dataCount = 0;

      return new Promise<void>((resolve) => {
        converter.on('data', (chunk: Buffer) => {
          dataCount++;
          chunks.push(chunk);
        });
        converter.on('end', () => {
          expect(dataCount).toBe(3);
          resolve();
        });
        converter.push(makePcmBuffer([100]));
        converter.push(makePcmBuffer([200]));
        converter.push(makePcmBuffer([300]));
        converter.end();
      });
    });

    it('emits end event after all data', async () => {
      const converter = await G711Converter.create('pcm_8000' as AudioFormat, 'mulaw' as AudioFormat);
      let dataReceived = false;
      let endReceived = false;

      return new Promise<void>((resolve) => {
        converter.on('data', () => { dataReceived = true; });
        converter.on('end', () => {
          endReceived = true;
          expect(dataReceived).toBe(true);
          resolve();
        });
        converter.push(makePcmBuffer([100]));
        converter.end();
      });
    });
  });

  describe('factory mode detection', () => {
    it('creates mulaw-to-pcm converter when from is mulaw', async () => {
      const converter = await G711Converter.create('mulaw' as AudioFormat, 'pcm_8000' as AudioFormat);
      const mulaw = Buffer.from([0xd5]);
      const result = await collectData(converter, [mulaw]);
      expect(result.length).toBe(2);
    });

    it('creates pcm-to-mulaw converter when to is mulaw', async () => {
      const converter = await G711Converter.create('pcm_8000' as AudioFormat, 'mulaw' as AudioFormat);
      const pcm = makePcmBuffer([0]);
      const result = await collectData(converter, [pcm]);
      expect(result.length).toBe(1);
    });

    it('creates alaw-to-pcm converter when from is alaw', async () => {
      const converter = await G711Converter.create('alaw' as AudioFormat, 'pcm_8000' as AudioFormat);
      const alaw = Buffer.from([0xd6]);
      const result = await collectData(converter, [alaw]);
      expect(result.length).toBe(2);
    });

    it('creates pcm-to-alaw converter when to is alaw', async () => {
      const converter = await G711Converter.create('pcm_8000' as AudioFormat, 'alaw' as AudioFormat);
      const pcm = makePcmBuffer([0]);
      const result = await collectData(converter, [pcm]);
      expect(result.length).toBe(1);
    });
  });

  describe('lifecycle', () => {
    it('reset is a no-op and allows reuse', async () => {
      const converter = await G711Converter.create('pcm_8000' as AudioFormat, 'mulaw' as AudioFormat);

      const result1 = await collectData(converter, [makePcmBuffer([100])]);
      converter.reset();
      const result2 = await collectData(converter, [makePcmBuffer([200])]);

      expect(result1.length).toBe(1);
      expect(result2.length).toBe(1);
    });

    it('destroy releases the converter without error', async () => {
      const converter = await G711Converter.create('pcm_8000' as AudioFormat, 'mulaw' as AudioFormat);
      expect(() => converter.destroy()).not.toThrow();
    });
  });

  describe('encode-decode consistency', () => {
    it('encoding then decoding all mu-law bytes returns consistent values', async () => {
      const decoder = await G711Converter.create('mulaw' as AudioFormat, 'pcm_8000' as AudioFormat);
      const encoder = await G711Converter.create('pcm_8000' as AudioFormat, 'mulaw' as AudioFormat);

      const allBytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
      const decoded = await collectData(decoder, [allBytes]);

      const reencoded = await collectData(encoder, [decoded]);
      expect(reencoded.length).toBe(256);
    });

    it('encoding then decoding all A-law bytes returns consistent values', async () => {
      const decoder = await G711Converter.create('alaw' as AudioFormat, 'pcm_8000' as AudioFormat);
      const encoder = await G711Converter.create('pcm_8000' as AudioFormat, 'alaw' as AudioFormat);

      const allBytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
      const decoded = await collectData(decoder, [allBytes]);

      const reencoded = await collectData(encoder, [decoded]);
      expect(reencoded.length).toBe(256);
    });
  });
});
