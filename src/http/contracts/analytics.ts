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
  ttsConnectDurationMs: latencyMetricSchema.describe('TTS WebSocket connection duration (voice only)'),
  stageTransitionDurationMs: latencyMetricSchema.describe('Stage transition duration when a go_to_stage effect fired'),
  promptRenderDurationMs: latencyMetricSchema.describe('Prompt template rendering duration'),
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
  turnStartMs: z.number().nullable().describe('Unix timestamp (ms) when the turn started processing'),
  asrStartMs: z.number().nullable().describe('Unix timestamp (ms) when ASR recognition started'),
  asrEndMs: z.number().nullable().describe('Unix timestamp (ms) when ASR recognition completed'),
  asrDurationMs: z.number().nullable().describe('ASR transcription duration'),
  moderationStartMs: z.number().nullable().describe('Unix timestamp (ms) when the moderation API call started'),
  moderationEndMs: z.number().nullable().describe('Unix timestamp (ms) when the moderation API call completed'),
  moderationDurationMs: z.number().nullable().describe('Content moderation duration'),
  fillerStartMs: z.number().nullable().describe('Unix timestamp (ms) when filler sentence generation started'),
  fillerEndMs: z.number().nullable().describe('Unix timestamp (ms) when filler sentence generation completed'),
  processingDurationMs: z.number().nullable().describe('Classification and transformation duration'),
  processingStartMs: z.number().nullable().describe('Unix timestamp (ms) when user input processing (classification + transformation) started'),
  processingEndMs: z.number().nullable().describe('Unix timestamp (ms) when user input processing completed'),
  knowledgeRetrievalDurationMs: z.number().nullable().describe('Knowledge base retrieval duration'),
  knowledgeRetrievalStartMs: z.number().nullable().describe('Unix timestamp (ms) when knowledge retrieval started'),
  knowledgeRetrievalEndMs: z.number().nullable().describe('Unix timestamp (ms) when knowledge retrieval completed'),
  actionsDurationMs: z.number().nullable().describe('Action execution duration'),
  actionsStartMs: z.number().nullable().describe('Unix timestamp (ms) when action execution started'),
  actionsEndMs: z.number().nullable().describe('Unix timestamp (ms) when action execution completed'),
  fillerDurationMs: z.number().nullable().describe('Filler sentence generation duration'),
  stageTransitionStartMs: z.number().nullable().describe('Unix timestamp (ms) when a stage transition (go_to_stage effect) started; null when no transition occurred'),
  stageTransitionEndMs: z.number().nullable().describe('Unix timestamp (ms) when the stage transition completed (stage data reloaded, providers re-wired, on_enter executed)'),
  stageTransitionDurationMs: z.number().nullable().describe('Stage transition duration (go_to_stage effect); null when no transition occurred'),
  ttsConnectStartMs: z.number().nullable().describe('Unix timestamp (ms) when the TTS WebSocket connection was initiated (voice path only)'),
  ttsConnectEndMs: z.number().nullable().describe('Unix timestamp (ms) when the TTS WebSocket connection was established and ready (voice path only)'),
  ttsConnectDurationMs: z.number().nullable().describe('TTS WebSocket connection establishment duration (voice path only)'),
  promptRenderStartMs: z.number().nullable().describe('Unix timestamp (ms) when prompt template rendering started'),
  promptRenderEndMs: z.number().nullable().describe('Unix timestamp (ms) when prompt template rendering completed'),
  promptRenderDurationMs: z.number().nullable().describe('Prompt template rendering duration'),
  llmStartMs: z.number().nullable().describe('Unix timestamp (ms) when LLM generation started'),
  llmEndMs: z.number().nullable().describe('Unix timestamp (ms) when LLM generation completed'),
  firstTokenMs: z.number().nullable().describe('Unix timestamp (ms) when the first LLM token was received'),
  firstAudioMs: z.number().nullable().describe('Unix timestamp (ms) when the first audio chunk was delivered to the client'),
  timeToFirstTokenMs: z.number().nullable().describe('LLM start to first token'),
  timeToFirstTokenFromTurnStartMs: z.number().nullable().describe('Turn start to first LLM token'),
  timeToFirstAudioMs: z.number().nullable().describe('Turn start to first audio chunk'),
  llmDurationMs: z.number().nullable().describe('Total LLM call duration'),
  ttsStartMs: z.number().nullable().describe('Unix timestamp (ms) when TTS synthesis started'),
  ttsEndMs: z.number().nullable().describe('Unix timestamp (ms) when TTS synthesis completed'),
  ttsDurationMs: z.number().nullable().describe('TTS synthesis duration'),
  turnEndMs: z.number().nullable().describe('Unix timestamp (ms) when the turn completed (after TTS on voice path, after LLM on text path)'),
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

