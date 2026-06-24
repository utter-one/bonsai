import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFile } from 'fs/promises';
import * as ort from 'onnxruntime-node';
import SpeexResamplerClass from './speexResampler';
import logger from '../../utils/logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MODEL_DIR = join(__dirname, '../../../models/firered-vad');

const FIRERED_SAMPLE_RATE = 16000;
const FIRERED_FRAME_SAMPLES = 160;
const FIRERED_FBank_DIM = 80;
const FIRERED_CACHE_LAYERS = 8;
const FIRERED_CACHE_HIDDEN = 128;
const FIRERED_CACHE_LEN = 19;

// Fbank parameters matching Kaldi/kaldi_native_fbank
const FBANK_FRAME_LENGTH_MS = 25;
const FBANK_FRAME_SHIFT_MS = 10;
const FBANK_NUM_MEL_BINS = 80;
const FBANK_SAMPLE_RATE = 16000;
const FBANK_FRAME_LENGTH = Math.round(FBANK_FRAME_LENGTH_MS / 1000 * FBANK_SAMPLE_RATE); // 400
const FBANK_FRAME_SHIFT = Math.round(FBANK_FRAME_SHIFT_MS / 1000 * FBANK_SAMPLE_RATE); // 160

type FireRedVadCallbacks = {
  onSpeechStart: () => void;
  onSpeechEnd: (audio: Float32Array) => void;
};

type FireRedVadInitConfig = {
  speechThreshold: number;
  smoothWindowSize: number;
  minSpeechFrame: number;
  maxSpeechFrame: number;
  minSilenceFrame: number;
  padStartFrame: number;
  gracePeriodMs: number;
};

enum VadState {
  SILENCE = 0,
  POSSIBLE_SPEECH = 1,
  SPEECH = 2,
  POSSIBLE_SILENCE = 3,
}

class StreamVadStateMachine {
  private smoothWindow: number[] = [];
  private smoothWindowSum = 0;
  private readonly smoothWindowSize: number;
  private readonly speechThreshold: number;
  private readonly padStartFrame: number;
  private readonly minSpeechFrame: number;
  private readonly maxSpeechFrame: number;
  private readonly minSilenceFrame: number;

  private state = VadState.SILENCE;
  private frameCnt = 0;
  private speechCnt = 0;
  private silenceCnt = 0;
  private hitMaxSpeech = false;
  private lastSpeechStartFrame = -1;
  private lastSpeechEndFrame = -1;

  get currentFrameCnt(): number {
    return this.frameCnt;
  }

  get currentState(): VadState {
    return this.state;
  }

  constructor(config: FireRedVadInitConfig) {
    this.smoothWindowSize = Math.max(1, config.smoothWindowSize);
    this.speechThreshold = config.speechThreshold;
    this.padStartFrame = Math.max(this.smoothWindowSize, config.padStartFrame);
    this.minSpeechFrame = config.minSpeechFrame;
    this.maxSpeechFrame = config.maxSpeechFrame;
    this.minSilenceFrame = config.minSilenceFrame;
  }

  reset(): void {
    this.smoothWindow = [];
    this.smoothWindowSum = 0;
    this.state = VadState.SILENCE;
    this.frameCnt = 0;
    this.speechCnt = 0;
    this.silenceCnt = 0;
    this.hitMaxSpeech = false;
    this.lastSpeechStartFrame = -1;
    this.lastSpeechEndFrame = -1;
  }

