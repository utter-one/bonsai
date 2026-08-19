import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listResponseLimitSchema } from './common';
import { RULE_IDS } from '../../services/monitoring/AlertEvents';

extendZodWithOpenApi(z);

/**
 * Monitoring configuration stored in the `monitoring_config` singleton row
 * (P1-06). Phase 1 notifier union is `webhook | email`; P4-02 extends the
 * enum with `telegram`/`sms` and their fields. `rules` keys are validated
 * against the registered rule ids (`RULE_IDS`, P2-01) via `superRefine` —
 * an unknown id is a config error, not a silent no-op (finding 19).
 *
 * Shared by `MonitoringConfigService` (validation on load/save) and the
 * P2-03 `PUT /api/monitoring/config` endpoint (request body).
 */

export const notifierConfigSchema = z
  .object({
    id: z.string().min(1).describe('Notifier id (synthesized on first boot for env-derived notifiers)'),
    type: z.enum(['webhook', 'email']).describe('Notifier type (Phase 1: webhook, email)'),
    channelProviderId: z
      .string()
      .min(1)
      .optional()
      .describe('Email channel provider id (required for email notifiers)'),
    url: z
      .string()
      .url()
      .optional()
      .describe('Webhook delivery URL, http(s) (required for webhook notifiers)'),
    to: z
      .string()
      .email()
      .optional()
      .describe('Recipient email address (required for email notifiers)'),
    minSeverity: z
      .enum(['info', 'warning', 'critical'])
      .optional()
      .describe('Only deliver alerts at or above this severity (default: all)'),
    enabled: z.boolean().describe('Disabled notifiers are skipped by the publisher'),
  })
  .refine((n) => n.type !== 'webhook' || (n.url ?? '').startsWith('http'), {
    message: 'Webhook notifiers require an http(s) url',
  })
  .refine((n) => n.type !== 'email' || Boolean(n.channelProviderId && n.to), {
    message: 'Email notifiers require channelProviderId and to',
  })
  .openapi('NotifierConfig');

export const ruleOverrideSchema = z
  .object({
    enabled: z.boolean().optional().describe('Disable the rule without deleting its override'),
    threshold: z.number().optional().describe('Rule threshold (rate, count, or ms — per-rule semantics)'),
    windowMinutes: z.number().positive().optional().describe('Evaluation window in minutes'),
    minSamples: z.number().int().positive().optional().describe('Minimum samples before the rule may fire'),
    forMinutes: z.number().min(0).optional().describe('Sustainment in minutes before firing'),
    resolveAfterGoodChecks: z.number().int().min(0).optional().describe('Consecutive good evaluations to auto-resolve'),
    cooldownMinutes: z.number().min(0).optional().describe('Minimum gap between re-fires of the same key'),
    maxUnresolvedHours: z.number().positive().optional().describe('Auto-resolve safety valve in hours'),
    severity: z.enum(['info', 'warning', 'critical']).optional().describe('Override the rule default severity'),
  })
  .openapi('RuleOverride');

export const probeSettingsSchema = z
  .object({
    llmProbe: z
      .enum(['models', 'one_token', 'off'])
      .default('models')
      .describe("LLM health probe mode: 'models' = enumerateModels() (free), 'one_token' = 1-token generation (costs money), 'off' = call-log inference only"),
    cooldownMinutes: z
      .number()
      .min(0)
      .default(10)
      .describe('Minimum minutes between probes of the same provider'),
  })
  .openapi('ProbeSettings');

export const alertingSettingsSchema = z
  .object({
    engineIntervalMinutes: z.number().min(1).default(1).describe('Alert rule engine interval in minutes (P2-01)'),
    defaultCooldownMinutes: z.number().min(0).default(15).describe('Default per-key re-fire cooldown in minutes (P2-01)'),
  })
  .openapi('AlertingSettings');

