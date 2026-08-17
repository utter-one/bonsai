import { singleton } from 'tsyringe';
import { db } from '../../db';
import { metricSamples } from '../../db/schema';
import { generateId } from '../../utils/idGenerator';
import logger from '../../utils/logger';

/**
 * In-process metrics registry (counters, gauges, histograms with fixed buckets).
 *
 * - Closed metric registry: names must be declared in METRIC_CONFIGS (one place
 *   for kinds, buckets, series caps) — unknown name → pino warn + drop.
 * - Label cardinality guard: key allowlist + per-metric series cap + per-label
 *   value caps (e.g. route_group → 'other' beyond 100 values).
 * - Every 60s: flush deltas to `metric_samples` (batched insert; on failure the
 *   in-memory state is kept and retried on the next flush — never throws).
 * - `snapshot()` is the read surface for the alert rule engine (P2-01) and the
 *   Prometheus exporter (P4-01).
 */

export type MetricKind = 'counter' | 'gauge' | 'histogram';

export interface CappedLabel {
  key: string;
  max: number;
  overflow: string;
}

export interface MetricConfig {
  kind: MetricKind;
  /** Histogram bucket upper bounds (ms), ascending. Required for histograms. */
  buckets?: number[];
  /** Max distinct label-sets for this metric (default 50). */
  maxSeries?: number;
  /** Label value caps with overflow normalization. */
  cappedLabels?: CappedLabel[];
}

export const METRIC_FLUSH_INTERVAL_MS = 60_000;
const DEFAULT_MAX_SERIES = 50;

/**
 * Label keys allowed on any metric. Everything else is dropped with a warning —
 * this is the first layer of the cardinality guard (PROPOSAL §3.2b: labels stay
 * low-cardinality; token counts / ids never become labels).
 */
export const ALLOWED_LABEL_KEYS = new Set([
  'provider_id',
  'provider_type',
  'project_id',
  'operation',
  'model',
  'ok',
  'error_code',
  'scope',
  'key_type',
  'method',
  'route_group',
  'status_class',
  'service',
  'check',
  'direction',
]);

const routeGroupCap: CappedLabel = { key: 'route_group', max: 200, overflow: 'other' };

/**
 * One-place metric config: the closed registry of metric names with kind,
 * histogram buckets and series caps (cardinality decisions — see P1-02 spec).
 */
export const METRIC_CONFIGS: Record<string, MetricConfig> = {
  // HTTP request outcomes (P1-04)
  api_requests_total: { kind: 'counter', maxSeries: 4000, cappedLabels: [routeGroupCap] },
  api_request_duration_ms: {
    kind: 'histogram',
    buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000],
    maxSeries: 4000,
    cappedLabels: [routeGroupCap],
  },
  // Third-party call outcomes (P1-03)
  provider_calls_total: { kind: 'counter', maxSeries: 2000 },
  provider_call_duration_ms: {
    kind: 'histogram',
    buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000],
    maxSeries: 2000,
  },
  // Streaming phase histograms (P1-03) — phase-level, not total duration
  llm_ttft_ms: { kind: 'histogram', buckets: [100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000], maxSeries: 1000 },
  llm_stream_duration_ms: { kind: 'histogram', buckets: [500, 1000, 2500, 5000, 10000, 30000, 60000, 120000], maxSeries: 1000 },
  tts_ttfa_ms: { kind: 'histogram', buckets: [100, 250, 500, 1000, 2000, 5000, 10000], maxSeries: 1000 },
  tts_synthesis_ms: { kind: 'histogram', buckets: [100, 250, 500, 1000, 2500, 5000, 10000, 30000], maxSeries: 1000 },
  asr_setup_ms: { kind: 'histogram', buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000], maxSeries: 1000 },
  asr_eos_to_final_ms: { kind: 'histogram', buckets: [250, 500, 1000, 2500, 5000, 10000, 30000], maxSeries: 1000 },
  ai_turn_ttft_ms: { kind: 'histogram', buckets: [500, 1000, 2000, 3000, 5000, 10000, 30000], maxSeries: 500 },
  // Live gauges
  active_conversations: { kind: 'gauge' },
  active_websocket_connections: { kind: 'gauge' },
  active_voice_media_streams: { kind: 'gauge' },
  // Voice media stream flow (P1-03) — direction ∈ {in, out}; per-frame rows are out of scope
  voice_media_bytes_total: { kind: 'counter' },
  voice_media_max_frame_gap_ms: {
    kind: 'histogram',
    buckets: [50, 100, 200, 400, 800, 1600, 3200, 6400],
  },
  db_pool_total: { kind: 'gauge' },
  db_pool_idle: { kind: 'gauge' },
  db_pool_waiting: { kind: 'gauge' },
  rss_bytes: { kind: 'gauge' },
  event_loop_lag_p95_ms: { kind: 'gauge' },
  // Circuit breaker / failover (P3-01..P3-06)
  circuit_breaker_state: { kind: 'gauge', maxSeries: 500 },
  circuit_opens_total: { kind: 'counter', maxSeries: 500 },
  circuit_open_skips_total: { kind: 'counter', maxSeries: 500 },
  fallback_attempts_total: { kind: 'counter', maxSeries: 500 },
  fallbacks_executed_total: { kind: 'counter', maxSeries: 1000 },
  provider_chain_exhausted_total: { kind: 'counter', maxSeries: 500 },
  fallback_incompatible_total: { kind: 'counter', maxSeries: 500 },
  // Background services / own rate limits / sync services (P1-05, P1-07)
  background_service_last_run_ts: { kind: 'gauge', maxSeries: 500 },
  rate_limit_rejections_total: { kind: 'counter' },
  oauth_refresh_total: { kind: 'counter', maxSeries: 500 },
  imap_poll_total: { kind: 'counter', maxSeries: 500 },
};

