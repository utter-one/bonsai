import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema, listResponseLimitSchema } from './common';
import type { ListParams } from './common';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };

// ─── Sub-schemas (reusable, registered in swagger.ts) ────────────────────────

/**
 * Statistical summary over a series of numeric measurements.
 * Used inside BenchmarkStats.
 */
export const timingStatsSchema = z.object({
  avg: z.number().describe('Arithmetic mean in milliseconds'),
  median: z.number().describe('Median value (alias for p50) in milliseconds'),
  p50: z.number().describe('50th percentile in milliseconds'),
  p95: z.number().describe('95th percentile in milliseconds'),
  p99: z.number().describe('99th percentile in milliseconds'),
  min: z.number().describe('Minimum value in milliseconds'),
  max: z.number().describe('Maximum value in milliseconds'),
}).openapi('BenchmarkTimingStats');

export type TimingStats = z.infer<typeof timingStatsSchema>;

/**
 * Aggregated statistics for all iterations of a single benchmark config execution.
 */
export const benchmarkStatsSchema = z.object({
  totalDurationMs: timingStatsSchema.describe('Total iteration duration statistics'),
  timeToFirstChunkMs: timingStatsSchema.nullable().describe('Time-to-first-chunk statistics; null when provider does not stream'),
  chunkIntervalMs: timingStatsSchema.nullable().describe('Inter-chunk interval statistics; null when fewer than 2 chunks received'),
  successRate: z.number().min(0).max(1).describe('Fraction of iterations that completed without error (0–1)'),
  completedIterations: z.number().int().min(0).describe('Number of iterations that completed successfully'),
  failedIterations: z.number().int().min(0).describe('Number of iterations that failed'),
}).openapi('BenchmarkStats');

export type BenchmarkStats = z.infer<typeof benchmarkStatsSchema>;

// ─── Route params ─────────────────────────────────────────────────────────────

/** Route params for benchmark suite endpoints */
export const benchmarkSuiteRouteParamsSchema = z.object({
  id: z.string().describe('Benchmark suite ID'),
});

/** Route params for benchmark provider config endpoints */
export const benchmarkProviderConfigRouteParamsSchema = z.object({
  id: z.string().describe('Benchmark provider config ID'),
});

/** Route params for benchmark config endpoints */
export const benchmarkConfigRouteParamsSchema = z.object({
  id: z.string().describe('Benchmark config ID'),
});

/** Route params for benchmark run endpoints */
export const benchmarkRunRouteParamsSchema = z.object({
  id: z.string().describe('Benchmark run ID'),
});

// ─── Benchmark Suite ──────────────────────────────────────────────────────────

/**
 * Request body for creating a new benchmark suite.
 */
export const createBenchmarkSuiteSchema = z.object({
  name: z.string().min(1).describe('Human-readable name for the suite'),
  description: z.string().optional().describe('Optional description of what this suite tests'),
  cronExpression: z.string().optional().describe('node-cron expression for scheduled execution, e.g. "0 * * * *". Omit for manual-only suites.'),
  isActive: z.boolean().optional().default(true).describe('Whether the suite is active and eligible for scheduled execution'),
  tags: z.array(z.string()).optional().default([]).describe('Optional tags for filtering and organisation'),
});

export type CreateBenchmarkSuiteRequest = z.infer<typeof createBenchmarkSuiteSchema>;

/**
 * Request body for updating a benchmark suite.
 */
export const updateBenchmarkSuiteSchema = z.object({
  version: z.number().int().describe('Current version for optimistic locking'),
  name: z.string().min(1).optional().describe('Human-readable name for the suite'),
  description: z.string().nullable().optional().describe('Optional description'),
  cronExpression: z.string().nullable().optional().describe('node-cron expression; set to null to remove the schedule'),
  isActive: z.boolean().optional().describe('Whether the suite is active'),
  tags: z.array(z.string()).optional().describe('Tags for filtering'),
});

export type UpdateBenchmarkSuiteRequest = z.infer<typeof updateBenchmarkSuiteSchema>;

/**
 * Response shape for a benchmark suite.
 */
export const benchmarkSuiteResponseSchema = z.object({
  id: z.string().describe('Unique benchmark suite ID'),
  name: z.string().describe('Suite name'),
  description: z.string().nullable().describe('Suite description'),
  cronExpression: z.string().nullable().describe('Cron expression for scheduled runs'),
  isActive: z.boolean().describe('Whether the suite is active'),
  tags: z.array(z.string()).describe('Tags'),
  createdBy: z.string().nullable().describe('Operator ID who created the suite'),
  version: z.number().int().describe('Optimistic locking version'),
  createdAt: z.coerce.date().describe('Creation timestamp'),
  updatedAt: z.coerce.date().describe('Last update timestamp'),
});

