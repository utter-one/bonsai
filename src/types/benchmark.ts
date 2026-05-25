import type { LlmMessage } from '../services/providers/llm/ILlmProvider';

/** Possible provider types for benchmarking */
export type BenchmarkProviderType = 'llm' | 'tts' | 'asr';

/** How a benchmark run was triggered */
export type BenchmarkRunTrigger = 'manual' | 'scheduled';

/** Lifecycle status for benchmark runs and config executions */
export type BenchmarkRunStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

/** Type of input data for a benchmark config */
export type BenchmarkInputType = 'messages' | 'text' | 'audio';

/** LLM benchmark input: a list of messages to send */
export type LlmBenchmarkInput = {
  messages: LlmMessage[];
};

/** TTS benchmark input: a text string to synthesise */
export type TtsBenchmarkInput = {
  text: string;
};

/** ASR benchmark input: a base64-encoded audio clip */
export type AsrBenchmarkInput = {
  audioBase64: string;
  mimeType: string;
  /** Original file name of the audio clip */
  fileName?: string;
};

/** Union of all typed benchmark inputs */
export type BenchmarkInputData = LlmBenchmarkInput | TtsBenchmarkInput | AsrBenchmarkInput;

/** Output data from a successful LLM benchmark iteration */
export type LlmIterationOutput = {
  text: string;
  charCount: number;
  wordCount: number;
  /** Reason generation stopped (e.g. stop, max_tokens); null if not reported by the provider */
  stopReason: string | null;
  /** Prompt tokens consumed; null if not reported by the provider */
  inputTokens: number | null;
  /** Completion tokens generated; null if not reported by the provider */
  outputTokens: number | null;
  /** Output tokens per second; null if token count is unavailable */
  tokensPerSecond: number | null;
};

/** Output data from a successful TTS benchmark iteration */
export type TtsIterationOutput = {
  byteCount: number;
  /** Character count of the input text */
  inputCharCount: number;
  /** Synthesis throughput in bytes per second; null if no audio was produced */
  bytesPerSecond: number | null;
};

/** Output data from a successful ASR benchmark iteration */
export type AsrIterationOutput = {
  text: string;
  charCount: number;
  wordCount: number;
  /** Number of partial recognition events (onRecognizing) received */
  partialCount: number;
  /** Number of final recognition events (onRecognized) received */
  finalCount: number;
};

/** Data stored in the result JSONB column of benchmark_results */
export type IterationResultData = {
  /** Error message if the iteration failed, null otherwise */
  error: string | null;
  /** Milliseconds from startedAt to first chunk/token; null when no chunks were received */
  timeToFirstChunkMs: number | null;
  /** Total number of chunks received */
  chunkCount: number;
  /** Milliseconds between consecutive chunks (gap from chunk[i-1] to chunk[i]) */
  chunkTimings: number[];
  /** Provider-specific output data; null on error */
  output: LlmIterationOutput | TtsIterationOutput | AsrIterationOutput | null;
};

/** Raw result from a single benchmark iteration */
export type BenchmarkIterationResult = IterationResultData & {
  startedAt: Date;
  completedAt: Date;
};

/** Statistical summary over a series of numeric measurements */
export type TimingStats = {
  avg: number;
  /** Alias for p50 */
  median: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
};

/** Aggregated benchmark statistics for all iterations of a single config execution */
export type BenchmarkStats = {
  totalDurationMs: TimingStats;
  /** null when the provider returned no streaming chunks (e.g. non-streaming fallback) */
  timeToFirstChunkMs: TimingStats | null;
  /** null when fewer than 2 chunks were received across all successful iterations */
  chunkIntervalMs: TimingStats | null;
  /** Fraction of iterations that completed without error (0–1) */
  successRate: number;
  completedIterations: number;
  failedIterations: number;
};
