import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

// ==================
// Query Params
// ==================

/**
 * Schema for analytics query parameters shared across all analytics endpoints.
 * Supports filtering by date range, stage, and input source.
 */
export const analyticsQuerySchema = z.object({
  from: z.coerce.date().optional().describe('Start of the date range (inclusive). ISO 8601 format.'),
  to: z.coerce.date().optional().describe('End of the date range (inclusive). ISO 8601 format.'),
  stageId: z.string().optional().describe('Filter by stage ID'),
  source: z.enum(['text', 'voice']).optional().describe('Filter by input source (text or voice)'),
}).openapi('AnalyticsQuery');

/** Inferred type for analytics query params */
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

/**
 * Schema for the latency trend endpoint query, extending the base analytics query with a time bucket interval.
 */
export const latencyTrendQuerySchema = analyticsQuerySchema.extend({
  interval: z.enum(['hour', 'day', 'week']).default('day').describe('Time bucket interval for the trend (hour, day, or week)'),
}).openapi('LatencyTrendQuery');

/** Inferred type for latency trend query params */
export type LatencyTrendQuery = z.infer<typeof latencyTrendQuerySchema>;

// ==================
// Route Params
// ==================

/** Schema for analytics route params scoped to a project */
export const analyticsRouteParamsSchema = z.object({
  projectId: z.string().min(1).describe('Project ID'),
});

/** Schema for conversation timeline route params */
export const analyticsConversationRouteParamsSchema = z.object({
  projectId: z.string().min(1).describe('Project ID'),
  conversationId: z.string().min(1).describe('Conversation ID'),
});

// ==================
// Response: Latency Stats
// ==================

/**
 * Schema for a single latency metric with aggregated statistics.
 */
export const latencyMetricSchema = z.object({
  count: z.number().int().describe('Number of data points'),
  avg: z.number().nullable().describe('Average value in milliseconds'),
  median: z.number().nullable().describe('Median (p50) value in milliseconds'),
  p95: z.number().nullable().describe('95th percentile value in milliseconds'),
  min: z.number().nullable().describe('Minimum value in milliseconds'),
  max: z.number().nullable().describe('Maximum value in milliseconds'),
}).openapi('LatencyMetric');

/** Inferred type for a latency metric */
export type LatencyMetric = z.infer<typeof latencyMetricSchema>;

/**
 * Schema for the aggregated latency stats response.
 * Contains key duration metrics across all matching turns.
 */
export const latencyStatsResponseSchema = z.object({
  totalTurns: z.number().int().describe('Total number of turns matching the query'),
  totalTurnDurationMs: latencyMetricSchema.describe('Total turn duration from start to completion'),
  timeToFirstTokenMs: latencyMetricSchema.describe('Time from LLM call start to first token'),
  timeToFirstTokenFromTurnStartMs: latencyMetricSchema.describe('Time from turn start to first LLM token'),
  timeToFirstAudioMs: latencyMetricSchema.describe('Time from turn start to first audio chunk (voice only)'),
  llmDurationMs: latencyMetricSchema.describe('Total LLM call duration'),
  ttsDurationMs: latencyMetricSchema.describe('TTS synthesis duration (voice only)'),
  moderationDurationMs: latencyMetricSchema.describe('Moderation API call duration'),
  processingDurationMs: latencyMetricSchema.describe('Classification and transformation processing duration'),
  actionsDurationMs: latencyMetricSchema.describe('Action execution duration'),
  asrDurationMs: latencyMetricSchema.describe('ASR recognition duration (voice only)'),
}).openapi('LatencyStatsResponse');

/** Inferred type for the latency stats response */
export type LatencyStatsResponse = z.infer<typeof latencyStatsResponseSchema>;

// ==================
// Response: Latency Percentiles
// ==================

/**
 * Schema for a set of percentile values for a given metric.
 */
export const percentileSetSchema = z.object({
  p50: z.number().nullable().describe('50th percentile (median) in milliseconds'),
  p75: z.number().nullable().describe('75th percentile in milliseconds'),
  p90: z.number().nullable().describe('90th percentile in milliseconds'),
  p95: z.number().nullable().describe('95th percentile in milliseconds'),
  p99: z.number().nullable().describe('99th percentile in milliseconds'),
}).openapi('PercentileSet');

/** Inferred type for a percentile set */
export type PercentileSet = z.infer<typeof percentileSetSchema>;