export type BenchmarkSuiteResponse = z.infer<typeof benchmarkSuiteResponseSchema>;

/**
 * Paginated list response for benchmark suites.
 */
export const benchmarkSuiteListResponseSchema = z.object({
  items: z.array(benchmarkSuiteResponseSchema).describe('Benchmark suites in the current page'),
  total: z.number().int().min(0).describe('Total number of suites matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: listResponseLimitSchema,
});

export type BenchmarkSuiteListResponse = z.infer<typeof benchmarkSuiteListResponseSchema>;

// ─── Benchmark Provider Config ────────────────────────────────────────────────

/**
 * Request body for creating a benchmark provider config.
 */
export const createBenchmarkProviderConfigSchema = z.object({
  name: z.string().min(1).describe('Human-readable name for this provider config'),
  providerType: z.enum(['llm', 'tts', 'asr']).describe('Type of provider being configured'),
  providerId: z.string().min(1).describe('ID of the provider entity to use'),
  settings: z.record(z.string(), z.unknown()).describe('Provider-specific settings (model, voice, language, etc.)'),
  providerSettings: z.record(z.string(), z.unknown()).optional().describe('Additional provider-specific configuration to apply on top of settings. TTS example: { model, voiceId, audioFormat, speed, languageCode, etc. }'),
});

export type CreateBenchmarkProviderConfigRequest = z.infer<typeof createBenchmarkProviderConfigSchema>;

/**
 * Request body for updating a benchmark provider config.
 */
export const updateBenchmarkProviderConfigSchema = z.object({
  version: z.number().int().describe('Current version for optimistic locking'),
  name: z.string().min(1).optional().describe('Human-readable name'),
  providerId: z.string().min(1).optional().describe('Provider entity ID'),
  settings: z.record(z.string(), z.unknown()).optional().describe('Provider-specific settings'),
  providerSettings: z.record(z.string(), z.unknown()).nullable().optional().describe('Additional provider-specific configuration; set to null to clear'),
});

export type UpdateBenchmarkProviderConfigRequest = z.infer<typeof updateBenchmarkProviderConfigSchema>;

/**
 * Response shape for a benchmark provider config.
 */
export const benchmarkProviderConfigResponseSchema = z.object({
  id: z.string().describe('Unique ID'),
  name: z.string().describe('Name'),
  providerType: z.enum(['llm', 'tts', 'asr']).describe('Provider type'),
  providerId: z.string().describe('Provider entity ID'),
  settings: z.record(z.string(), z.unknown()).describe('Provider settings'),
  providerSettings: z.record(z.string(), z.unknown()).nullable().describe('Additional provider-specific configuration (e.g. TTS model, voiceId, audioFormat, speed, languageCode)'),
  version: z.number().int().describe('Optimistic locking version'),
  createdAt: z.coerce.date().describe('Creation timestamp'),
  updatedAt: z.coerce.date().describe('Last update timestamp'),
});

export type BenchmarkProviderConfigResponse = z.infer<typeof benchmarkProviderConfigResponseSchema>;

/**
 * Paginated list response for benchmark provider configs.
 */
export const benchmarkProviderConfigListResponseSchema = z.object({
  items: z.array(benchmarkProviderConfigResponseSchema).describe('Benchmark provider configs in the current page'),
  total: z.number().int().min(0).describe('Total number of provider configs matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: listResponseLimitSchema,
});

export type BenchmarkProviderConfigListResponse = z.infer<typeof benchmarkProviderConfigListResponseSchema>;

// ─── Benchmark Config ─────────────────────────────────────────────────────────

/**
 * Request body for creating a benchmark config (test case).
 */
export const createBenchmarkConfigSchema = z.object({
  suiteId: z.string().min(1).describe('ID of the benchmark suite this config belongs to'),
  name: z.string().min(1).describe('Human-readable name for this test case'),
  description: z.string().optional().describe('Optional description'),
  providerConfigId: z.string().min(1).describe('ID of the benchmark provider config to use'),
  inputType: z.enum(['messages', 'text', 'audio']).describe('Type of input data: messages (LLM), text (TTS), or audio (ASR)'),
  inputData: z.record(z.string(), z.unknown()).describe('Input payload. LLM: { messages: LlmMessage[] }. TTS: { text: string }. ASR: { audioBase64: string, mimeType: string, fileName?: string }'),
  repeats: z.number().int().min(1).max(100).optional().default(3).describe('Number of times to repeat the test per run'),
});

export type CreateBenchmarkConfigRequest = z.infer<typeof createBenchmarkConfigSchema>;

/**
 * Request body for updating a benchmark config.
 */
export const updateBenchmarkConfigSchema = z.object({
  version: z.number().int().describe('Current version for optimistic locking'),
  name: z.string().min(1).optional().describe('Test case name'),
  description: z.string().nullable().optional().describe('Description'),
  providerConfigId: z.string().min(1).optional().describe('Provider config ID'),
  inputType: z.enum(['messages', 'text', 'audio']).optional().describe('Input type'),
  inputData: z.record(z.string(), z.unknown()).optional().describe('Input payload'),
  repeats: z.number().int().min(1).max(100).optional().describe('Repeat count'),
});

export type UpdateBenchmarkConfigRequest = z.infer<typeof updateBenchmarkConfigSchema>;

/**
 * Response shape for a benchmark config.
 */
export const benchmarkConfigResponseSchema = z.object({
  id: z.string().describe('Unique ID'),
  suiteId: z.string().describe('Parent suite ID'),
  name: z.string().describe('Name'),
  description: z.string().nullable().describe('Description'),
  providerConfigId: z.string().describe('Provider config ID'),
  inputType: z.enum(['messages', 'text', 'audio']).describe('Input type'),
  inputData: z.record(z.string(), z.unknown()).describe('Input payload'),
  repeats: z.number().int().describe('Repeat count per run'),
  version: z.number().int().describe('Optimistic locking version'),
  createdAt: z.coerce.date().describe('Creation timestamp'),
  updatedAt: z.coerce.date().describe('Last update timestamp'),
});

export type BenchmarkConfigResponse = z.infer<typeof benchmarkConfigResponseSchema>;

/**
 * Paginated list response for benchmark configs.
 */
export const benchmarkConfigListResponseSchema = z.object({
  items: z.array(benchmarkConfigResponseSchema).describe('Benchmark configs in the current page'),
  total: z.number().int().min(0).describe('Total number of configs matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: listResponseLimitSchema,
});

export type BenchmarkConfigListResponse = z.infer<typeof benchmarkConfigListResponseSchema>;

// ─── Benchmark Run ────────────────────────────────────────────────────────────

/**
 * Request body for triggering a benchmark run.
 */
export const triggerBenchmarkRunSchema = z.object({
  suiteId: z.string().min(1).describe('ID of the benchmark suite to execute'),
});

export type TriggerBenchmarkRunRequest = z.infer<typeof triggerBenchmarkRunSchema>;

/**
 * Query parameters for listing benchmark runs.
 * Extends standard list params with suite and status filters.
 */
export const benchmarkRunListParamsSchema = listParamsSchema.extend({
  suiteId: z.string().optional().describe('Filter by suite ID'),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed']).optional().describe('Filter by run status'),
});

export type BenchmarkRunListParams = z.infer<typeof benchmarkRunListParamsSchema>;

/**
 * Response shape for a benchmark config execution (one per config per run).
 */
export const benchmarkConfigExecutionResponseSchema = z.object({
  id: z.string().describe('Unique execution ID (the unique run_id that links a config to its results)'),
  runId: z.string().describe('Parent benchmark run ID'),
  configId: z.string().describe('Benchmark config ID'),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed']).describe('Execution status'),
  stats: benchmarkStatsSchema.nullable().describe('Aggregated statistics, populated after completion'),
  startedAt: z.coerce.date().nullable().describe('When this execution started'),
  completedAt: z.coerce.date().nullable().describe('When this execution completed'),
  error: z.string().nullable().describe('Error message if the execution failed'),
  version: z.number().int().describe('Optimistic locking version'),
  createdAt: z.coerce.date().describe('Creation timestamp'),
  updatedAt: z.coerce.date().describe('Last update timestamp'),
});

export type BenchmarkConfigExecutionResponse = z.infer<typeof benchmarkConfigExecutionResponseSchema>;

/**
 * Response shape for a benchmark run (includes embedded config executions).
 */
export const benchmarkRunResponseSchema = z.object({
  id: z.string().describe('Unique benchmark run ID'),
  suiteId: z.string().describe('Suite ID'),
  trigger: z.enum(['manual', 'scheduled']).describe('How the run was triggered'),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed']).describe('Run status'),
  startedAt: z.coerce.date().nullable().describe('When the run started'),
  completedAt: z.coerce.date().nullable().describe('When the run completed'),
  error: z.string().nullable().describe('Top-level error message if the run failed'),
  executions: z.array(benchmarkConfigExecutionResponseSchema).optional().describe('Config executions within this run (included on single-run GET)'),
  version: z.number().int().describe('Optimistic locking version'),
  createdAt: z.coerce.date().describe('Creation timestamp'),
  updatedAt: z.coerce.date().describe('Last update timestamp'),
});

export type BenchmarkRunResponse = z.infer<typeof benchmarkRunResponseSchema>;

/**
 * Paginated list response for benchmark runs.
 */
export const benchmarkRunListResponseSchema = z.object({
  items: z.array(benchmarkRunResponseSchema).describe('Benchmark runs in the current page'),
  total: z.number().int().min(0).describe('Total number of runs matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: listResponseLimitSchema,
});

export type BenchmarkRunListResponse = z.infer<typeof benchmarkRunListResponseSchema>;

/**
 * Output data from a successful LLM benchmark iteration.
 */
export const llmIterationOutputSchema = z.object({
  text: z.string().describe('Generated text'),
  charCount: z.number().int().describe('Character count of the generated text'),
  wordCount: z.number().int().describe('Word count of the generated text'),
  stopReason: z.string().nullable().describe('Reason generation stopped (e.g. stop, max_tokens); null if not reported by provider'),
  inputTokens: z.number().int().nullable().describe('Prompt tokens consumed; null if not reported by provider'),
  outputTokens: z.number().int().nullable().describe('Completion tokens generated; null if not reported by provider'),
  tokensPerSecond: z.number().nullable().describe('Output tokens per second; null if token count unavailable'),
}).openapi('LlmIterationOutput');

export type LlmIterationOutputResponse = z.infer<typeof llmIterationOutputSchema>;

/**
 * Output data from a successful TTS benchmark iteration.
 */
export const ttsIterationOutputSchema = z.object({
  byteCount: z.number().int().describe('Total audio bytes synthesised'),
  inputCharCount: z.number().int().describe('Character count of the input text'),
  bytesPerSecond: z.number().nullable().describe('Synthesis throughput in bytes per second; null if no audio produced'),
}).openapi('TtsIterationOutput');

export type TtsIterationOutputResponse = z.infer<typeof ttsIterationOutputSchema>;

/**
 * Output data from a successful ASR benchmark iteration.
 */
export const asrIterationOutputSchema = z.object({
  text: z.string().describe('Recognised transcript'),
  charCount: z.number().int().describe('Character count of the recognised transcript'),
  wordCount: z.number().int().describe('Word count of the recognised transcript'),
  partialCount: z.number().int().describe('Number of partial recognition events received'),
  finalCount: z.number().int().describe('Number of final recognition events received'),
}).openapi('AsrIterationOutput');

export type AsrIterationOutputResponse = z.infer<typeof asrIterationOutputSchema>;

/**
 * Full result data stored in a benchmark iteration result row.
 */
export const benchmarkIterationResultDataSchema = z.object({
  error: z.string().nullable().describe('Error message if the iteration failed, null otherwise'),
  timeToFirstChunkMs: z.number().int().nullable().describe('Milliseconds from start to first chunk/token; null if no chunks received'),
  chunkCount: z.number().int().describe('Total number of chunks received'),
  chunkTimings: z.array(z.number()).describe('Milliseconds between consecutive chunks (gap from chunk[i-1] to chunk[i])'),
  output: z.union([llmIterationOutputSchema, ttsIterationOutputSchema, asrIterationOutputSchema]).nullable().describe('Provider-specific output data; null on error'),
}).openapi('BenchmarkIterationResultData');

export type BenchmarkIterationResultData = z.infer<typeof benchmarkIterationResultDataSchema>;

/**
 * Response shape for a single benchmark iteration result.
 */
export const benchmarkResultResponseSchema = z.object({
  id: z.string().describe('Unique result ID'),
  configExecutionId: z.string().describe('Parent config execution ID'),
  iterationIndex: z.number().int().min(0).describe('Zero-based iteration index'),
  startedAt: z.coerce.date().describe('When this iteration started'),
  completedAt: z.coerce.date().nullable().describe('When this iteration completed'),
  result: benchmarkIterationResultDataSchema.describe('Full iteration result data'),
  createdAt: z.coerce.date().describe('Creation timestamp'),
});

export type BenchmarkResultResponse = z.infer<typeof benchmarkResultResponseSchema>;