/**
 * Snapshot of the in-process metric state — plain deep copies, safe to consume
 * outside the registry (P2-01 rule engine, P4-01 Prometheus exporter).
 * Histogram `buckets` are non-cumulative counts per (previous_bound, bound] with
 * a final +Inf bucket; `min`/`max` are all-time for the series lifetime.
 */
export type MetricsSnapshot = {
  counters: Record<string, Record<string, { count: number; sum: number }>>;
  gauges: Record<string, Record<string, number>>;
  histograms: Record<string, Record<string, { count: number; sum: number; min: number; max: number; buckets: number[] }>>;
};

type CounterState = { kind: 'counter'; count: number; sum: number; flushedCount: number; flushedSum: number };
type GaugeState = { kind: 'gauge'; value: number; flushedValue: number };
type HistogramState = {
  kind: 'histogram';
  count: number;
  sum: number;
  min: number;
  max: number;
  buckets: number[];
  windowCount: number;
  windowSum: number;
  windowMin: number;
  windowMax: number;
};
type SeriesState = CounterState | GaugeState | HistogramState;

export interface MetricSampleRow {
  id: string;
  bucket: Date;
  name: string;
  labels: Record<string, string>;
  count: number;
  sum: number | null;
  min: number | null;
  max: number | null;
}

@singleton()
export class MetricsRegistry {
  private series = new Map<string, Map<string, SeriesState>>();
  private labelValueSets = new Map<string, Set<string>>();
  private warned = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;
  lastFlushError: unknown = null;

  /** Increments a counter by `value` (default 1). */
  inc(name: string, labels?: Record<string, unknown>, value = 1): void {
    const cfg = this.requireMetric(name, 'counter', 'inc');
    if (!cfg || !Number.isFinite(value)) return;
    const key = this.buildSeriesKey(name, cfg, labels);
    if (key === undefined) return;
    const state = this.getOrCreateSeries(name, cfg, key, () => ({
      kind: 'counter',
      count: 0,
      sum: 0,
      flushedCount: 0,
      flushedSum: 0,
    }));
    if (!state) return;
    state.count += value;
    state.sum += value;
  }

  /** Sets a gauge to an absolute value. */
  setGauge(name: string, labels?: Record<string, unknown>, value?: number): void {
    const cfg = this.requireMetric(name, 'gauge', 'setGauge');
    if (!cfg || !Number.isFinite(value)) return;
    const key = this.buildSeriesKey(name, cfg, labels);
    if (key === undefined) return;
    const state = this.getOrCreateSeries(name, cfg, key, () => ({
      kind: 'gauge',
      value,
      flushedValue: NaN, // NaN forces the first value to be flushed too
    }));
    if (!state) return;
    state.value = value;
  }