  processOneFrame(rawProb: number): {
    isSpeechStart: boolean;
    isSpeechEnd: boolean;
    speechStartFrame: number;
    speechEndFrame: number;
    smoothedProb: number;
    isSpeech: boolean;
  } {
    this.frameCnt++;
    const smoothedProb = this.smoothProb(rawProb);
    const isSpeech = smoothedProb >= this.speechThreshold ? 1 : 0;

    let isSpeechStart = false;
    let isSpeechEnd = false;
    let speechStartFrame = -1;
    let speechEndFrame = -1;

    if (this.hitMaxSpeech) {
      isSpeechStart = true;
      speechStartFrame = this.frameCnt;
      this.lastSpeechStartFrame = speechStartFrame;
      this.hitMaxSpeech = false;
    }

    if (this.state === VadState.SILENCE) {
      if (isSpeech) {
        this.state = VadState.POSSIBLE_SPEECH;
        this.speechCnt += 1;
      } else {
        this.silenceCnt += 1;
        this.speechCnt = 0;
      }
    } else if (this.state === VadState.POSSIBLE_SPEECH) {
      if (isSpeech) {
        this.speechCnt += 1;
        if (this.speechCnt >= this.minSpeechFrame) {
          this.state = VadState.SPEECH;
          isSpeechStart = true;
          speechStartFrame = Math.max(
            1,
            this.frameCnt - this.speechCnt + 1 - this.padStartFrame,
            this.lastSpeechEndFrame + 1,
          );
          this.lastSpeechStartFrame = speechStartFrame;
          this.silenceCnt = 0;
        }
      } else {
        this.state = VadState.SILENCE;
        this.silenceCnt = 1;
        this.speechCnt = 0;
      }
    } else if (this.state === VadState.SPEECH) {
      this.speechCnt += 1;
      if (isSpeech) {
        this.silenceCnt = 0;
        if (this.speechCnt >= this.maxSpeechFrame) {
          this.hitMaxSpeech = true;
          this.speechCnt = 0;
          isSpeechEnd = true;
          speechEndFrame = this.frameCnt;
          speechStartFrame = this.lastSpeechStartFrame;
          this.lastSpeechEndFrame = speechEndFrame;
          this.lastSpeechStartFrame = -1;
        }
      } else {
        this.state = VadState.POSSIBLE_SILENCE;
        this.silenceCnt += 1;
      }
    } else if (this.state === VadState.POSSIBLE_SILENCE) {
      this.speechCnt += 1;
      if (isSpeech) {
        this.state = VadState.SPEECH;
        this.silenceCnt = 0;
        if (this.speechCnt >= this.maxSpeechFrame) {
          this.hitMaxSpeech = true;
          this.speechCnt = 0;
          isSpeechEnd = true;
          speechEndFrame = this.frameCnt;
          speechStartFrame = this.lastSpeechStartFrame;
          this.lastSpeechEndFrame = speechEndFrame;
          this.lastSpeechStartFrame = -1;
        }
      } else {
        this.silenceCnt += 1;
        if (this.silenceCnt >= this.minSilenceFrame) {
          this.state = VadState.SILENCE;
          isSpeechEnd = true;
          speechEndFrame = this.frameCnt;
          speechStartFrame = this.lastSpeechStartFrame;
          this.lastSpeechEndFrame = speechEndFrame;
          this.lastSpeechStartFrame = -1;
          this.speechCnt = 0;
        }
      }
    }

    return {
      isSpeechStart,
      isSpeechEnd,
      speechStartFrame,
      speechEndFrame,
      smoothedProb,
      isSpeech: Boolean(isSpeech),
    };
  }

  private smoothProb(prob: number): number {
    if (this.smoothWindowSize <= 1) return prob;
    this.smoothWindow.push(prob);
    this.smoothWindowSum += prob;
    if (this.smoothWindow.length > this.smoothWindowSize) {
      this.smoothWindowSum -= this.smoothWindow.shift()!;
    }
    return this.smoothWindowSum / this.smoothWindow.length;
  }
}

// ---- Kaldi CMVN parser ----