// ==================
// Response: Token Usage Stats
// ==================

/**
 * Schema for token usage aggregated by event type.
 */
export const tokenUsageByEventTypeSchema = z.object({
  eventType: z.string().describe('Event type (message, classification, transformation, tool_call)'),
  eventCount: z.number().int().describe('Number of events with token usage data'),
  totalPromptTokens: z.number().int().describe('Total prompt (input) tokens'),
  totalCompletionTokens: z.number().int().describe('Total completion (output) tokens'),
  totalTokens: z.number().int().describe('Total tokens (prompt + completion)'),
}).openapi('TokenUsageByEventType');

/** Inferred type for token usage by event type */
export type TokenUsageByEventType = z.infer<typeof tokenUsageByEventTypeSchema>;

/**
 * Schema for the aggregated token usage response.
 * Includes both totals and per-event-type breakdowns.
 */
export const tokenUsageStatsResponseSchema = z.object({
  totalEvents: z.number().int().describe('Total number of events with token usage data'),
  totalPromptTokens: z.number().int().describe('Total prompt (input) tokens across all event types'),
  totalCompletionTokens: z.number().int().describe('Total completion (output) tokens across all event types'),
  totalTokens: z.number().int().describe('Total tokens across all event types'),
  byEventType: z.array(tokenUsageByEventTypeSchema).describe('Token usage breakdown by event type'),
}).openapi('TokenUsageStatsResponse');

/** Inferred type for the token usage stats response */
export type TokenUsageStatsResponse = z.infer<typeof tokenUsageStatsResponseSchema>;

// ==================
// Response: Token Usage Trend
// ==================

/**
 * Schema for a single data point in a token usage trend time series.
 */
export const tokenUsageTrendPointSchema = z.object({
  bucket: z.string().describe('Time bucket start (ISO 8601)'),
  eventCount: z.number().int().describe('Number of events with token usage data in this bucket'),
  totalPromptTokens: z.number().int().describe('Total prompt tokens in this bucket'),
  totalCompletionTokens: z.number().int().describe('Total completion tokens in this bucket'),
  totalTokens: z.number().int().describe('Total tokens in this bucket'),
}).openapi('TokenUsageTrendPoint');

/** Inferred type for a token usage trend data point */
export type TokenUsageTrendPoint = z.infer<typeof tokenUsageTrendPointSchema>;

/**
 * Schema for the token usage trend query, extending the base analytics query with a time bucket interval.
 */
export const tokenUsageTrendQuerySchema = analyticsQuerySchema.extend({
  interval: z.enum(['hour', 'day', 'week']).default('day').describe('Time bucket interval for the trend (hour, day, or week)'),
}).openapi('TokenUsageTrendQuery');

/** Inferred type for the token usage trend query */
export type TokenUsageTrendQuery = z.infer<typeof tokenUsageTrendQuerySchema>;

/**
 * Schema for the token usage trend response — a time series of token consumption data.
 */
export const tokenUsageTrendResponseSchema = z.object({
  interval: z.string().describe('Aggregation interval used (hour, day, or week)'),
  points: z.array(tokenUsageTrendPointSchema).describe('Time-bucketed data points'),
}).openapi('TokenUsageTrendResponse');

/** Inferred type for the token usage trend response */
export type TokenUsageTrendResponse = z.infer<typeof tokenUsageTrendResponseSchema>;
