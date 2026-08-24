import type { Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import logger from '../../utils/logger';
import { getMetricsRegistry } from '../../services/monitoring/ProviderCallRecorder';
import { METRIC_CONFIGS, METRIC_DESCRIPTIONS } from '../../services/monitoring/MetricsRegistry';
import type { MetricsSnapshot } from '../../services/monitoring/MetricsRegistry';

/**
 * Prometheus exposition endpoint (P4-01).
 *
 * Renders the in-memory `MetricsRegistry` snapshot as Prometheus text format 0.0.4.
 * Disabled by default: `MONITORING_METRICS_TOKEN` unset/empty → 404 (the endpoint
 * does not reveal it exists). Token is read from `process.env` per request so it
 * can be rotated without a restart (and toggled per-test in e2e).
 */

export const METRICS_TOKEN_ENV = 'MONITORING_METRICS_TOKEN';
export const METRICS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

const MAX_AUTH_FAILURE_LOGS = 10;
const AUTH_FAILURE_LOG_WINDOW_MS = 60_000;

const PROCESS_METRIC_DESCRIPTIONS: Record<string, string> = {
  process_uptime_seconds: 'Process uptime in seconds.',
  process_resident_memory_bytes: 'Process resident set size in bytes.',
};

/** Sanitizes a metric/label name to the Prometheus charset `[a-zA-Z_:][a-zA-Z0-9_:]*`. */
export function sanitizeName(name: string): string {
  let out = '';
  for (const ch of name) {
    const valid = ch === ':' || (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (out.length > 0 && ch >= '0' && ch <= '9');
    out += valid ? ch : '_';
  }
  return out;
}

/** Escapes a label value per the Prometheus text format: backslash, double quote, newline. */
export function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/** Inverse of the registry series key: 'a=1,b=2' → [['a','1'],['b','2']] (first '=' splits). */
function parseSeriesKey(key: string): [string, string][] {
  if (!key) return [];
  const out: [string, string][] = [];
  for (const part of key.split(',')) {
    const eq = part.indexOf('=');
    if (eq > 0) out.push([part.slice(0, eq), part.slice(eq + 1)]);
  }
  return out;
}

function formatLabels(pairs: [string, string][], extra?: [string, string]): string {
  const all = extra ? [...pairs, extra] : pairs;
  if (all.length === 0) return '';
  return `{${all.map(([k, v]) => `${sanitizeName(k)}="${escapeLabelValue(v)}"`).join(',')}}`;
}

function fmt(value: number): string {
  return String(value);
}

export interface ProcessStats {
  uptimeSeconds: number;
  residentMemoryBytes: number;
}

function descriptionFor(name: string): string {
  return METRIC_CONFIGS[name]?.description ?? METRIC_DESCRIPTIONS[name] ?? PROCESS_METRIC_DESCRIPTIONS[name] ?? 'No description available.';
}

/**
 * Renders a snapshot in Prometheus text format 0.0.4. Deterministic for the same
 * snapshot: metric names sorted, label-sets sorted, histograms cumulative with a
 * final `le="+Inf"` bucket plus `_sum`/`_count`. Always includes
 * `process_uptime_seconds` and `process_resident_memory_bytes`.
 */
export function renderPrometheusExposition(snapshot: MetricsSnapshot, processStats: ProcessStats): string {
  const lines: string[] = [];
  const names = new Set<string>([
    ...Object.keys(snapshot.counters),
    ...Object.keys(snapshot.gauges),
    ...Object.keys(snapshot.histograms),
    'process_uptime_seconds',
    'process_resident_memory_bytes',
  ]);

  for (const name of [...names].sort()) {
    const safeName = sanitizeName(name);
    let kind: 'counter' | 'gauge' | 'histogram' = 'gauge';
    if (snapshot.counters[name] !== undefined) kind = 'counter';
    else if (snapshot.histograms[name] !== undefined) kind = 'histogram';

    lines.push(`# HELP ${safeName} ${descriptionFor(name)}`);
    lines.push(`# TYPE ${safeName} ${kind}`);

    if (name === 'process_uptime_seconds') {
      lines.push(`process_uptime_seconds ${fmt(processStats.uptimeSeconds)}`);
      continue;
    }
    if (name === 'process_resident_memory_bytes') {
      lines.push(`process_resident_memory_bytes ${fmt(processStats.residentMemoryBytes)}`);
      continue;
    }

    const seriesMap = (snapshot.counters[name] ?? snapshot.gauges[name] ?? snapshot.histograms[name]) as Record<string, unknown>;
    for (const key of Object.keys(seriesMap).sort()) {
      const pairs = parseSeriesKey(key);
      if (kind === 'counter') {
        lines.push(`${safeName}${formatLabels(pairs)} ${fmt((seriesMap[key] as { count: number }).count)}`);
      } else if (kind === 'gauge') {
        lines.push(`${safeName}${formatLabels(pairs)} ${fmt(seriesMap[key] as number)}`);
      } else {
        const state = seriesMap[key] as { count: number; sum: number; buckets: number[] };
        const boundaries = METRIC_CONFIGS[name]?.buckets ?? [];
        let cumulative = 0;
        boundaries.forEach((bound, i) => {
          cumulative += state.buckets[i] ?? 0;
          lines.push(`${safeName}_bucket${formatLabels(pairs, ['le', fmt(bound)])} ${fmt(cumulative)}`);
        });
        cumulative += state.buckets[boundaries.length] ?? 0;
        lines.push(`${safeName}_bucket${formatLabels(pairs, ['le', '+Inf'])} ${fmt(cumulative)}`);
        lines.push(`${safeName}_sum${formatLabels(pairs)} ${fmt(state.sum)}`);
        lines.push(`${safeName}_count${formatLabels(pairs)} ${fmt(state.count)}`);
      }
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * Fixed-window warn throttle for auth failures: at most `maxPerWindow` logs per
 * window (default 10/min) — a bad scraper must not flood the log.
 */
export class AuthFailureThrottle {
  private count = 0;
  private windowStart: number | null = null;

  constructor(
    private readonly windowMs = AUTH_FAILURE_LOG_WINDOW_MS,
    private readonly maxPerWindow = MAX_AUTH_FAILURE_LOGS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Returns true when the current failure should be logged. */
  allow(): boolean {
    const t = this.now();
    if (this.windowStart === null || t - this.windowStart >= this.windowMs) {
      this.windowStart = t;
      this.count = 1;
      return true;
    }
    this.count += 1;
    return this.count <= this.maxPerWindow;
  }
}

/** Constant-time bearer-token comparison (length-guarded). */
function tokenMatches(headerValue: string | undefined, expected: string): boolean {
  const provided = headerValue?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Builds the `GET /metrics` handler. The token is read from `process.env` per
 * request (rotation without restart). Unset/empty → 404; set + missing/wrong
 * token → 401 `{ error: 'unauthorized' }` (warn-throttled); valid → 200 exposition.
 */
export function createMetricsHandler(deps?: { throttle?: AuthFailureThrottle }): (req: Request, res: Response) => void {
  const throttle = deps?.throttle ?? new AuthFailureThrottle();

  return function metricsHandler(req: Request, res: Response): void {
    const expected = process.env[METRICS_TOKEN_ENV];
    if (!expected) {
      res.status(404).end();
      return;
    }

    if (!tokenMatches(req.get('authorization'), expected)) {
      if (throttle.allow()) {
        logger.warn({ ip: req.ip }, 'GET /metrics rejected — missing or invalid bearer token');
      }
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const registry = getMetricsRegistry();
    const snapshot: MetricsSnapshot = registry
      ? registry.snapshot()
      : { counters: {}, gauges: {}, histograms: {} };
    res
      .status(200)
      .set('Content-Type', METRICS_CONTENT_TYPE)
      .send(renderPrometheusExposition(snapshot, {
        uptimeSeconds: process.uptime(),
        residentMemoryBytes: process.memoryUsage().rss,
      }));
  };
}