function parseKaldiCmvn(buffer: Buffer): { means: Float32Array; inverseStdVariances: Float32Array } {
  // FireRedVAD cmvn.ark binary format:
  //   key "BDM" (null-padded to 4 bytes) + space (1 byte)
  //   type tag (1 byte: 0x04)
  //   rows (int32 LE)
  //   padding (1 byte)
  //   cols (int32 LE)
  //   float64 matrix data [rows * cols]
  let offset = 0;

  // Skip key string (space-terminated)
  const keyEnd = buffer.indexOf(0x20, offset);
  if (keyEnd < 0) throw new Error('Invalid CMVN format: missing key delimiter');
  offset = keyEnd + 1;

  // Skip type tag byte
  offset += 1;

  // Read rows (int32 LE)
  const rows = buffer.readInt32LE(offset);
  offset += 4;

  // Skip padding byte
  offset += 1;

  // Read cols (int32 LE)
  const cols = buffer.readInt32LE(offset);
  offset += 4;

  if (rows <= 0 || cols <= 0) {
    throw new Error(`Invalid CMVN dimensions: ${rows}x${cols}`);
  }

  // Read float64 matrix (2 rows, D+1 cols)
  const dim = cols - 1;
  const matrix = new Float64Array(rows * cols);
  for (let i = 0; i < rows * cols; i++) {
    matrix[i] = buffer.readDoubleLE(offset);
    offset += 8;
  }

  // Parse CMVN: row 0 = sums, row 1 = sum of squares, last column = count
  // Flat layout: [sums[0..D-1], count, sos[0..D-1], sos_last]
  const count = matrix[dim];
  const means = new Float32Array(dim);
  const inverseStdVariances = new Float32Array(dim);
   const varianceFloor = 1e-20;

  for (let d = 0; d < dim; d++) {
    const mean = matrix[d] / count;
    const sos = matrix[dim + 1 + d];
    const variance = sos / count - mean * mean;
    const v = variance < varianceFloor ? varianceFloor : variance;
    means[d] = mean;
    inverseStdVariances[d] = 1.0 / Math.sqrt(v);
  }

  return { means, inverseStdVariances };
}

// ---- Fbank feature extraction (Kaldi/kaldi_native_fbank compatible) ----

export class FbankExtractor {
  private readonly poveyWindow: Float32Array;
  private readonly melFilterbank: Float32Array;
  private readonly filterbankLayout: number[];
  private readonly fftSize: number;
  private readonly numBins: number;
  private readonly frameLength: number;
  private readonly frameShift: number;
  private readonly sampleRate: number;
  private readonly numFreqBins: number;
  private readonly cmvnMeans: Float32Array;
  private readonly cmvnIstd: Float32Array;

  // Circular buffer: accumulates incoming samples, extracts frames with overlap
  private buf: Float32Array;
  private bufWritePos: number;
  private bufReadPos: number;
  private bufAvailable: number;

  constructor(
    sampleRate: number = FBANK_SAMPLE_RATE,
    cmvnData?: { means: Float32Array; inverseStdVariances: Float32Array },
  ) {
    this.sampleRate = sampleRate;
    this.frameLength = Math.round(FBANK_FRAME_LENGTH_MS / 1000 * sampleRate);
    this.frameShift = Math.round(FBANK_FRAME_SHIFT_MS / 1000 * sampleRate);
    this.fftSize = 512;
    this.numBins = FBANK_NUM_MEL_BINS;
    this.numFreqBins = this.fftSize / 2 + 1;

    this.buf = new Float32Array(this.frameLength + this.frameShift);
    this.bufWritePos = 0;
    this.bufReadPos = 0;
    this.bufAvailable = 0;

    this.poveyWindow = this.createPoveyWindow(this.frameLength);
    this.melFilterbank = this.createMelFilterbank();
    this.filterbankLayout = this.createFilterbankLayout();

    this.cmvnMeans = cmvnData ? cmvnData.means : new Float32Array(this.numBins);
    this.cmvnIstd = cmvnData ? cmvnData.inverseStdVariances : new Float32Array(this.numBins).fill(1);
  }

  // Extract one 80-dim frame from newSamples (expected: frameShift samples)
  extractFrame(newSamples: Float32Array): Float32Array {
    this.appendSamples(newSamples);

    if (this.bufAvailable < this.frameLength) {
      return new Float32Array(this.numBins);
    }

    const frame = this.readFrame();
    this.bufReadPos = (this.bufReadPos + this.frameShift) % this.buf.length;
    this.bufAvailable -= this.frameShift;

    return this.processFrameData(frame);
  }

  private appendSamples(samples: Float32Array): void {
    const bufLen = this.buf.length;
    for (let i = 0; i < samples.length; i++) {
      this.buf[this.bufWritePos] = samples[i];
      this.bufWritePos = (this.bufWritePos + 1) % bufLen;
      this.bufAvailable++;
    }
  }

  private readFrame(): Float32Array {
    const frame = new Float32Array(this.frameLength);
    const readPos = this.bufReadPos;
    if (readPos + this.frameLength <= this.buf.length) {
      frame.set(this.buf.subarray(readPos, readPos + this.frameLength));
    } else {
      const firstPart = this.buf.length - readPos;
      frame.set(this.buf.subarray(readPos), 0);
      frame.set(this.buf.subarray(0, this.frameLength - firstPart), firstPart);
    }
    return frame;
  }