  /** Applies a delta to a gauge (positive or negative, default 1). For gauges driven by many independent producers (e.g. one per conversation runner). */
  changeGauge(name: string, labels: Record<string, unknown> | undefined, delta = 1): void {
    const cfg = this.requireMetric(name, 'gauge', 'changeGauge');
    if (!cfg || !Number.isFinite(delta)) return;
    const key = this.buildSeriesKey(name, cfg, labels);
    if (key === undefined) return;
    const state = this.getOrCreateSeries(name, cfg, key, () => ({
      kind: 'gauge',
      value: 0,
      flushedValue: NaN, // NaN forces the first value to be flushed too
    }));
    if (!state) return;
    state.value += delta;
  }

  /** Observes a value on a histogram. */
  observe(name: string, labels?: Record<string, unknown>, value?: number): void {
    const cfg = this.requireMetric(name, 'histogram', 'observe');
    if (!cfg || !Number.isFinite(value)) return;
    const key = this.buildSeriesKey(name, cfg, labels);
    if (key === undefined) return;
    const state = this.getOrCreateSeries(name, cfg, key, () => ({
      kind: 'histogram',
      count: 0,
      sum: 0,
      min: Infinity,
      max: -Infinity,
      buckets: new Array((cfg.buckets?.length ?? 0) + 1).fill(0),
      windowCount: 0,
      windowSum: 0,
      windowMin: Infinity,
      windowMax: -Infinity,
    }));
    if (!state) return;
    state.count += 1;
    state.sum += value;
    state.min = Math.min(state.min, value);
    state.max = Math.max(state.max, value);
    state.windowCount += 1;
    state.windowSum += value;
    state.windowMin = Math.min(state.windowMin, value);
    state.windowMax = Math.max(state.windowMax, value);
    const boundaries = cfg.buckets ?? [];
    let idx = boundaries.length; // +Inf bucket
    for (let i = 0; i < boundaries.length; i++) {
      if (value <= boundaries[i]) {
        idx = i;
        break;
      }
    }
    state.buckets[idx] += 1;
  }

  /** Deep-copied snapshot of the current state (see MetricsSnapshot). */
  snapshot(): MetricsSnapshot {
    const snap: MetricsSnapshot = { counters: {}, gauges: {}, histograms: {} };
    for (const [name, seriesMap] of this.series) {
      for (const [key, state] of seriesMap) {
        if (state.kind === 'counter') {
          (snap.counters[name] ??= {})[key] = { count: state.count, sum: state.sum };
        } else if (state.kind === 'gauge') {
          (snap.gauges[name] ??= {})[key] = state.value;
        } else {
          (snap.histograms[name] ??= {})[key] = {
            count: state.count,
            sum: state.sum,
            min: state.count > 0 ? state.min : 0,
            max: state.count > 0 ? state.max : 0,
            buckets: [...state.buckets],
          };
        }
      }
    }
    return snap;
  }

