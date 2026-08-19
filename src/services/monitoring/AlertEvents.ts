import { z } from 'zod';
import type { MetricsSnapshot } from './MetricsRegistry';
import type { HealthCheckResult } from './HealthCheckService';
import type { RateLimitRejectionKeyStats } from '../../http/middleware/rateLimiter';

/**
 * Alert rule engine data model + default rule registry (P2-01).
 *
 * Evaluators live in code; parameters live in `monitoring_config.rules[id]`
 * (P1-06 contract). The engine (AlertRuleEngine) assembles `EvaluationData`
 * once per pass and runs every enabled rule through the anti-flap state
 * machine. `AlertEventPublisher` is the persistence/notification seam —
 * P2-01 ships `LogAndPersistPublisher`, P2-02 wraps it with dispatch.
 */

export type RuleSeverity = 'info' | 'warning' | 'critical';

export type HealthSnapshot = {
  checkedAt: Date | null;
  checks: HealthCheckResult[];
};

/**
 * Per-provider rolling-window stats aggregated from `provider_call_logs`
 * (one SQL per distinct rule window per engine pass). Variant phase fields
 * are extracted from the `metrics` jsonb in SQL; denominators per finding 16.
 */
export type ProviderWindowStats = {
  providerId: string;
  calls: number;
  errors: number;
  errorRate: number; // errors / calls (0 when calls === 0)
  p95DurationMs: number;
  errorCounts: Record<string, number>;
  ttftRows: number; // rows with a ttftMs value
  ttftP50Ms: number | null;
  ttftP95Ms: number | null;
  ttftP99Ms: number | null;
  gapRows: number; // rows with a maxChunkGapMs value
  stalledRows: number; // maxChunkGapMs > 10000
  audioRows: number; // rows with an audioDurationMs value
  rtfOverRows: number; // duration_ms > audioDurationMs
  eosRows: number; // rows with an eosToFinalMs value
  eosP95Ms: number | null;
  midStreamRows: number; // errorPhase === 'mid_stream'
};

/**
 * Data assembled once per engine pass. In-memory sources (metrics snapshot,
 * `windowSum` delta ring, health snapshot, probe failures, rejection top-N)
 * keep working when the DB is down; DB-backed sources (callLogs,
 * fallbackEventCounts, providerNames) are empty when their query fails, so
 * dependent rules evaluate to not-met (findings 1/11/19).
 */
export type EvaluationData = {
  now: number;
  metrics: MetricsSnapshot;
  /**
   * Windowed counter sum over the engine's delta ring: sums per-pass deltas
   * with `ts >= now - windowMs` for series whose labels match `labels`'
   * keys exactly (series may carry extra labels). Counters only.
   */
  windowSum: (name: string, labels: Record<string, string>, windowMs: number) => number;
  health: HealthSnapshot;
  /** Previous engine pass's `db` check status (null before the first pass) — finding 4. */
  previousDbCheckStatus: string | null;
  /** Provider names/types for messages + per-type thresholds — finding 7. */
  providerNames: Map<string, { name: string; providerType: string }>;
  /** windowMs → providerId → stats (one aggregate query per distinct window). */
  callLogs: Map<number, Map<string, ProviderWindowStats>>;
  /** P3-01 seam — providerId → 'open'; empty map in Phase 2. */
  breakers: Map<string, 'open'>;
  probeFailures: Map<string, number>;
  fallbackEventCounts: Map<string, number>;
  /** Cumulative per-process top-N rejecting keys — finding 3. */
  rejections: { topKeys: RateLimitRejectionKeyStats[] };
};

export type RuleVerdict = {
  met: boolean;
  /** Human-readable message when met (provider name / threshold / actual value). */
  message?: string;
  /** Structured context persisted on the alert row (metric values, window). */
  context?: Record<string, unknown>;
  /** Global rules only: override the alert scope part (e.g. `key:<hash>`, `heartbeat:<name>`). */
  scopePart?: string;
  scopeDetails?: Record<string, unknown>;
};

/** Effective params after merging `defaultParams` with the config override. */
export type RuleParams = {
  threshold: number;
  windowMinutes: number;
  minSamples: number;
  forMinutes: number;
  resolveAfterGoodChecks: number;
  cooldownMinutes: number;
  maxUnresolvedHours: number;
};