  reset(): void {
    this.buf.fill(0);
    this.bufWritePos = 0;
    this.bufReadPos = 0;
    this.bufAvailable = 0;
  }

  private processFrameData(frame: Float32Array): Float32Array {

    // Kaldi ProcessWindow order: DC removal → pre-emphasis → window
    // DC removal (per frame)
    let dcSum = 0;
    for (let i = 0; i < this.frameLength; i++) {
      dcSum += frame[i];
    }
    const dcMean = dcSum / this.frameLength;
    for (let i = 0; i < this.frameLength; i++) {
      frame[i] -= dcMean;
    }

    // Pre-emphasis (per-frame, backward order)
    const preemphCoeff = 0.97;
    for (let i = this.frameLength - 1; i > 0; i--) {
      frame[i] -= preemphCoeff * frame[i - 1];
    }

    // Apply Povey window
    for (let i = 0; i < this.frameLength; i++) {
      frame[i] *= this.poveyWindow[i];
    }

    // Compute power spectrum via FFT
    const powerSpectrum = this.computePowerSpectrum(frame);

    // Apply mel filterbank + log (no HTK floor, matches Kaldi non-HTK mode)
    const fbank = new Float32Array(this.numBins);
    this.applyFilterbank(powerSpectrum, fbank);

    // Log with Kaldi FLT_MIN floor (1.192e-7)
    for (let m = 0; m < this.numBins; m++) {
      fbank[m] = Math.log(fbank[m] < 1.192e-7 ? 1.192e-7 : fbank[m]);
    }

    // CMVN normalization
    for (let m = 0; m < this.numBins; m++) {
      fbank[m] = (fbank[m] - this.cmvnMeans[m]) * this.cmvnIstd[m];
    }

    return fbank;
  }

  private createPoveyWindow(size: number): Float32Array {
    const window = new Float32Array(size);
    const a = 2 * Math.PI / (size - 1);
    for (let i = 0; i < size; i++) {
      window[i] = Math.pow(0.5 - 0.5 * Math.cos(a * i), 0.85);
    }
    return window;
  }

  private melScaleHtk(freq: number): number {
    return 1127.0 * Math.log(1.0 + freq / 700.0);
  }

  private invMelScaleHtk(mel: number): number {
    return 700.0 * (Math.exp(mel / 1127.0) - 1.0);
  }

  private createMelFilterbank(): Float32Array {
    const fftBinWidth = this.sampleRate / this.fftSize;
    const lowFreq = 20;
    const highFreq = this.sampleRate / 2;

    const melLow = this.melScaleHtk(lowFreq);
    const melHigh = this.melScaleHtk(highFreq);
    const melDelta = (melHigh - melLow) / (this.numBins + 1);

    // Store filterbank as flat array with layout for sparse access
    const totalEntries = this.numBins * this.numFreqBins;
    const fb = new Float32Array(totalEntries);

    for (let bin = 0; bin < this.numBins; bin++) {
      const leftMel = melLow + bin * melDelta;
      const centerMel = melLow + (bin + 1) * melDelta;
      const rightMel = melLow + (bin + 2) * melDelta;

      // Kaldi compares FFT bin frequency in mel space, not Hz
      for (let i = 0; i < this.numFreqBins; i++) {
        const freq = fftBinWidth * i;
        const mel = this.melScaleHtk(freq);
        if (mel > leftMel && mel < rightMel) {
          let weight: number;
          if (mel <= centerMel) {
            weight = (mel - leftMel) / (centerMel - leftMel);
          } else {
            weight = (rightMel - mel) / (rightMel - centerMel);
          }
          // NO normalization factor — Kaldi InitKaldiMelBanks doesn't normalize
          fb[bin * this.numFreqBins + i] = weight;
        }
      }
    }

    return fb;
  }

  private createFilterbankLayout(): number[] {
    // For each mel bin, store [first_nonzero, count] for sparse iteration
    const layout: number[] = [];
    for (let bin = 0; bin < this.numBins; bin++) {
      let first = -1;
      let count = 0;
      for (let i = 0; i < this.numFreqBins; i++) {
        if (this.melFilterbank[bin * this.numFreqBins + i] !== 0) {
          if (first === -1) first = i;
          count++;
        }
      }
      layout.push(first);
      layout.push(count);
    }
    return layout;
  }

