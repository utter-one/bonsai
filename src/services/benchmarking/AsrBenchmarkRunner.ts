import type { Provider } from '../../types/models';
import type { AsrSettings } from '../providers/asr/AsrProviderFactory';
import type { AsrBenchmarkInput, BenchmarkIterationResult, AsrIterationOutput } from '../../types/benchmark';
import { AsrProviderFactory } from '../providers/asr/AsrProviderFactory';
import { logger } from '../../utils/logger';

/**
 * Runs a single ASR benchmark iteration by streaming an audio clip and recording timing data.
 */
export class AsrBenchmarkRunner {
  constructor(
    private readonly provider: Provider,
    private readonly settings: AsrSettings,
    private readonly factory: AsrProviderFactory,
  ) { }

  /**
   * Executes one benchmark iteration against the configured ASR provider.
   * @param input - Base64-encoded audio clip and MIME type
   * @returns Timing and output data for the iteration
   */
  async run(input: AsrBenchmarkInput): Promise<BenchmarkIterationResult> {
    const startedAt = new Date();
    let timeToFirstChunkMs: number | null = null;
    const chunkTimings: number[] = [];
    let chunkCount = 0;
    let partialCount = 0;
    let finalCount = 0;
    let lastChunkTimestamp: number | null = null;
    let error: string | null = null;

    const asrProvider = await this.factory.createProvider(this.provider, this.settings);

    try {
      await asrProvider.init();

      let settled = false;
      await new Promise<void>((resolve, reject) => {
        asrProvider.setOnError(async (err) => {
          if (settled) { logger.warn({ err }, 'ASR provider error after recognition already stopped'); return; }
          settled = true;
          reject(err);
        });

        asrProvider.setOnRecognitionStopped(() => {
          settled = true;
          resolve();
        });

        const trackTiming = () => {
          const now = Date.now();
          if (timeToFirstChunkMs === null) {
            timeToFirstChunkMs = now - startedAt.getTime();
          } else if (lastChunkTimestamp !== null) {
            chunkTimings.push(now - lastChunkTimestamp);
          }
          lastChunkTimestamp = now;
          chunkCount++;
        };

        asrProvider.setOnRecognizing((_chunkId, _text) => {
          trackTiming();
          partialCount++;
        });

        asrProvider.setOnRecognized((_chunkId, _text) => {
          trackTiming();
          finalCount++;
        });

        const audioBuffer = Buffer.from(input.audioBase64, 'base64');

        asrProvider.start()
          .then(() => asrProvider.sendAudio(audioBuffer))
          .then(() => asrProvider.stop())
          .catch(reject);
      });

      const chunks = asrProvider.getAllTextChunks();
      const outputText = chunks.map((c) => c.text).join(' ');

      const completedAt = new Date();
      const output: AsrIterationOutput = {
        text: outputText,
        charCount: outputText.length,
        wordCount: outputText.trim() ? outputText.trim().split(/\s+/).length : 0,
        partialCount,
        finalCount,
      };

      return {
        startedAt,
        completedAt,
        error: null,
        timeToFirstChunkMs,
        chunkCount,
        chunkTimings,
        output,
      };
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      logger.warn({ error, providerId: this.provider.id }, 'ASR benchmark iteration failed');
    } finally {
      await asrProvider.cleanup();
    }

    const completedAt = new Date();
    return {
      startedAt,
      completedAt,
      error,
      timeToFirstChunkMs,
      chunkCount,
      chunkTimings,
      output: null,
    };
  }
}