export const ruleParamsSchema = z.object({
  threshold: z.number().describe('Rule threshold — per-rule semantics (count, ratio, ms, or bytes; see each rule definition)'),
  windowMinutes: z.number().min(0).describe('Evaluation window in minutes (0 = no window / gauge-like condition)'),
  minSamples: z.number().min(0).describe('Minimum samples before the rule may fire (0 = no minimum)'),
  forMinutes: z.number().min(0).describe('Sustainment in minutes before firing (0 = fire on the first met evaluation)'),
  resolveAfterGoodChecks: z.number().min(0).describe('Consecutive not-met evaluations before auto-resolve'),
  cooldownMinutes: z.number().min(0).describe('Minimum gap between re-fires of the same key'),
  maxUnresolvedHours: z.number().min(0).describe('Auto-resolve safety valve in hours (applies even while the condition stays met)'),
});

export type AlertRuleDef = {
  id: string;
  scope: 'global' | 'per_provider';
  severity: RuleSeverity;
  defaultParams: RuleParams;
  /**
   * Returns one verdict per scope part it considers (per-provider rules: the
   * current provider; global rules: `global` and/or explicit scopeParts).
   * Tracked scope parts that receive no verdict are synthesized not-met by
   * the engine so their alerts can resolve (finding 11).
   */
  evaluate: (data: EvaluationData, params: RuleParams, providerId?: string) => RuleVerdict[];
};

// ---------------------------------------------------------------------------
// Evaluator helpers
// ---------------------------------------------------------------------------

const notMet = (): RuleVerdict => ({ met: false });

const met = (
  message: string,
  context?: Record<string, unknown>,
  extra?: { scopePart?: string; scopeDetails?: Record<string, unknown> },
): RuleVerdict => ({ met: true, message, context, ...extra });

const pct = (ratio: number): string => `${(ratio * 100).toFixed(1)}%`;
const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

/** Per-type p95 duration thresholds for `provider-degraded` (PROPOSAL §3.3). */
const DURATION_THRESHOLDS_MS: Record<string, number> = {
  llm: 20_000,
  asr: 2_000,
  tts: 5_000,
  channel: 10_000,
};

const providerLabel = (data: EvaluationData, providerId: string): string => {
  const info = data.providerNames.get(providerId);
  return info ? `${info.name} (${providerId})` : providerId;
};

const providerTypeOf = (data: EvaluationData, providerId: string): string | undefined =>
  data.providerNames.get(providerId)?.providerType;

const windowStats = (data: EvaluationData, params: RuleParams, providerId: string): ProviderWindowStats | undefined =>
  data.callLogs.get(params.windowMinutes * 60_000)?.get(providerId);

const topErrorCode = (stats: ProviderWindowStats): string | null => {
  let top: string | null = null;
  let topCount = 0;
  for (const [code, count] of Object.entries(stats.errorCounts)) {
    if (count > topCount) {
      top = code;
      topCount = count;
    }
  }
  return top;
};

/** Shared by `api-429-spike` and `auth-429-spike` (per-key scoping, finding 2/3). */
const rateLimitSpike = (
  data: EvaluationData,
  params: RuleParams,
  scope: 'api' | 'auth',
  what: string,
  noDominantMessage: string,
): RuleVerdict[] => {
  const windowMs = params.windowMinutes * 60_000;
  const count = data.windowSum('rate_limit_rejections_total', { scope }, windowMs);
  if (count < params.threshold) return [notMet()];
  const keys = data.rejections.topKeys.filter((k) => k.scope === scope);
  const trackedTotal = keys.reduce((sum, k) => sum + k.count, 0);
  const dominant = trackedTotal > 0 ? keys.find((k) => k.count / trackedTotal > 0.5) : undefined;
  if (dominant) {
    return [
      met(
        `${what} rejections in the last ${params.windowMinutes} min: ${count} — key ${dominant.keyHash} (${dominant.keyType}) accounts for ${pct(dominant.count / trackedTotal)} of tracked rejections`,
        { count, windowMinutes: params.windowMinutes, keyHash: dominant.keyHash, keyType: dominant.keyType },
        {
          scopePart: `key:${dominant.keyHash}`,
          scopeDetails: { keyHash: dominant.keyHash, keyType: dominant.keyType, scope },
        },
      ),
    ];
  }
  return [met(`${what} rejections in the last ${params.windowMinutes} min: ${count} — ${noDominantMessage}`, { count, windowMinutes: params.windowMinutes })];
};