  private applyFilterbank(powerSpectrum: Float32Array, fbank: Float32Array): void {
    for (let m = 0; m < this.numBins; m++) {
      let sum = 0;
      const base = m * this.numFreqBins;
      const first = this.filterbankLayout[m * 2];
      const count = this.filterbankLayout[m * 2 + 1];
      for (let i = 0; i < count; i++) {
        const idx = first + i;
        sum += this.melFilterbank[base + idx] * powerSpectrum[idx];
      }
      fbank[m] = sum;
    }
  }

  private computePowerSpectrum(windowed: Float32Array): Float32Array {
    const complex = new Float64Array(this.fftSize * 2);

    for (let i = 0; i < windowed.length; i++) {
      complex[i * 2] = windowed[i];
    }

    this.rfft(complex, this.fftSize);

    const power = new Float32Array(this.fftSize / 2 + 1);
    for (let i = 0; i <= this.fftSize / 2; i++) {
      const re = complex[i * 2];
      const im = complex[i * 2 + 1];
      power[i] = re * re + im * im;
    }

    return power;
  }

  // In-place radix-2 DFT (Cooley-Tukey)
  private rfft(data: Float64Array, n: number): void {
    const bits = Math.log2(n);
    if (Math.pow(2, bits) !== n) {
      throw new Error('FFT size must be power of 2');
    }

    for (let i = 0; i < n; i++) {
      let j = 0;
      for (let b = 0; b < bits; b++) {
        j = (j << 1) | ((i >> b) & 1);
      }
      if (i < j) {
        const tmp = data[i * 2];
        data[i * 2] = data[j * 2];
        data[j * 2] = tmp;
        const tmpIm = data[i * 2 + 1];
        data[i * 2 + 1] = data[j * 2 + 1];
        data[j * 2 + 1] = tmpIm;
      }
    }

    for (let len = 2; len <= n; len *= 2) {
      const halfLen = len / 2;
      const angleStep = -2 * Math.PI / len;
      const wReal = Math.cos(angleStep);
      const wImag = Math.sin(angleStep);

      for (let i = 0; i < n; i += len) {
        let wRe = 1;
        let wIm = 0;
        for (let j = 0; j < halfLen; j++) {
          const uRe = data[(i + j) * 2];
          const uIm = data[(i + j) * 2 + 1];
          const vRe = data[(i + j + halfLen) * 2] * wRe - data[(i + j + halfLen) * 2 + 1] * wIm;
          const vIm = data[(i + j + halfLen) * 2] * wIm + data[(i + j + halfLen) * 2 + 1] * wRe;

          data[(i + j) * 2] = uRe + vRe;
          data[(i + j) * 2 + 1] = uIm + vIm;
          data[(i + j + halfLen) * 2] = uRe - vRe;
          data[(i + j + halfLen) * 2 + 1] = uIm - vIm;

          const newWRe = wRe * wReal - wIm * wImag;
          wIm = wRe * wImag + wIm * wReal;
          wRe = newWRe;
        }
      }
    }
  }
}

// ---- PCM conversion ----

export function pcm16ToFloat32(buffer: Buffer): Float32Array {
  const samples = buffer.length / 2;
  const result = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    result[i] = buffer.readInt16LE(i * 2);
  }
  return result;
}

// ---- Model paths ----

export function resolveModelPath(): string {
  return join(MODEL_DIR, 'fireredvad_stream_vad_with_cache.onnx');
}

export function resolveCmvnPath(): string {
  return join(MODEL_DIR, 'cmvn.ark');
}

// ---- Preload ----

type FireRedVadPreload = {
  session: ort.InferenceSession;
};

let preloadInstance: FireRedVadPreload | null = null;

export async function preloadFireRedVad(): Promise<void> {
  if (preloadInstance) return;

  try {
    const session = await ort.InferenceSession.create(resolveModelPath());

    preloadInstance = {
      session,
    };

    logger.info(
      { modelPath: resolveModelPath(), inputNames: session.inputNames, outputNames: session.outputNames },
      'FireRedVAD model preloaded',
    );
  } catch (err) {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'Failed to preload FireRedVAD ONNX model',
    );
    throw err;
  }
}

