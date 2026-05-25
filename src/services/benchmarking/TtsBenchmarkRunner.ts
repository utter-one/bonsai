import type { Provider } from '../../types/models';
import type { TtsSettings } from '../providers/tts/TtsProviderFactory';
import type { TtsBenchmarkInput, BenchmarkIterationResult, TtsIterationOutput } from '../../types/benchmark';
import { TtsProviderFactory } from '../providers/tts/TtsProviderFactory';
import { logger } from '../../utils/logger';

/**
 * Runs a single TTS benchmark iteration by streaming a synthesis and recording timing data.
 */
export class TtsBenchmarkRunner {
  constructor(
    private readonly provider: Provider,
    private readonly settings: TtsSettings,
    private readonly factory: TtsProviderFactory,
  ) { }

  /**
   * Executes one benchmark iteration against the configured TTS provider.
   * @param input - Text input for synthesis
   * @returns Timing and output data for the iteration
   */
  async run(input: TtsBenchmarkInput): Promise<BenchmarkIterationResult> {
    const startedAt = new Date();
    let timeToFirstChunkMs: number | null = null;
    const chunkTimings: number[] = [];
    let chunkCount = 0;
    let lastChunkTimestamp: number | null = null;
    let totalBytes = 0;
    let error: string | null = null;

    const ttsProvider = await this.factory.createProvider(this.provider, this.settings);

    try {
      await ttsProvider.init();

      await new Promise<void>((resolve, reject) => {
        ttsProvider.setOnError(async (err) => {
          reject(err);
        });

        ttsProvider.setOnSpeechGenerating(async (chunk) => {
          const now = Date.now();
          if (timeToFirstChunkMs === null) {
            timeToFirstChunkMs = now - startedAt.getTime();
          } else if (lastChunkTimestamp !== null) {
            chunkTimings.push(now - lastChunkTimestamp);
          }
          lastChunkTimestamp = now;
          chunkCount++;
          totalBytes += chunk.audio?.length ?? 0;
        });

        ttsProvider.setOnGenerationEnded(async () => {
          resolve();
        });

        ttsProvider.start()
          .then(() => ttsProvider.sendText(input.text))
          .then(() => ttsProvider.end())
          .catch(reject);
      });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      logger.warn({ error, providerId: this.provider.id }, 'TTS benchmark iteration failed');
    } finally {
      await ttsProvider.cleanup();
    }

    const completedAt = new Date();
    const totalDurationMs = completedAt.getTime() - startedAt.getTime();
    const output: TtsIterationOutput | null = error === null
      ? {
        byteCount: totalBytes,
        inputCharCount: input.text.length,
        bytesPerSecond: totalBytes > 0 && totalDurationMs > 0 ? Math.round(totalBytes / totalDurationMs * 1000) : null,
      }
      : null;

    return {
      startedAt,
      completedAt,
      error,
      timeToFirstChunkMs,
      chunkCount,
      chunkTimings,
      output,
    };
  }
}
