import * as ort from 'onnxruntime-node';
import { AutoProcessor } from '@xenova/transformers';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { logger } from '../../utils/logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SAMPLE_RATE = 16000;
const N_MEL = 80;
const DURATION_SECONDS = 8;
const MAX_SAMPLES = DURATION_SECONDS * SAMPLE_RATE;
const EXPECTED_FRAMES = 800;

export type SmartTurnResult = {
  isEndpoint: boolean;
  endpointProbability: number;
};

class SmartTurnDetector {
  private session: ort.InferenceSession | null = null;
  private processor: any = null;

  async load(modelPath?: string): Promise<void> {
    if (this.session) return;

    const resolvedPath = modelPath || join(__dirname, '../../../models/smart-turn.onnx');

    this.session = await ort.InferenceSession.create(resolvedPath, {
      executionMode: 'sequential',
      interOpNumThreads: 1,
      graphOptimizationLevel: 'all',
    });

    this.processor = await AutoProcessor.from_pretrained('openai/whisper-tiny.en');
    const fe = this.processor.feature_extractor || this.processor._processor;
    fe.config.chunk_length = DURATION_SECONDS;
    fe.config.nb_max_frames = EXPECTED_FRAMES;
    fe.config.n_samples = MAX_SAMPLES;

    logger.info(
      { modelPath: resolvedPath, inputNames: this.session.inputNames, outputNames: this.session.outputNames },
      'SmartTurn detector loaded'
    );
  }

  async predict(audio: Float32Array): Promise<SmartTurnResult> {
    if (!this.session || !this.processor) {
      logger.warn('SmartTurnDetector is not loaded, returning default result');
      return { isEndpoint: false, endpointProbability: 0 };
    }

    const startTime = performance.now();

    const padded = this.padOrTruncate(audio);
    const featureExtractionStart = performance.now();
    const result = await this.processor(padded);
    const featureExtractionMs = performance.now() - featureExtractionStart;
    const tensor = new ort.Tensor('float32', result.input_features.data, [1, N_MEL, EXPECTED_FRAMES]);

    const inferenceStart = performance.now();
    const outputs = await this.session.run({ input_features: tensor });
    const inferenceMs = performance.now() - inferenceStart;

    const totalMs = performance.now() - startTime;
    const outputKey = Object.keys(outputs)[0];
    const endpointProbability = Number(outputs[outputKey].data[0]);

    logger.info(
      { totalMs: +totalMs.toFixed(1), featureExtractionMs: +featureExtractionMs.toFixed(1), inferenceMs: +inferenceMs.toFixed(1), audioSamples: audio.length },
      'SmartTurn inference timing'
    );

    return {
      isEndpoint: endpointProbability > 0.5,
      endpointProbability,
    };
  }

  private padOrTruncate(audio: Float32Array): Float32Array {
    if (audio.length > MAX_SAMPLES) {
      return audio.slice(audio.length - MAX_SAMPLES);
    }
    if (audio.length < MAX_SAMPLES) {
      const padded = new Float32Array(MAX_SAMPLES);
      padded.set(audio, MAX_SAMPLES - audio.length);
      return padded;
    }
    return audio;
  }

  async destroy(): Promise<void> {
    if (this.session) {
      await this.session.release();
      this.session = null;
    }
    this.processor = null;
  }
}

const instance = new SmartTurnDetector();
export default instance;