export function getFireRedVadPreload(): FireRedVadPreload | null {
  return preloadInstance;
}

// ---- Main wrapper ----

export class FireRedVadWrapper {
  private session: ort.InferenceSession | null = null;
  private stateMachine: StreamVadStateMachine;
  private resampler: any = null;
  private readonly callbacks: FireRedVadCallbacks;
  private readonly gracePeriodEnd: number;

  private fbank: FbankExtractor | null = null;
  private cache: Float32Array | null = null;

  private pendingBuffer: Buffer = Buffer.alloc(0);
  private processingQueue: Promise<void> = Promise.resolve();

  private isCollecting = false;
  private speechAudioFloat: Float32Array = new Float32Array(0);
  private speechStartPending = false;

  // Pre-roll ring buffer: stores recent audio so padStartFrame can back-fill audio
  private audioRingBuffer: Float32Array = new Float32Array(0);
  private audioRingPos = 0;
  private audioRingFilled = 0;

  constructor(sampleRate: number, config: FireRedVadInitConfig, callbacks: FireRedVadCallbacks) {
    this.stateMachine = new StreamVadStateMachine(config);
    this.callbacks = callbacks;
    this.gracePeriodEnd = Date.now() + config.gracePeriodMs;
    const effectivePadStartFrame = Math.max(Math.max(1, config.smoothWindowSize), config.padStartFrame);
    this.audioRingBuffer = new Float32Array(effectivePadStartFrame * FIRERED_FRAME_SAMPLES);
    this.audioRingPos = 0;
    this.audioRingFilled = 0;
  }

  async init(): Promise<void> {
    try {
      const preload = getFireRedVadPreload();

      if (preload) {
        this.session = preload.session;
      } else {
        this.session = await ort.InferenceSession.create(resolveModelPath());
      }

      const cmvnData = parseKaldiCmvn(await readFile(resolveCmvnPath()));
      this.fbank = new FbankExtractor(FIRERED_SAMPLE_RATE, cmvnData);
      this.cache = new Float32Array(FIRERED_CACHE_LAYERS * 1 * FIRERED_CACHE_HIDDEN * FIRERED_CACHE_LEN);
    } catch (err) {
      logger.error(
        { error: err instanceof Error ? err.message : String(err) },
        'Failed to load FireRedVAD ONNX model',
      );
      throw err;
    }
  }

  async initResampler(fromSampleRate: number): Promise<void> {
    if (fromSampleRate === FIRERED_SAMPLE_RATE) return;
    await SpeexResamplerClass.initPromise;
    this.resampler = new SpeexResamplerClass(1, fromSampleRate, FIRERED_SAMPLE_RATE, 3);
    logger.info(
      { fromSampleRate, toSampleRate: FIRERED_SAMPLE_RATE },
      'FireRedVAD resampler initialized',
    );
  }

  processAudio(chunk: Buffer): void {
    if (!this.session || !this.fbank || !this.cache) return;

    let pcm16: Buffer = chunk;
    if (this.resampler) {
      const resampled = this.resampler.processChunk(chunk);
      if (!resampled || resampled.length === 0) return;
      pcm16 = resampled;
    }

    this.pendingBuffer = Buffer.concat([this.pendingBuffer, pcm16]);

    while (this.pendingBuffer.length >= FIRERED_FRAME_SAMPLES * 2) {
      const frame = this.pendingBuffer.subarray(0, FIRERED_FRAME_SAMPLES * 2);
      this.pendingBuffer = this.pendingBuffer.subarray(FIRERED_FRAME_SAMPLES * 2);

      this.processingQueue = this.processingQueue.then(() =>
        this.processFrame(frame),
      ).catch((err) => {
        logger.error({ error: err.message }, 'FireRedVAD frame processing error');
      });
    }
  }