  /** Starts the 60s flush interval. Idempotent. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.flushNow();
    }, METRIC_FLUSH_INTERVAL_MS);
    logger.info(`MetricsRegistry started (flush interval ${METRIC_FLUSH_INTERVAL_MS}ms)`);
  }

  /** Stops the flush interval. Call `flushNow()` first on shutdown (P1-09). */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('MetricsRegistry stopped');
    }
  }

  /** Flushes pending deltas to `metric_samples`. Never throws. */
  async flushNow(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const bucket = new Date(Math.floor(Date.now() / 60_000) * 60_000);
      const pending: { row: MetricSampleRow; commit: () => void }[] = [];

      for (const [name, seriesMap] of this.series) {
        for (const [key, state] of seriesMap) {
          const labels = parseSeriesKey(key);
          if (state.kind === 'counter') {
            const dCount = state.count - state.flushedCount;
            const dSum = state.sum - state.flushedSum;
            if (dCount !== 0 || dSum !== 0) {
              pending.push({
                row: { id: generateId('msmp'), bucket, name, labels, count: dCount, sum: dSum, min: null, max: null },
                commit: () => {
                  state.flushedCount = state.count;
                  state.flushedSum = state.sum;
                },
              });
            }
          } else if (state.kind === 'gauge') {
            if (state.value !== state.flushedValue) {
              pending.push({
                row: {
                  id: generateId('msmp'),
                  bucket,
                  name,
                  labels,
                  count: 1,
                  sum: state.value,
                  min: state.value,
                  max: state.value,
                },
                commit: () => {
                  state.flushedValue = state.value;
                },
              });
            }
          } else if (state.windowCount > 0) {
            const dCount = state.windowCount;
            const dSum = state.windowSum;
            const dMin = state.windowMin;
            const dMax = state.windowMax;
            pending.push({
              row: { id: generateId('msmp'), bucket, name, labels, count: dCount, sum: dSum, min: dMin, max: dMax },
              commit: () => {
                state.windowCount = 0;
                state.windowSum = 0;
                state.windowMin = Infinity;
                state.windowMax = -Infinity;
              },
            });
          }
        }
      }

      if (!pending.length) return;
      try {
        await this.persistRows(pending.map((p) => p.row));
        for (const p of pending) p.commit();
      } catch (err) {
        // Keep in-memory state (deltas retry on the next flush) and report once.
        this.lastFlushError = err;
        this.onFlushError(err);
      }
    } finally {
      this.flushing = false;
    }
  }

  // --- internals (protected seams for unit tests) ---

  protected async persistRows(rows: MetricSampleRow[]): Promise<void> {
    await db.insert(metricSamples).values(rows);
  }

  protected onFlushError(err: unknown): void {
    logger.error({ error: (err as Error)?.message ?? String(err) }, 'MetricsRegistry flush to metric_samples failed — deltas kept in memory, retrying next interval');
  }

  private requireMetric(name: string, kind: MetricKind, op: string): MetricConfig | undefined {
    const cfg = METRIC_CONFIGS[name];
    if (!cfg) {
      this.warnOnce(`unknown-metric:${name}`, `MetricsRegistry: unknown metric '${name}' dropped (add it to METRIC_CONFIGS)`);
      return undefined;
    }
    if (cfg.kind !== kind) {
      this.warnOnce(`kind-mismatch:${name}:${op}`, `MetricsRegistry: ${op}() on ${cfg.kind} metric '${name}' dropped`);
      return undefined;
    }
    return cfg;
  }

  /** Validates label keys, applies value caps, returns the stable series key ('' for no labels). */
  private buildSeriesKey(name: string, cfg: MetricConfig, labels?: Record<string, unknown>): string | undefined {
    if (!labels) return '';
    const entries: [string, string][] = [];
    for (const [rawKey, rawValue] of Object.entries(labels)) {
      if (rawValue === undefined || rawValue === null) continue;
      if (!ALLOWED_LABEL_KEYS.has(rawKey)) {
        this.warnOnce(`bad-label-key:${name}:${rawKey}`, `MetricsRegistry: label key '${rawKey}' on '${name}' is not in the allowlist — series dropped`);
        return undefined;
      }
      let value = String(rawValue);
      for (const cap of cfg.cappedLabels ?? []) {
        if (rawKey !== cap.key) continue;
        const setKey = `${name}:${rawKey}`;
        let seen = this.labelValueSets.get(setKey);
        if (!seen) {
          seen = new Set();
          this.labelValueSets.set(setKey, seen);
        }
        if (!seen.has(value)) {
          if (seen.size >= cap.max) {
            value = cap.overflow; // bounded: overflow value itself is tracked once
          } else {
            seen.add(value);
          }
        }
        seen.add(value);
      }
      entries.push([rawKey, value]);
    }
    entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return entries.map(([k, v]) => `${k}=${v}`).join(',');
  }

  private getOrCreateSeries<T extends SeriesState>(
    name: string,
    cfg: MetricConfig,
    key: string,
    factory: () => T,
  ): T | undefined {
    let seriesMap = this.series.get(name);
    if (!seriesMap) {
      seriesMap = new Map();
      this.series.set(name, seriesMap);
    }
    const existing = seriesMap.get(key) as T | undefined;
    if (existing) return existing;
    const maxSeries = cfg.maxSeries ?? DEFAULT_MAX_SERIES;
    if (seriesMap.size >= maxSeries) {
      this.warnOnce(`series-cap:${name}:${key}`, `MetricsRegistry: series cap (${maxSeries}) reached for '${name}' — new label-set '${key}' dropped`);
      return undefined;
    }
    const state = factory();
    seriesMap.set(key, state);
    return state;
  }

  private warnOnce(dedupeKey: string, message: string): void {
    if (this.warned.has(dedupeKey)) return;
    this.warned.add(dedupeKey);
    logger.warn(message);
  }
}

/** Inverse of buildSeriesKey: 'a=1,b=2' → { a: '1', b: '2' }. */
function parseSeriesKey(key: string): Record<string, string> {
  if (!key) return {};
  const out: Record<string, string> = {};
  for (const part of key.split(',')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return out;
}