export const monitoringConfigSchema = z.object({
  notifiers: z
    .array(notifierConfigSchema)
    .default([])
    .describe('Alert delivery targets (webhook, email in Phase 1)'),
  rules: z
    .record(z.string().min(1), ruleOverrideSchema)
    .default({})
    .describe('Per-rule overrides keyed by rule id (P2-01 defines the ids)'),
  retentionDays: z
    .number()
    .int()
    .min(7)
    .default(90)
    .describe('Retention in days for provider_call_logs, health_checks, metric_samples (stats_hourly: 2x)'),
  // Factory-function defaults: a plain `.default({})` would insert a literal
  // empty object and skip the nested field defaults.
  probeSettings: probeSettingsSchema
    .default(() => probeSettingsSchema.parse({}))
    .describe('Provider health probe policy (P1-05 consumes this)'),
  alerting: alertingSettingsSchema
    .default(() => alertingSettingsSchema.parse({}))
    .describe('Alert engine settings (P2-01 consumes this)'),
})
.superRefine((config, ctx) => {
  // Unknown rule ids are a config error, not a silent no-op (P2-01 finding 19).
  for (const ruleId of Object.keys(config.rules ?? {})) {
    if (!RULE_IDS.has(ruleId)) {
      ctx.addIssue({ code: 'custom', path: ['rules', ruleId], message: `Unknown alert rule id '${ruleId}'` });
    }
  }
});

export type MonitoringConfig = z.infer<typeof monitoringConfigSchema>;
export type NotifierConfig = z.infer<typeof notifierConfigSchema>;
export type RuleOverride = z.infer<typeof ruleOverrideSchema>;
export type ProbeSettings = z.infer<typeof probeSettingsSchema>;
export type AlertingSettings = z.infer<typeof alertingSettingsSchema>;

// ==================
// P1-08 — read-only monitoring endpoints
// ==================

/** One health check result (in-memory snapshot or persisted row). */
export const healthCheckItemSchema = z
  .object({
    name: z.string().describe('Check name (db, process, service_heartbeat:<name>, provider:<id>)'),
    status: z.enum(['ok', 'degraded', 'down', 'unknown']).describe('Check status'),
    latencyMs: z.number().int().nullable().optional().describe('Check duration in milliseconds, when measured (absent for unmeasured checks)'),
    detail: z.record(z.string(), z.unknown()).nullable().optional().describe('Check-specific detail payload (absent when none)'),
  })
  .openapi('HealthCheckItem')
  .describe('One health check result');

/** GET /api/monitoring/health — current in-memory snapshot. */
export const healthSnapshotResponseSchema = z.object({
  checkedAt: z.coerce.date().nullable().describe('When the last check cycle ran (null before the first cycle)'),
  checks: z.array(healthCheckItemSchema).describe('All checks from the last completed cycle'),
});

export type HealthCheckItem = z.infer<typeof healthCheckItemSchema>;
export type HealthSnapshotResponse = z.infer<typeof healthSnapshotResponseSchema>;

/** One persisted health_checks row. */
export const healthCheckResponseSchema = z.object({
  id: z.string().describe('Row id'),
  checkName: z.string().describe('Check name'),
  status: z.string().describe('Check status (ok | degraded | down | unknown)'),
  latencyMs: z.number().int().nullable().describe('Check duration in milliseconds'),
  detail: z.record(z.string(), z.unknown()).nullable().describe('Check-specific detail payload'),
  createdAt: z.coerce.date().describe('When the check ran'),
});