  private async processFrame(frame: Buffer): Promise<void> {
    if (!this.session || !this.fbank || !this.cache) return;

    const float32 = pcm16ToFloat32(frame);

    // Extract raw energy Fbank features (no log, no CMVN)
    const fbankFeat = this.fbank.extractFrame(float32);

    // Run ONNX inference
    const inputs = {
      feat: new ort.Tensor('float32', fbankFeat, [1, 1, FIRERED_FBank_DIM]),
      caches_in: new ort.Tensor('float32', this.cache, [FIRERED_CACHE_LAYERS, 1, FIRERED_CACHE_HIDDEN, FIRERED_CACHE_LEN]),
    };

    const result = await this.session.run(inputs);
    const prob = (result.probs.data as Float32Array)[0];
    const newCache = result.caches_out.data as Float32Array;

    // Update cache
    this.cache.set(newCache);

    const stateResult = this.stateMachine.processOneFrame(prob);

    // Store audio in ring buffer for pre-roll (every frame)
    this.storeAudioRing(float32);

    if (this.speechStartPending && !this.isCollecting) {
      this.speechStartPending = false;
      if (Date.now() >= this.gracePeriodEnd && (this.stateMachine.currentState === VadState.SPEECH || this.stateMachine.currentState === VadState.POSSIBLE_SILENCE)) {
        this.isCollecting = true;
        this.speechAudioFloat = this.getPreRollAudio();
        this.callbacks.onSpeechStart();
      }
    }

    if (stateResult.isSpeechStart && !this.isCollecting) {
      if (Date.now() < this.gracePeriodEnd) {
        this.speechStartPending = true;
        return;
      }
      this.isCollecting = true;
      this.speechAudioFloat = this.getPreRollAudio();
      this.callbacks.onSpeechStart();
    }

    if (this.isCollecting) {
      const newLen = this.speechAudioFloat.length + float32.length;
      const extended = new Float32Array(newLen);
      extended.set(this.speechAudioFloat, 0);
      extended.set(float32, this.speechAudioFloat.length);
      this.speechAudioFloat = extended;
    }

    if (stateResult.isSpeechEnd && this.isCollecting) {
      this.isCollecting = false;
      this.callbacks.onSpeechEnd(this.speechAudioFloat);
    }
  }

  private storeAudioRing(samples: Float32Array): void {
    const bufLen = this.audioRingBuffer.length;
    if (bufLen === 0) return;
    const storePos = this.audioRingPos;
    if (storePos + samples.length <= bufLen) {
      this.audioRingBuffer.set(samples, storePos);
    } else {
      const firstPart = bufLen - storePos;
      this.audioRingBuffer.set(samples.subarray(0, firstPart), storePos);
      this.audioRingBuffer.set(samples.subarray(firstPart), 0);
    }
    this.audioRingPos = (storePos + samples.length) % bufLen;
    this.audioRingFilled = Math.min(this.audioRingFilled + samples.length, bufLen);
  }

  private getPreRollAudio(): Float32Array {
    const bufLen = this.audioRingBuffer.length;
    if (bufLen === 0 || this.audioRingFilled === 0) return new Float32Array(0);
    const result = new Float32Array(this.audioRingFilled);
    for (let i = 0; i < this.audioRingFilled; i++) {
      const idx = (this.audioRingPos + i) % bufLen;
      result[i] = this.audioRingBuffer[idx];
    }
    return result;
  }

  async flush(): Promise<void> {
    if (this.pendingBuffer.length > 0) {
      this.processAudio(this.pendingBuffer);
      this.pendingBuffer = Buffer.alloc(0);
    }
    await this.processingQueue;
    if (this.speechStartPending && !this.isCollecting) {
      this.speechStartPending = false;
      this.isCollecting = true;
      this.speechAudioFloat = this.getPreRollAudio();
      this.callbacks.onSpeechStart();
    }
    if (this.isCollecting) {
      this.isCollecting = false;
      if (this.speechAudioFloat.length > 0) {
        this.callbacks.onSpeechEnd(this.speechAudioFloat);
      }
    }
  }

  reset(): void {
    this.stateMachine.reset();
    this.fbank?.reset();
    if (this.cache) {
      this.cache.fill(0);
    }
    this.pendingBuffer = Buffer.alloc(0);
    this.processingQueue = Promise.resolve();
    this.isCollecting = false;
    this.speechAudioFloat = new Float32Array(0);
    this.speechStartPending = false;
    this.audioRingBuffer.fill(0);
    this.audioRingPos = 0;
    this.audioRingFilled = 0;
  }

  destroy(): void {
    const preload = getFireRedVadPreload();
    if (!preload) {
      this.session = null;
    }
    this.fbank = null;
    this.cache = null;
  }
}