// ---------------------------------------------------------------------------
// Default rules — 15 general + 5 streaming (PROPOSAL §3.3).
// `provider-chain-exhausted` joins the registry in Phase 3 with its counter.
// ---------------------------------------------------------------------------

const MB = 1024 * 1024;

export const DEFAULT_RULES: AlertRuleDef[] = [
  {
    id: 'db-down',
    scope: 'global',
    severity: 'critical',
    // forMinutes 1: the condition already requires 2 consecutive down cycles (finding 4).
    defaultParams: { threshold: 0, windowMinutes: 0, minSamples: 0, forMinutes: 1, resolveAfterGoodChecks: 2, cooldownMinutes: 15, maxUnresolvedHours: 6 },
    evaluate: (data) => {
      const db = data.health.checks.find((c) => c.name === 'db');
      if (db?.status === 'down' && data.previousDbCheckStatus === 'down') {
        return [met(`Database check has been down for 2 consecutive cycles — queries will fail until it recovers`, { dbStatus: db.status, dbError: db.detail?.error ?? null })];
      }
      return [notMet()];
    },
  },
  {
    id: 'service-stalled',
    scope: 'global',
    severity: 'warning',
    defaultParams: { threshold: 0, windowMinutes: 0, minSamples: 0, forMinutes: 2, resolveAfterGoodChecks: 2, cooldownMinutes: 15, maxUnresolvedHours: 6 },
    evaluate: (data) => {
      const stalled = data.health.checks.filter((c) => c.name.startsWith('service_heartbeat:') && c.status === 'down');
      // `unknown` (never ticked) never fires — a service with no work yet is not stalled.
      return stalled.map((check) => {
        const service = check.name.slice('service_heartbeat:'.length);
        return met(
          `Service heartbeat '${service}' is down (no tick within 3× its interval — the service loop may be stalled or crashed)`,
          { service },
          { scopePart: `heartbeat:${service}`, scopeDetails: { service } },
        );
      });
    },
  },
  {
    id: 'db-pool-saturated',
    scope: 'global',
    severity: 'warning',
    // forMinutes 5: the "for 5 min" semantics come from sustainment (finding 15).
    defaultParams: { threshold: 0.2, windowMinutes: 0, minSamples: 0, forMinutes: 5, resolveAfterGoodChecks: 2, cooldownMinutes: 15, maxUnresolvedHours: 6 },
    evaluate: (data, params) => {
      const db = data.health.checks.find((c) => c.name === 'db');
      const poolTotal = Number(db?.detail?.poolTotal ?? 0);
      const poolWaiting = Number(db?.detail?.poolWaiting ?? 0);
      if (poolTotal <= 0) return [notMet()];
      const ratio = poolWaiting / poolTotal;
      if (ratio > params.threshold) {
        return [met(`DB pool waiting ${poolWaiting}/${poolTotal} (${pct(ratio)}) exceeds ${pct(params.threshold)} — sustained for ${params.forMinutes} min`, { poolTotal, poolWaiting, ratio })];
      }
      return [notMet()];
    },
  },
  {
    id: 'provider-down',
    scope: 'per_provider',
    severity: 'critical',
    // threshold = consecutive probe failures (N=3); minSamples = calls for the 100%-error branch.
    defaultParams: { threshold: 3, windowMinutes: 10, minSamples: 5, forMinutes: 2, resolveAfterGoodChecks: 2, cooldownMinutes: 15, maxUnresolvedHours: 6 },
    evaluate: (data, params, providerId) => {
      if (!providerId) return [notMet()];
      const label = providerLabel(data, providerId);
      const stats = windowStats(data, params, providerId);
      if (stats && stats.calls >= params.minSamples && stats.errors === stats.calls) {
        return [
          met(
            `${label}: 100% of ${stats.calls} calls failed in the last ${params.windowMinutes} min (top error: ${topErrorCode(stats) ?? 'n/a'}) — provider appears down`,
            { providerId, calls: stats.calls, errors: stats.errors, errorCounts: stats.errorCounts },
          ),
        ];
      }
      if (data.breakers.has(providerId)) {
        return [met(`${label}: circuit breaker is OPEN — the provider is not receiving calls`, { providerId })];
      }
      const probes = data.probeFailures.get(providerId) ?? 0;
      if (probes >= params.threshold) {
        return [met(`${label}: ${probes} consecutive health-probe failures — provider appears down`, { providerId, probeFailures: probes })];
      }
      return [notMet()];
    },
  },
  {
    id: 'provider-degraded',
    scope: 'per_provider',
    severity: 'warning',
    // threshold = error rate; minSamples applies to BOTH branches (finding 7).
    defaultParams: { threshold: 0.3, windowMinutes: 10, minSamples: 10, forMinutes: 2, resolveAfterGoodChecks: 2, cooldownMinutes: 15, maxUnresolvedHours: 6 },
    evaluate: (data, params, providerId) => {
      if (!providerId) return [notMet()];
      const stats = windowStats(data, params, providerId);
      if (!stats || stats.calls < params.minSamples) return [notMet()];
      const label = providerLabel(data, providerId);
      if (stats.errorRate > params.threshold) {
        return [
          met(
            `${label}: error rate ${pct(stats.errorRate)} (${stats.errors}/${stats.calls}) exceeds ${pct(params.threshold)} in the last ${params.windowMinutes} min`,
            { providerId, calls: stats.calls, errors: stats.errors, errorRate: stats.errorRate, errorCounts: stats.errorCounts },
          ),
        ];
      }
      const providerType = providerTypeOf(data, providerId);
      const typeThreshold = providerType ? DURATION_THRESHOLDS_MS[providerType] : undefined;
      if (typeThreshold !== undefined && stats.p95DurationMs > typeThreshold) {
        return [
          met(
            `${label}: p95 duration ${secs(stats.p95DurationMs)} exceeds the ${providerType} threshold ${secs(typeThreshold)} in the last ${params.windowMinutes} min`,
            { providerId, p95DurationMs: stats.p95DurationMs, providerType, typeThresholdMs: typeThreshold },
          ),
        ];
      }
      return [notMet()];
    },
  },
  {
    id: 'provider-rate-limited',
    scope: 'per_provider',
    severity: 'warning',
    // threshold = rate_limited error count (upstream quota — distinct from an outage).
    defaultParams: { threshold: 5, windowMinutes: 10, minSamples: 0, forMinutes: 2, resolveAfterGoodChecks: 2, cooldownMinutes: 15, maxUnresolvedHours: 6 },
    evaluate: (data, params, providerId) => {
      if (!providerId) return [notMet()];
      const stats = windowStats(data, params, providerId);
      const count = stats?.errorCounts.rate_limited ?? 0;
      if (count >= params.threshold) {
        return [
          met(
            `${providerLabel(data, providerId)}: ${count} rate_limited (429/quota) errors in the last ${params.windowMinutes} min — upstream quota problem, distinct from an outage`,
            { providerId, rateLimitedErrors: count },
          ),
        ];
      }
      return [notMet()];
    },
  },
  {
    id: 'provider-auth-failed',
    scope: 'per_provider',
    severity: 'critical',
    // forMinutes 0: an auth failure does not self-heal — delay buys nothing.
    defaultParams: { threshold: 1, windowMinutes: 5, minSamples: 0, forMinutes: 0, resolveAfterGoodChecks: 2, cooldownMinutes: 15, maxUnresolvedHours: 6 },
    evaluate: (data, params, providerId) => {
      if (!providerId) return [notMet()];
      const stats = windowStats(data, params, providerId);
      const count = stats?.errorCounts.auth ?? 0;
      if (count >= params.threshold) {
        return [
          met(
            `${providerLabel(data, providerId)}: ${count} auth error(s) in the last ${params.windowMinutes} min — misconfigured or expired credentials (this will not self-heal; check the provider config)`,
            { providerId, authErrors: count },
          ),
        ];
      }
      return [notMet()];
    },
  },
  {
    id: 'api-5xx-spike',
    scope: 'global',
    severity: 'warning',
    // threshold = 5xx ratio; minSamples on the denominator (finding 2: status_class label).
    defaultParams: { threshold: 0.05, windowMinutes: 5, minSamples: 20, forMinutes: 2, resolveAfterGoodChecks: 2, cooldownMinutes: 15, maxUnresolvedHours: 6 },
    evaluate: (data, params) => {
      const windowMs = params.windowMinutes * 60_000;
      const total = data.windowSum('api_requests_total', {}, windowMs);
      if (total < params.minSamples) return [notMet()];
      const fiveXx = data.windowSum('api_requests_total', { status_class: '5xx' }, windowMs);
      const ratio = fiveXx / total;
      if (ratio > params.threshold) {
        return [met(`5xx ratio ${pct(ratio)} (${fiveXx}/${total} requests) exceeds ${pct(params.threshold)} in the last ${params.windowMinutes} min`, { fiveXx, total, ratio })];
      }
      return [notMet()];
    },
  },
  {
    id: 'api-429-spike',
    scope: 'global',
    severity: 'warning',
    // threshold = API rejection count; per-key scoping via the top-N map (finding 2/3).
    defaultParams: { threshold: 20, windowMinutes: 5, minSamples: 0, forMinutes: 2, resolveAfterGoodChecks: 2, cooldownMinutes: 15, maxUnresolvedHours: 6 },
    evaluate: (data, params) =>
      rateLimitSpike(
        data,
        params,
        'api',
        'API rate-limit',
        'no single key dominates — client abuse, misconfigured polling, or the limit is set too low',
      ),
  },
  {
    id: 'auth-429-spike',
    scope: 'global',
    severity: 'warning',
    // threshold = auth rejection count — security signal (credential stuffing / brute force).
    defaultParams: { threshold: 5, windowMinutes: 15, minSamples: 0, forMinutes: 2, resolveAfterGoodChecks: 2, cooldownMinutes: 15, maxUnresolvedHours: 6 },
    evaluate: (data, params) =>
      rateLimitSpike(data, params, 'auth', 'Auth (login/refresh) rate-limit', 'no single key dominates — review the auth rate limit and recent login traffic'),
  },
  {
    id: 'oauth-refresh-failing',
    scope: 'per_provider',
    severity: 'warning',
    // threshold = refresh failure count (ok=false label series).
    defaultParams: { threshold: 3, windowMinutes: 60, minSamples: 0, forMinutes: 2, resolveAfterGoodChecks: 2, cooldownMinutes: 15, maxUnresolvedHours: 6 },
    evaluate: (data, params, providerId) => {
      if (!providerId) return [notMet()];
      const count = data.windowSum('oauth_refresh_total', { provider_id: providerId, ok: 'false' }, params.windowMinutes * 60_000);
      if (count >= params.threshold) {
        return [
          met(
            `${providerLabel(data, providerId)}: ${count} OAuth2 token refresh failures in the last ${params.windowMinutes} min — credentials may be expired or revoked`,
            { providerId, failures: count },
          ),
        ];
      }
      return [notMet()];
    },
  },
  {
    id: 'imap-poll-failing',
    scope: 'per_provider',
    severity: 'warning',
    // threshold = failed poll cycle count.
    defaultParams: { threshold: 5, windowMinutes: 60, minSamples: 0, forMinutes: 2, resolveAfterGoodChecks: 2, cooldownMinutes: 15, maxUnresolvedHours: 6 },
    evaluate: (data, params, providerId) => {
      if (!providerId) return [notMet()];
      const count = data.windowSum('imap_poll_total', { provider_id: providerId, ok: 'false' }, params.windowMinutes * 60_000);
      if (count >= params.threshold) {
        return [met(`${providerLabel(data, providerId)}: ${count} failed IMAP poll cycles in the last ${params.windowMinutes} min — inbox connectivity or credentials problem`, { providerId, failures: count })];
      }
      return [notMet()];
    },
  },
  {
    id: 'high-memory',
    scope: 'global',
    severity: 'warning',
    // threshold in BYTES — mirrors the health check's 1536 MB default (finding 14).
    defaultParams: { threshold: 1536 * MB, windowMinutes: 0, minSamples: 0, forMinutes: 2, resolveAfterGoodChecks: 2, cooldownMinutes: 15, maxUnresolvedHours: 6 },
    evaluate: (data, params) => {
      const rssBytes = data.metrics.gauges.rss_bytes?.[''];
      if (rssBytes === undefined) return [notMet()]; // missing gauge = no data (finding 13)
      if (rssBytes > params.threshold) {
        return [met(`Process RSS ${(rssBytes / MB).toFixed(0)} MB exceeds the ${(params.threshold / MB).toFixed(0)} MB threshold`, { rssBytes, thresholdBytes: params.threshold })];
      }
      return [notMet()];
    },
  },
  {
    id: 'event-loop-lag',
    scope: 'global',
    severity: 'warning',
    // threshold = p95 lag in ms; sustainment comes from forMinutes (PROPOSAL "for 5 min" semantics).
    defaultParams: { threshold: 250, windowMinutes: 0, minSamples: 0, forMinutes: 2, resolveAfterGoodChecks: 2, cooldownMinutes: 15, maxUnresolvedHours: 6 },
    evaluate: (data, params) => {
      const lagP95Ms = data.metrics.gauges.event_loop_lag_p95_ms?.[''];
      if (lagP95Ms === undefined) return [notMet()]; // missing gauge = no data (finding 13)
      if (lagP95Ms > params.threshold) {
        return [
          met(
            `Event-loop lag p95 ${lagP95Ms.toFixed(0)} ms exceeds ${params.threshold} ms — the process is blocked (sustained for ${params.forMinutes} min)`,
            { lagP95Ms, thresholdMs: params.threshold },
          ),
        ];
      }
      return [notMet()];
    },
  },
  {
    id: 'fallback-active',
    scope: 'per_provider',
    severity: 'info',
    // forMinutes 0: early signal — fire on the first fallback execution in the window.
    defaultParams: { threshold: 1, windowMinutes: 10, minSamples: 0, forMinutes: 0, resolveAfterGoodChecks: 2, cooldownMinutes: 15, maxUnresolvedHours: 6 },
    evaluate: (data, params, providerId) => {
      if (!providerId) return [notMet()];
      const count = data.fallbackEventCounts.get(providerId) ?? 0;
      if (count >= params.threshold) {
        return [met(`${providerLabel(data, providerId)}: ${count} fallback execution(s) in the last ${params.windowMinutes} min — the primary path is degrading`, { providerId, fallbacks: count })];
      }
      return [notMet()];
    },
  },
  // ==================== Streaming (5) ====================
  {
    id: 'stream-slow-ttft',
    scope: 'per_provider',
    severity: 'warning',
    // threshold = ttft p95 limit in ms for LLM; TTS uses a fixed 3 s (first audio is tighter).
    defaultParams: { threshold: 10_000, windowMinutes: 10, minSamples: 10, forMinutes: 2, resolveAfterGoodChecks: 2, cooldownMinutes: 15, maxUnresolvedHours: 6 },
    evaluate: (data, params, providerId) => {
      if (!providerId) return [notMet()];
      const stats = windowStats(data, params, providerId);
      if (!stats || stats.ttftRows < params.minSamples || stats.ttftP95Ms === null) return [notMet()];
      const providerType = providerTypeOf(data, providerId);
      const limitMs = providerType === 'tts' ? 3_000 : params.threshold;
      if (stats.ttftP95Ms > limitMs) {
        return [
          met(
            `${providerLabel(data, providerId)}: ttft p95 ${secs(stats.ttftP95Ms)} exceeds ${secs(limitMs)} over ${stats.ttftRows} streaming calls in the last ${params.windowMinutes} min — users wait too long for the first token/audio`,
            { providerId, ttftP95Ms: stats.ttftP95Ms, ttftRows: stats.ttftRows, limitMs },
          ),
        ];
      }
      return [notMet()];
    },
  },
  {
    id: 'stream-stalls',
    scope: 'per_provider',
    severity: 'warning',
    // threshold = fraction of streamed rows with a >10 s chunk gap (denominator per finding 16).
    defaultParams: { threshold: 0.1, windowMinutes: 10, minSamples: 10, forMinutes: 2, resolveAfterGoodChecks: 2, cooldownMinutes: 15, maxUnresolvedHours: 6 },
    evaluate: (data, params, providerId) => {
      if (!providerId) return [notMet()];
      const stats = windowStats(data, params, providerId);
      if (!stats || stats.gapRows < params.minSamples) return [notMet()];
      const ratio = stats.stalledRows / stats.gapRows;
      if (ratio > params.threshold) {
        return [
          met(
            `${providerLabel(data, providerId)}: ${stats.stalledRows}/${stats.gapRows} streamed calls stalled (max chunk gap > 10 s, ${pct(ratio)}) in the last ${params.windowMinutes} min — streams feel frozen mid-response`,
            { providerId, stalledRows: stats.stalledRows, gapRows: stats.gapRows, ratio },
          ),
        ];
      }
      return [notMet()];
    },
  },
  {
    id: 'stream-abort-rate',
    scope: 'per_provider',
    severity: 'warning',
    // threshold = fraction of ALL provider rows with errorPhase='mid_stream' (finding 16).
    defaultParams: { threshold: 0.1, windowMinutes: 10, minSamples: 10, forMinutes: 2, resolveAfterGoodChecks: 2, cooldownMinutes: 15, maxUnresolvedHours: 6 },
    evaluate: (data, params, providerId) => {
      if (!providerId) return [notMet()];
      const stats = windowStats(data, params, providerId);
      if (!stats || stats.calls < params.minSamples) return [notMet()];
      const ratio = stats.midStreamRows / stats.calls;
      if (ratio > params.threshold) {
        return [
          met(
            `${providerLabel(data, providerId)}: ${stats.midStreamRows}/${stats.calls} calls aborted mid-stream (error after first chunks delivered, ${pct(ratio)}) in the last ${params.windowMinutes} min — long generations die before completion`,
            { providerId, midStreamRows: stats.midStreamRows, calls: stats.calls, ratio },
          ),
        ];
      }
      return [notMet()];
    },
  },
  {
    id: 'tts-rtf-degraded',
    scope: 'per_provider',
    severity: 'warning',
    // threshold = fraction of TTS rows where duration_ms > audioDurationMs (RTF > 1).
    defaultParams: { threshold: 0.1, windowMinutes: 10, minSamples: 10, forMinutes: 2, resolveAfterGoodChecks: 2, cooldownMinutes: 15, maxUnresolvedHours: 6 },
    evaluate: (data, params, providerId) => {
      if (!providerId) return [notMet()];
      const stats = windowStats(data, params, providerId);
      if (!stats || stats.audioRows < params.minSamples) return [notMet()];
      const ratio = stats.rtfOverRows / stats.audioRows;
      if (ratio > params.threshold) {
        return [
          met(
            `${providerLabel(data, providerId)}: ${stats.rtfOverRows}/${stats.audioRows} TTS calls took longer than the audio they produced (RTF > 1, ${pct(ratio)}) in the last ${params.windowMinutes} min`,
            { providerId, rtfOverRows: stats.rtfOverRows, audioRows: stats.audioRows, ratio },
          ),
        ];
      }
      return [notMet()];
    },
  },
  {
    id: 'asr-final-latency',
    scope: 'per_provider',
    severity: 'warning',
    // threshold = p95 eosToFinalMs limit (PROPOSAL 10 s); denominator = rows WITH eosToFinalMs.
    defaultParams: { threshold: 10_000, windowMinutes: 10, minSamples: 5, forMinutes: 2, resolveAfterGoodChecks: 2, cooldownMinutes: 15, maxUnresolvedHours: 6 },
    evaluate: (data, params, providerId) => {
      if (!providerId) return [notMet()];
      const stats = windowStats(data, params, providerId);
      if (!stats || stats.eosRows < params.minSamples || stats.eosP95Ms === null) return [notMet()];
      if (stats.eosP95Ms > params.threshold) {
        return [
          met(
            `${providerLabel(data, providerId)}: ASR final-transcript latency p95 ${secs(stats.eosP95Ms)} exceeds ${secs(params.threshold)} over ${stats.eosRows} sessions in the last ${params.windowMinutes} min`,
            { providerId, eosP95Ms: stats.eosP95Ms, eosRows: stats.eosRows },
          ),
        ];
      }
      return [notMet()];
    },
  },
];

/** Registered rule ids — the config contract refines `rules` keys against this (finding 19). */
export const RULE_IDS: ReadonlySet<string> = new Set(DEFAULT_RULES.map((rule) => rule.id));

/** Rule lookup by id (engine + startup reconciliation). */
export const RULE_MAP: ReadonlyMap<string, AlertRuleDef> = new Map(DEFAULT_RULES.map((rule) => [rule.id, rule]));
