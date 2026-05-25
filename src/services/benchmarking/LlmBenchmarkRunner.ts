import type { Provider } from '../../types/models';
import type { LlmSettings } from '../providers/llm/LlmProviderFactory';
import type { LlmBenchmarkInput, BenchmarkIterationResult, LlmIterationOutput } from '../../types/benchmark';
import { LlmProviderFactory } from '../providers/llm/LlmProviderFactory';
import { logger } from '../../utils/logger';

/**
 * Runs a single LLM benchmark iteration by streaming a generation and recording timing data.
 */
export class LlmBenchmarkRunner {
  constructor(
    private readonly provider: Provider,
    private readonly settings: LlmSettings,
    private readonly factory: LlmProviderFactory,
  ) { }

  /**
   * Executes one benchmark iteration against the configured LLM provider.
   * @param input - LLM messages to send
   * @returns Timing and output data for the iteration
   */
  async run(input: LlmBenchmarkInput): Promise<BenchmarkIterationResult> {
    const startedAt = new Date();
    let timeToFirstChunkMs: number | null = null;
    const chunkTimings: number[] = [];
    let chunkCount = 0;
    let lastChunkTimestamp: number | null = null;
    let outputText = '';
    let stopReason: string | null = null;
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    let error: string | null = null;

    const llmProvider = await this.factory.createProvider(this.provider, this.settings);

    try {
      await new Promise<void>((resolve, reject) => {
        llmProvider.setOnChunk((chunk) => {
          const now = Date.now();
          if (timeToFirstChunkMs === null) {
            timeToFirstChunkMs = now - startedAt.getTime();
          } else if (lastChunkTimestamp !== null) {
            chunkTimings.push(now - lastChunkTimestamp);
          }
          lastChunkTimestamp = now;
          chunkCount++;
          if (chunk.content) outputText += chunk.content;
          return Promise.resolve();
        });

        llmProvider.setOnGenerationCompleted((result) => {
          const textBlocks = result.content.filter((c) => c.contentType === 'text');
          if (textBlocks.length > 0 && outputText === '') {
            outputText = textBlocks.map((c: any) => c.text).join('');
          }
          stopReason = result.finishReason ?? null;
          inputTokens = result.usage?.promptTokens ?? null;
          outputTokens = result.usage?.completionTokens ?? null;
          resolve();
        });

        llmProvider.setOnError(async (err) => {
          reject(err);
        });

        llmProvider.generateStream(input.messages).catch(reject);
      });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      logger.warn({ error, providerId: this.provider.id }, 'LLM benchmark iteration failed');
    } finally {
      await llmProvider.cleanup();
    }

    const completedAt = new Date();
    const totalDurationMs = completedAt.getTime() - startedAt.getTime();
    const output: LlmIterationOutput | null = error === null
      ? {
        text: outputText,
        charCount: outputText.length,
        wordCount: outputText.trim() ? outputText.trim().split(/\s+/).length : 0,
        stopReason,
        inputTokens,
        outputTokens,
        tokensPerSecond: outputTokens !== null && totalDurationMs > 0 ? Math.round(outputTokens / totalDurationMs * 1000 * 100) / 100 : null,
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