/** Paginated list of health_checks (newest first). Filters: check/checkName, status, latencyMs, createdAt. */
export const healthHistoryListResponseSchema = z.object({
  items: z.array(healthCheckResponseSchema).describe('Health check rows in the current page'),
  total: z.number().int().min(0).describe('Total matching rows'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: listResponseLimitSchema,
});

export type HealthCheckResponse = z.infer<typeof healthCheckResponseSchema>;
export type HealthHistoryListResponse = z.infer<typeof healthHistoryListResponseSchema>;

/** Rolling 15-minute call-log window for one provider. */
export const providerRollingSchema = z
  .object({
    windowMinutes: z.number().int().describe('Rolling window length in minutes (15)'),
    calls: z.number().int().min(0).describe('Provider calls in the window (0 when none)'),
    okRate: z.number().min(0).max(1).nullable().describe('Success ratio in the window (null when no calls)'),
    p95DurationMs: z.number().nullable().describe('95th percentile call duration in the window'),
    topErrorCodes: z
      .array(z.tuple([z.string(), z.number().int().min(0)]))
      .describe('Top failing error codes in the window as [code, count] pairs, count desc (max 3)'),
  })
  .openapi('ProviderRolling')
  .describe('Rolling provider call-log window');

/** One provider row of GET /api/monitoring/providers. */
export const providerOverviewSchema = z.object({
  id: z.string().describe('Provider id'),
  name: z.string().describe('Provider name'),
  providerType: z.string().describe('Provider type (llm, asr, tts, embeddings, storage)'),
  apiType: z.string().describe('API type (openai, anthropic, elevenlabs, s3, ...)'),
  probeStatus: z
    .enum(['ok', 'degraded', 'down', 'unknown'])
    .nullable()
    .describe('Latest health-check status for this provider (provider:<id> check); null when not checked yet'),
  rolling: providerRollingSchema.describe('Rolling 15-minute call-log window'),
});

/** GET /api/monitoring/providers — per-provider health + rolling window. */
export const providersMonitoringResponseSchema = z.object({
  providers: z.array(providerOverviewSchema).describe('All providers with their rolling stats'),
});

export type ProviderOverview = z.infer<typeof providerOverviewSchema>;
export type ProvidersMonitoringResponse = z.infer<typeof providersMonitoringResponseSchema>;

/** One provider_call_logs row (variant fields in `metrics` jsonb). */
export const providerCallResponseSchema = z.object({
  id: z.string().describe('Row id'),
  providerId: z.string().describe('Provider id'),
  providerType: z.string().describe('Provider type'),
  apiType: z.string().describe('API type'),
  operation: z.string().describe('Operation (llm.generate, channel.send_message, ...)'),
  model: z.string().nullable().describe('Model, when the operation has one'),
  projectId: z.string().nullable().describe('Owning project, when known'),
  conversationId: z.string().nullable().describe('Owning conversation, when known'),
  ok: z.boolean().describe('Whether the call succeeded'),
  errorCode: z.string().nullable().describe('Error class (null on success): auth | rate_limited | timeout | server_error | client_error | network | unknown'),
  statusHttp: z.number().int().nullable().describe('HTTP status when the error carried one'),
  durationMs: z.number().int().describe('Call duration in milliseconds'),
  errorText: z.string().nullable().describe('Truncated error message (1KB)'),
  fallbackProviderId: z.string().nullable().describe('Set when the call ran on a fallback provider'),
  metrics: z.record(z.string(), z.unknown()).nullable().describe('Variant phase fields (TTFT, tokens, chunk gaps, ...)'),
  createdAt: z.coerce.date().describe('When the call happened'),
});

/**
 * Paginated list of provider_call_logs.
 * Filters: providerId, providerType, apiType, operation, model, projectId, conversationId,
 * ok, errorCode, statusHttp, durationMs, fallbackProviderId, createdAt (operators supported, e.g. filters[createdAt][op]=between&filters[createdAt][value][0]=from&filters[createdAt][value][1]=to).
 */
export const providerCallListResponseSchema = z.object({
  items: z.array(providerCallResponseSchema).describe('Call log rows in the current page'),
  total: z.number().int().min(0).describe('Total matching rows'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: listResponseLimitSchema,
});

export type ProviderCallResponse = z.infer<typeof providerCallResponseSchema>;
export type ProviderCallListResponse = z.infer<typeof providerCallListResponseSchema>;

/** GET /api/monitoring/provider-stats query. Window bounded to 14 days (400 beyond). */
export const providerStatsQuerySchema = z.object({
  from: z.coerce.date().describe('Window start (inclusive). ISO 8601.'),
  to: z.coerce.date().describe('Window end (exclusive). ISO 8601.'),
  groupBy: z.enum(['hour', 'day']).default('hour').describe('Bucket granularity (default hour)'),
  providerId: z.string().optional().describe('Restrict to one provider'),
  operation: z.string().optional().describe('Restrict to one operation'),
});

/** One (bucket, providerId, operation) aggregate row. */
export const providerStatsBucketSchema = z
  .object({
    bucket: z.coerce.date().describe('Bucket start (top of the hour / top of the day, UTC)'),
    providerId: z.string().describe('Provider id'),
    operation: z.string().describe('Operation'),
    count: z.number().int().min(0).describe('Call count in the bucket'),
    sumDurationMs: z.number().int().min(0).describe('Total call duration in the bucket'),
    minDurationMs: z.number().int().describe('Shortest call duration'),
    maxDurationMs: z.number().int().describe('Longest call duration'),
    p50TtftMs: z.number().nullable().describe('Median time-to-first-token (LLM rows only, null when none)'),
    p95TtftMs: z.number().nullable().describe('95th percentile time-to-first-token'),
    p99TtftMs: z.number().nullable().describe('99th percentile time-to-first-token'),
    p95MaxChunkGapMs: z.number().nullable().describe('95th percentile max streaming chunk gap'),
    stalledCount: z.number().int().min(0).describe('Calls with a chunk gap over 10s'),
    rtfOver1Count: z.number().int().min(0).describe('TTS calls slower than real time'),
  })
  .openapi('ProviderStatsBucket')
  .describe('One provider-stats aggregate row');

/** GET /api/monitoring/provider-stats response. */
export const providerStatsResponseSchema = z.object({
  from: z.coerce.date().describe('Window start (inclusive)'),
  to: z.coerce.date().describe('Window end (exclusive)'),
  groupBy: z.enum(['hour', 'day']).describe('Bucket granularity used'),
  buckets: z.array(providerStatsBucketSchema).describe('Aggregate rows, oldest bucket first'),
});

export type ProviderStatsQuery = z.infer<typeof providerStatsQuerySchema>;
export type ProviderStatsBucket = z.infer<typeof providerStatsBucketSchema>;
export type ProviderStatsResponse = z.infer<typeof providerStatsResponseSchema>;

/** GET /api/monitoring/metrics query — generic time series over metric_samples. */
export const metricSeriesQuerySchema = z.object({
  name: z.string().min(1).describe('Metric name (must be a registered metric)'),
  labels: z.record(z.string(), z.string()).optional().describe('Exact label-set match (e.g. labels[provider_id]=prov_1&labels[ok]=true)'),
  from: z.coerce.date().describe('Window start (inclusive). ISO 8601.'),
  to: z.coerce.date().describe('Window end (exclusive). ISO 8601.'),
  step: z.enum(['1m', '15m', '1h']).default('15m').describe('Bucket granularity (default 15m)'),
});

/** One point of one metric series. */
export const metricSeriesPointSchema = z
  .object({
    bucket: z.coerce.date().describe('Bucket start'),
    count: z.number().int().min(0).describe('Summed sample counts in the bucket (counters: delta, gauges: 1 per sample, histograms: delta)'),
    sum: z.number().nullable().describe('Summed sample sums in the bucket'),
    min: z.number().nullable().describe('Minimum sample min in the bucket'),
    max: z.number().nullable().describe('Maximum sample max in the bucket'),
  })
  .openapi('MetricSeriesPoint')
  .describe('One metric time-series point');

/** One series = one label set. */
export const metricSeriesSchema = z.object({
  labels: z.record(z.string(), z.string()).describe('The label set of this series'),
  points: z.array(metricSeriesPointSchema).describe('Points, oldest bucket first'),
});

/** GET /api/monitoring/metrics response. */
export const metricSeriesResponseSchema = z.object({
  name: z.string().describe('Metric name'),
  from: z.coerce.date().describe('Window start (inclusive)'),
  to: z.coerce.date().describe('Window end (exclusive)'),
  step: z.enum(['1m', '15m', '1h']).describe('Bucket granularity used'),
  series: z.array(metricSeriesSchema).describe('One series per matching label set'),
});

export type MetricSeriesQuery = z.infer<typeof metricSeriesQuerySchema>;
export type MetricSeriesPoint = z.infer<typeof metricSeriesPointSchema>;
export type MetricSeries = z.infer<typeof metricSeriesSchema>;
export type MetricSeriesResponse = z.infer<typeof metricSeriesResponseSchema>;
