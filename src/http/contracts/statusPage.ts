import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { providerTypeSchema } from './provider';
import { healthCheckStatusSchema } from './monitoring';

extendZodWithOpenApi(z);

/**
 * Status page contracts (specs/SPEC-status-page-v1.md) — GET /api/monitoring/status.
 *
 * Aggregates `health_checks` (60 s cadence) + `providers` into the payload the
 * Console Status page renders: current status per check/provider, status counts
 * over a window, and the overall banner status.
 */

/** Aggregated status counts for one check over the request window. Always present —
 *  a check with no rows in the window is an all-zero window with worstStatus 'unknown'. */
export const statusWindowSchema = z
  .object({
    total: z.number().int().min(0).describe('Number of health_checks rows for this check in the window'),
    ok: z.number().int().min(0).describe('Rows with status ok'),
    degraded: z.number().int().min(0).describe('Rows with status degraded'),
    down: z.number().int().min(0).describe('Rows with status down'),
    unknown: z.number().int().min(0).describe('Rows with status unknown'),
    worstStatus: healthCheckStatusSchema.describe('Worst non-unknown status among window rows (down > degraded > ok); unknown when the window has no non-unknown rows'),
  })
  .openapi('StatusWindow')
  .describe('Windowed status aggregation for one check');

/** Aggregated status counts for one UTC calendar day, across all checks and providers. */
export const statusDailySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('UTC calendar day (YYYY-MM-DD)'),
    total: z.number().int().min(0).describe('Number of health_checks rows for that day (all checks and providers)'),
    ok: z.number().int().min(0).describe('Rows with status ok'),
    degraded: z.number().int().min(0).describe('Rows with status degraded'),
    down: z.number().int().min(0).describe('Rows with status down'),
    unknown: z.number().int().min(0).describe('Rows with status unknown'),
    status: healthCheckStatusSchema.describe('Worst non-unknown status across the rows of the day (down > degraded > ok); unknown when the day has no non-unknown rows'),
    uptimePct: z.number().min(0).max(100).nullable().describe('Strict uptime: share of non-unknown rows that were ok, percent, 2 decimals (degraded and down count as non-uptime); null when the day has no non-unknown rows'),
  })
  .openapi('StatusDaily')
  .describe('Per-day aggregate (all checks and providers)');

export const statusCheckGroupSchema = z
  .enum(['core', 'service', 'other'])
  .openapi('StatusCheckGroup')
  .describe("'core' = db/process, 'service' = service_heartbeat:*, 'other' = any future check type");

export const statusCheckSchema = z
  .object({
    name: z.string().describe('Raw check name (db, process, service_heartbeat:<name>)'),
    label: z.string().describe('Display label for the Console'),
    group: statusCheckGroupSchema,
    status: healthCheckStatusSchema.describe('Latest check status; unknown when the check has never run'),
    latencyMs: z.number().int().nullable().describe('Latest check duration in ms, when measured'),
    detail: z.record(z.string(), z.unknown()).nullable().describe('Latest check detail payload (raw jsonb passthrough)'),
    checkedAt: z.coerce.date().nullable().describe('When the latest check ran; null when the check has never run'),
    window: statusWindowSchema,
  })
  .openapi('StatusCheck')
  .describe('Current state of one system/background-service check');

export const statusProviderSchema = z
  .object({
    id: z.string().describe('Provider id'),
    name: z.string().describe('Provider display name'),
    providerType: providerTypeSchema.describe('Provider category: asr, tts, llm, embeddings, storage, channel'),
    apiType: z.string().describe('API vendor (openai, azure, elevenlabs, ...)'),
    status: healthCheckStatusSchema.describe('Latest provider:<id> check status; unknown when the provider has never been checked'),
    latencyMs: z.number().int().nullable().describe('Latest probe duration in ms, when measured'),
    detail: z.record(z.string(), z.unknown()).nullable().describe('Latest probe detail payload (raw jsonb passthrough)'),
    checkedAt: z.coerce.date().nullable().describe('When the latest probe ran; null when never checked'),
    window: statusWindowSchema,
  })
  .openapi('StatusProvider')
  .describe('Current state of one configured provider');

/** GET /api/monitoring/status query parameters. */
export const statusPageQuerySchema = z.object({
  windowMinutes: z.coerce.number().int().min(5).max(1440).default(60).describe('Window for status-count aggregation in minutes (default 60)'),
  days: z.coerce.number().int().min(1).max(90).optional().describe('When set, include per-day aggregates for the last N UTC days (today + the preceding N-1 days)'),
});

export const statusPageResponseSchema = z
  .object({
    generatedAt: z.coerce.date().describe('Server time when the response was built'),
    windowMinutes: z.number().int().min(5).max(1440).describe('Applied window (defaulted)'),
    overall: healthCheckStatusSchema.describe('Global status: the worst non-unknown status across all checks and providers (down > degraded > ok). Unknown entries are ignored so a healthy system with not-yet-known checks still reports ok; unknown only when there are no entries or all are unknown'),
    checks: z.array(statusCheckSchema).describe('Core + background-service checks (never provider:* rows)'),
    providers: z.array(statusProviderSchema).describe('One entry per row in the providers table'),
    daily: z.array(statusDailySchema).optional().describe('Per-day aggregates — present only when ?days=N is provided; exactly N buckets, oldest first, today (UTC) last; days without rows are zero-filled'),
  })
  .openapi('StatusPageResponse')
  .describe('Current status page payload');

export type StatusWindow = z.infer<typeof statusWindowSchema>;
export type StatusDaily = z.infer<typeof statusDailySchema>;
export type StatusCheck = z.infer<typeof statusCheckSchema>;
export type StatusProvider = z.infer<typeof statusProviderSchema>;
export type StatusPageQuery = z.infer<typeof statusPageQuerySchema>;
export type StatusPageResponse = z.infer<typeof statusPageResponseSchema>;