/**
 * Schema for the latency percentiles response.
 * Contains percentile distributions (p50–p99) for key duration metrics.
 */
export const latencyPercentilesResponseSchema = z.object({
  totalTurns: z.number().int().describe('Total number of turns matching the query'),
  totalTurnDurationMs: percentileSetSchema.describe('Total turn duration percentiles'),
  timeToFirstTokenMs: percentileSetSchema.describe('Time to first token percentiles'),
  timeToFirstTokenFromTurnStartMs: percentileSetSchema.describe('Time to first token from turn start percentiles'),
  timeToFirstAudioMs: percentileSetSchema.describe('Time to first audio percentiles (voice only)'),
  llmDurationMs: percentileSetSchema.describe('LLM duration percentiles'),
}).openapi('LatencyPercentilesResponse');

/** Inferred type for the latency percentiles response */
export type LatencyPercentilesResponse = z.infer<typeof latencyPercentilesResponseSchema>;

// ==================
// Response: Latency Trend
// ==================

/**
 * Schema for a single data point in a latency trend time series.
 */
export const latencyTrendPointSchema = z.object({
  bucket: z.string().describe('Time bucket start (ISO 8601)'),
  turnCount: z.number().int().describe('Number of turns in this bucket'),
  avgTotalTurnDurationMs: z.number().nullable().describe('Average total turn duration in this bucket'),
  avgTimeToFirstTokenMs: z.number().nullable().describe('Average TTFT in this bucket'),
  avgLlmDurationMs: z.number().nullable().describe('Average LLM duration in this bucket'),
  avgTimeToFirstAudioMs: z.number().nullable().describe('Average time to first audio in this bucket'),
}).openapi('LatencyTrendPoint');

/** Inferred type for a latency trend point */
export type LatencyTrendPoint = z.infer<typeof latencyTrendPointSchema>;

/**
 * Schema for the latency trend response — a time series of aggregated latency data.
 */
export const latencyTrendResponseSchema = z.object({
  interval: z.string().describe('Aggregation interval used (hour, day, or week)'),
  points: z.array(latencyTrendPointSchema).describe('Time-bucketed data points'),
}).openapi('LatencyTrendResponse');

/** Inferred type for the latency trend response */
export type LatencyTrendResponse = z.infer<typeof latencyTrendResponseSchema>;

// ==================
// Response: Conversation Timeline
// ==================

/**
 * Schema for a single turn in a conversation timeline.
 * Combines user-side and assistant-side timing into a single row per turn.
 */
export const conversationTimelineTurnSchema = z.object({
  turnIndex: z.number().int().describe('1-based sequential turn number'),
  timestamp: z.string().describe('Timestamp of the user message event (ISO 8601)'),
  source: z.string().nullable().describe('Input source: text or voice'),
  asrDurationMs: z.number().nullable().describe('ASR transcription duration'),
  moderationDurationMs: z.number().nullable().describe('Content moderation duration'),
  processingDurationMs: z.number().nullable().describe('Classification and transformation duration'),
  knowledgeRetrievalDurationMs: z.number().nullable().describe('Knowledge base retrieval duration'),
  actionsDurationMs: z.number().nullable().describe('Action execution duration'),
  fillerDurationMs: z.number().nullable().describe('Filler sentence generation duration'),
  timeToFirstTokenMs: z.number().nullable().describe('LLM start to first token'),
  timeToFirstTokenFromTurnStartMs: z.number().nullable().describe('Turn start to first LLM token'),
  timeToFirstAudioMs: z.number().nullable().describe('Turn start to first audio chunk'),
  llmDurationMs: z.number().nullable().describe('Total LLM call duration'),
  ttsDurationMs: z.number().nullable().describe('TTS synthesis duration'),
  totalTurnDurationMs: z.number().nullable().describe('Total turn duration from start to completion'),
}).openapi('ConversationTimelineTurn');

/** Inferred type for a conversation timeline turn */
export type ConversationTimelineTurn = z.infer<typeof conversationTimelineTurnSchema>;

/**
 * Schema for the conversation timeline response — an ordered list of turns with timing data.
 */
export const conversationTimelineResponseSchema = z.object({
  conversationId: z.string().describe('Conversation ID'),
  turns: z.array(conversationTimelineTurnSchema).describe('Ordered list of turns with timing breakdowns'),
}).openapi('ConversationTimelineResponse');

/** Inferred type for the conversation timeline response */
export type ConversationTimelineResponse = z.infer<typeof conversationTimelineResponseSchema>;
