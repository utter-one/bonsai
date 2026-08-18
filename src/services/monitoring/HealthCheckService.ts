import { inject, singleton } from 'tsyringe';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { sql } from 'drizzle-orm';
import { db, getPoolRef } from '../../db';
import { healthChecks, providers } from '../../db/schema';
import type { Provider } from '../../types/models';
import { generateId } from '../../utils/idGenerator';
import logger from '../../utils/logger';
import { HeartbeatRegistry } from './HeartbeatRegistry';
import { MetricsRegistry } from './MetricsRegistry';
import { MonitoringConfigService } from './MonitoringConfigService';
import { LlmProviderFactory } from '../providers/llm/LlmProviderFactory';
import { StorageProviderFactory } from '../providers/storage/StorageProviderFactory';
import type { ProbeSettings } from '../../http/contracts/monitoring';

/**
 * P1-05 — real, persisted, per-check health (PROPOSAL §3.2e).
 *
 * Every cycle (default 60 s, `MONITORING_HEALTH_INTERVAL_MS`) runs all checks
 * concurrently with a per-check 10 s timeout:
 *   - `db` — SELECT 1 + pg pool stats (publishes `db_pool_*` gauges)
 *   - `process` — RSS / event-loop lag p95 + max (publishes `rss_bytes`,
 *     `event_loop_lag_p95_ms`, `event_loop_lag_max_ms` — max for burst-sensitive
 *     P2-01 rules, since p95 misses isolated stalls)
 *   - `service_heartbeat:<name>` — 6 background services + this service itself
 *   - `provider:<id>` — LLM/storage probed (`enumerateModels()` / `list('', 1)`,
 *     cooldown-gated; probe rows land in `provider_call_logs` via P1-03 wrappers),
 *     everything else inferred from recent `provider_call_logs`
 *
 * Results are batch-inserted into `health_checks` and kept in an in-memory
 * snapshot for the API (P1-08) and the rule engine (P2-01). `checkReady()`
 * backs the unauthenticated `/health/ready` endpoint.
 *
 * Probe policy (P1-06): `monitoring_config.probeSettings` drives the LLM
 * probe mode (`models` | `one_token` | `off`) and the per-provider cooldown;
 * the settings are fetched once per cycle and fall back to built-in defaults
 * when the config cannot be loaded. `MONITORING_HEALTH_PROBES=off` remains a
 * hard env kill switch (env beats config) — the test env sets it so e2e
 * never sends real outbound probes against fake provider configs.
 */

export type HealthCheckStatus = 'ok' | 'degraded' | 'down' | 'unknown';

export interface HealthCheckResult {
  name: string;
  status: HealthCheckStatus;
  latencyMs?: number;
  detail?: Record<string, unknown>;
}

interface HealthCheck {
  name: string;
  run: () => Promise<HealthCheckResult>;
}

/** Per-provider call-log rollup for provider-status inference (last 24 h). */
interface ProviderCallStats {
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastCallAt: Date | null;
}

interface PoolStats {
  poolTotal: number;
  poolIdle: number;
  poolWaiting: number;
}

/** Fallback probe policy when monitoring_config cannot be loaded (P1-06). */
const DEFAULT_PROBE_SETTINGS: ProbeSettings = { llmProbe: 'models', cooldownMinutes: 10 };
const RECENT_SUCCESS_SKIP_MS = 10 * 60_000;
const INFERENCE_WINDOW_MS = 30 * 60_000;
const CHECK_TIMEOUT_MS = 10_000;
const READY_TIMEOUT_MS = 3_000;
const EVENT_LOOP_LAG_THRESHOLD_MS = 250;
const SELF_HEARTBEAT_NAME = 'health-checks';

/**
 * The background services this deployment runs (P1-05). Always checked — even
 * never-ticked ones (no work yet, e.g. IMAP with zero providers → `unknown`).
 * Services ticking under other names still appear via `serviceStates()`.
 */
const KNOWN_SERVICE_HEARTBEATS = [
  'conversation-timeout',
  'processing-deferral',
  'scenario-run-executor',
  'benchmark-executor',
  'imap-inbound',
  'oauth2-token-refresh',
  SELF_HEARTBEAT_NAME,
];

@singleton()
export class HealthCheckService {
  private scheduledTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private readyInFlight: Promise<{ ready: boolean; reason?: string }> | null = null;
  private lastProbeAt = new Map<string, number>();
  private probeFailures = new Map<string, number>();
  private readonly eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
  private snapshot: { checkedAt: Date | null; checks: HealthCheckResult[] } = { checkedAt: null, checks: [] };

  private readonly intervalMs: number;
  private readonly probesEnabled: boolean;

  constructor(
    @inject(HeartbeatRegistry) private readonly heartbeatRegistry: HeartbeatRegistry,
    @inject(MetricsRegistry) private readonly metricsRegistry: MetricsRegistry,
    @inject(LlmProviderFactory) private readonly llmProviderFactory: LlmProviderFactory,
    @inject(StorageProviderFactory) private readonly storageProviderFactory: StorageProviderFactory,
    @inject(MonitoringConfigService) private readonly monitoringConfigService: MonitoringConfigService,
  ) {
    this.intervalMs = this.readIntervalMs();
    this.probesEnabled = process.env.MONITORING_HEALTH_PROBES !== 'off';
    this.eventLoopDelay.enable();
  }

  /** Starts the check loop. Called from server.ts after the other background services. */
  start(): void {
    logger.info({ intervalMs: this.intervalMs, probesEnabled: this.probesEnabled }, 'Starting HealthCheckService');
    this.heartbeatRegistry.declareInterval(SELF_HEARTBEAT_NAME, this.intervalMs);
    this.heartbeatRegistry.tick(SELF_HEARTBEAT_NAME, this.intervalMs);
    this.runCheckCycle().catch((error) => logger.error({ error }, 'Unhandled error in HealthCheckService initial run'));
    this.scheduledTimer = setInterval(() => {
      this.runCheckCycle().catch((error) => logger.error({ error }, 'Unhandled error in HealthCheckService.runCheckCycle'));
    }, this.intervalMs);
  }

  /** Stops the loop (P1-09 shutdown hook). */
  stop(): void {
    if (this.scheduledTimer) {
      clearInterval(this.scheduledTimer);
      this.scheduledTimer = null;
    }
    logger.info('HealthCheckService stopped');
  }

  /** Latest completed cycle; `checkedAt` is null until the first cycle finishes. */
  getSnapshot(): { checkedAt: Date | null; checks: HealthCheckResult[] } {
    return this.snapshot;
  }

  /**
   * Consecutive probe failures for a provider (reset on success).
   * Consumed by the `provider-down` rule's probe branch (P2-01).
   */
  getProbeFailures(providerId: string): number {
    return this.probeFailures.get(providerId) ?? 0;
  }

  /** Runs one check cycle immediately (test/manual hook — same path as the interval loop). */
  async runNow(): Promise<void> {
    await this.runCheckCycle();
  }

  /**
   * Readiness probe for `GET /health/ready`: real `SELECT 1` with a 3 s timeout.
   * Single flight — concurrent calls share one in-flight probe so a down DB
   * cannot pile up queued queries in the pool.
   */
  async checkReady(): Promise<{ ready: boolean; reason?: string }> {
    if (this.readyInFlight) return this.readyInFlight;
    this.readyInFlight = (async () => {
      try {
        await this.withTimeout(this.pingDb(), READY_TIMEOUT_MS);
        return { ready: true };
      } catch (error) {
        return { ready: false, reason: (error as Error)?.message ?? String(error) };
      } finally {
        this.readyInFlight = null;
      }
    })();
    return this.readyInFlight;
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  private async runCheckCycle(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      this.heartbeatRegistry.tick(SELF_HEARTBEAT_NAME, this.intervalMs);
      const checks = await this.buildChecks();
      const results = await Promise.all(checks.map((check) => this.runCheckWithTimeout(check)));
      await this.persistResults(results);
      this.snapshot = { checkedAt: new Date(), checks: results };
      logger.debug({ count: results.length, down: results.filter((r) => r.status === 'down').length }, 'HealthCheckService cycle completed');
    } finally {
      this.isProcessing = false;
    }
  }

  private async buildChecks(): Promise<HealthCheck[]> {
    const checks: HealthCheck[] = [
      { name: 'db', run: () => this.runDbCheck() },
      { name: 'process', run: () => this.runProcessCheck() },
    ];

    const states = this.heartbeatRegistry.serviceStates();
    const heartbeatNames = Array.from(new Set([...KNOWN_SERVICE_HEARTBEATS, ...Object.keys(states)])).sort();
    for (const name of heartbeatNames) {
      checks.push({ name: `service_heartbeat:${name}`, run: () => Promise.resolve(this.runHeartbeatCheck(name)) });
    }

    let providerList: Provider[] = [];
    let callStats: Record<string, ProviderCallStats> = {};
    try {
      [providerList, callStats] = await Promise.all([this.fetchProviders(), this.fetchRecentCallStats()]);
    } catch (error) {
      // A provider fetch failure must not discard the whole cycle — db/process
      // heartbeats still matter (the db check reports the DB-side failure).
      logger.warn({ error: (error as Error)?.message }, 'HealthCheckService: provider fetch failed — provider checks skipped this cycle');
    }
    // Fetched once per cycle so a config load failure degrades the whole
    // cycle's probes to defaults, not per-provider.
    const probeSettings = await this.getProbeSettings();
    for (const provider of providerList) {
      checks.push({ name: `provider:${provider.id}`, run: () => this.runProviderCheck(provider, callStats[provider.id], probeSettings) });
    }
    return checks;
  }

  /**
   * Probe policy from monitoring_config (P1-06). Falls back to the built-in
   * defaults when the config cannot be loaded — a DB blip must not disable
   * provider checks; inference still runs either way.
   */
  private async getProbeSettings(): Promise<ProbeSettings> {
    try {
      return (await this.monitoringConfigService.get()).probeSettings;
    } catch (error) {
      logger.warn(
        { error: (error as Error)?.message },
        'HealthCheckService: probe settings unavailable — using defaults for this cycle',
      );
      return { ...DEFAULT_PROBE_SETTINGS };
    }
  }

  private async runCheckWithTimeout(check: HealthCheck): Promise<HealthCheckResult> {
    try {
      return await this.withTimeout(check.run(), CHECK_TIMEOUT_MS);
    } catch (error) {
      return { name: check.name, status: 'down', detail: { error: (error as Error)?.message ?? String(error) } };
    }
  }

  private async runDbCheck(): Promise<HealthCheckResult> {
    const name = 'db';
    const startedAt = Date.now();
    try {
      await this.pingDb();
      const stats = this.getPoolStats();
      this.metricsRegistry.setGauge('db_pool_total', {}, stats.poolTotal);
      this.metricsRegistry.setGauge('db_pool_idle', {}, stats.poolIdle);
      this.metricsRegistry.setGauge('db_pool_waiting', {}, stats.poolWaiting);
      return {
        name,
        status: stats.poolWaiting > 0 ? 'degraded' : 'ok',
        latencyMs: Date.now() - startedAt,
        detail: { poolTotal: stats.poolTotal, poolIdle: stats.poolIdle, poolWaiting: stats.poolWaiting },
      };
    } catch (error) {
      return { name, status: 'down', detail: { error: (error as Error)?.message ?? String(error) } };
    }
  }

  private async runProcessCheck(): Promise<HealthCheckResult> {
    const name = 'process';
    const memory = process.memoryUsage();
    const { lagP95Ms, lagMaxMs } = this.readEventLoopLagMs();
    const thresholdBytes = this.memoryThresholdBytes();
    this.metricsRegistry.setGauge('rss_bytes', {}, memory.rss);
    this.metricsRegistry.setGauge('event_loop_lag_p95_ms', {}, lagP95Ms);
    this.metricsRegistry.setGauge('event_loop_lag_max_ms', {}, lagMaxMs);
    const degraded = memory.rss > thresholdBytes || lagP95Ms > EVENT_LOOP_LAG_THRESHOLD_MS;
    return {
      name,
      status: degraded ? 'degraded' : 'ok',
      detail: {
        uptimeSec: Math.round(process.uptime()),
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        memoryThresholdBytes: thresholdBytes,
        eventLoopLagP95Ms: lagP95Ms,
        eventLoopLagMaxMs: lagMaxMs,
      },
    };
  }

  private runHeartbeatCheck(serviceName: string): HealthCheckResult {
    const name = `service_heartbeat:${serviceName}`;
    const state = this.heartbeatRegistry.serviceStates()[serviceName];
    if (!state) {
      // Never ticked — no work yet is not a failure (e.g. IMAP with zero providers).
      return { name, status: 'unknown', detail: { reason: 'never ticked' } };
    }
    return {
      name,
      status: state.stale ? 'down' : 'ok',
      detail: { ageMs: state.ageMs, thresholdMs: state.thresholdMs, errorCount: state.errorCount },
    };
  }

  private async runProviderCheck(
    provider: Provider,
    stats: ProviderCallStats | undefined,
    probeSettings: ProbeSettings,
  ): Promise<HealthCheckResult> {
    const name = `provider:${provider.id}`;
    try {
      const llmProbeable = provider.providerType === 'llm' && probeSettings.llmProbe !== 'off';
      if (this.probesEnabled && (provider.providerType === 'storage' || llmProbeable)) {
        const probeResult = await this.maybeProbe(provider, stats, probeSettings);
        if (probeResult) return probeResult;
      }
      return this.inferProviderStatus(name, stats);
    } catch (error) {
      return { name, status: 'down', detail: { error: (error as Error)?.message ?? String(error) } };
    }
  }

  /**
   * Runs a provider probe when allowed (no recent success, cooldown elapsed)
   * and maps the outcome to a check result. Returns null when the probe is
   * skipped — the caller falls back to call-log inference.
   */
  private async maybeProbe(
    provider: Provider,
    stats: ProviderCallStats | undefined,
    probeSettings: ProbeSettings,
  ): Promise<HealthCheckResult | null> {
    const name = `provider:${provider.id}`;
    const now = Date.now();
    const lastSuccessAt = stats?.lastSuccessAt;
    if (lastSuccessAt && now - lastSuccessAt.getTime() < RECENT_SUCCESS_SKIP_MS) return null;

    const cooldownMs = probeSettings.cooldownMinutes * 60_000;
    const lastProbeAt = this.lastProbeAt.get(provider.id);
    if (lastProbeAt !== undefined && now - lastProbeAt < cooldownMs) return null;

    this.lastProbeAt.set(provider.id, now);
    const startedAt = Date.now();
    try {
      if (provider.providerType === 'llm') {
        // createProviderForEnumeration returns an uninitialised instance — init()
        // only constructs the client (no network) so enumerateModels hits the API.
        const instance = await this.llmProviderFactory.createProviderForEnumeration(provider);
        await instance.init();
        if (probeSettings.llmProbe === 'one_token') {
          // Costs money (config opt-in) — a single-token generation end-to-end.
          await this.withTimeout(
            instance.generate([{ role: 'user', content: 'Health probe' }], { maxTokens: 1 }),
            CHECK_TIMEOUT_MS,
          );
        } else {
          await this.withTimeout(instance.enumerateModels(), CHECK_TIMEOUT_MS);
        }
      } else {
        const instance = await this.storageProviderFactory.createProvider(provider, {});
        await this.withTimeout(instance.list('', 1), CHECK_TIMEOUT_MS);
      }
      this.probeFailures.delete(provider.id);
      return { name, status: 'ok', latencyMs: Date.now() - startedAt, detail: { probed: true } };
    } catch (error) {
      const message = (error as Error)?.message ?? String(error);
      const consecutive = (this.probeFailures.get(provider.id) ?? 0) + 1;
      this.probeFailures.set(provider.id, consecutive);
      logger.warn({ providerId: provider.id, consecutive, error: message }, 'Health probe failed');
      return {
        name,
        status: 'degraded',
        latencyMs: Date.now() - startedAt,
        detail: { probed: true, probeError: message, consecutiveProbeFailures: consecutive },
      };
    }
  }

  /** Call-log inference for non-probed providers (and skipped probes). */
  private inferProviderStatus(name: string, stats: ProviderCallStats | undefined): HealthCheckResult {
    const now = Date.now();
    const lastSuccessAt = stats?.lastSuccessAt ?? null;
    const lastFailureAt = stats?.lastFailureAt ?? null;
    const lastCallAt = stats?.lastCallAt ?? null;

    if (lastSuccessAt && now - lastSuccessAt.getTime() <= INFERENCE_WINDOW_MS) {
      return { name, status: 'ok', detail: { inferred: true, lastSuccessAt: lastSuccessAt.toISOString() } };
    }
    if (lastFailureAt && now - lastFailureAt.getTime() <= INFERENCE_WINDOW_MS) {
      return {
        name,
        status: 'degraded',
        detail: { inferred: true, lastFailureAt: lastFailureAt.toISOString(), lastSuccessAt: lastSuccessAt?.toISOString() ?? null },
      };
    }
    if (lastCallAt) {
      return { name, status: 'unknown', detail: { inferred: true, reason: 'no calls in the last 30 min', lastCallAt: lastCallAt.toISOString() } };
    }
    return { name, status: 'unknown', detail: { inferred: true, reason: 'no calls in the last 24 h' } };
  }

  private async persistResults(results: HealthCheckResult[]): Promise<void> {
    if (results.length === 0) return;
    await db.insert(healthChecks).values(
      results.map((result) => ({
        id: generateId('hchk'),
        checkName: result.name,
        status: result.status,
        latencyMs: result.latencyMs ?? null,
        detail: result.detail ?? null,
      })),
    );
  }

  // ─── Test seams (protected so unit tests can stub external boundaries) ──────

  /** All configured providers (unit tests override). */
  protected async fetchProviders(): Promise<Provider[]> {
    return db.select().from(providers);
  }

  /** One query per cycle: per-provider last success/failure/any-call within 24 h. */
  protected async fetchRecentCallStats(): Promise<Record<string, ProviderCallStats>> {
    // Timestamps are fetched as text and marked UTC explicitly: pg parses
    // naive-timestamp results as host-local time, which would skew the
    // age-of-call comparisons below by the host offset on non-UTC hosts.
    // The DB session runs in UTC, so the wall clock IS UTC.
    const result = await db.execute(sql`
      SELECT provider_id AS "providerId",
             max(created_at) FILTER (WHERE ok)::text AS "lastSuccessAt",
             max(created_at) FILTER (WHERE NOT ok)::text AS "lastFailureAt",
             max(created_at)::text AS "lastCallAt"
      FROM provider_call_logs
      WHERE created_at >= now() - interval '24 hours'
      GROUP BY provider_id
    `);
    const parseUtc = (value: string | null): Date | null => (value ? new Date(`${value.replace(' ', 'T')}Z`) : null);
    const stats: Record<string, ProviderCallStats> = {};
    for (const row of result.rows as Array<Record<string, unknown>>) {
      const cast = row as { providerId: string; lastSuccessAt: string | null; lastFailureAt: string | null; lastCallAt: string | null };
      stats[cast.providerId] = {
        lastSuccessAt: parseUtc(cast.lastSuccessAt),
        lastFailureAt: parseUtc(cast.lastFailureAt),
        lastCallAt: parseUtc(cast.lastCallAt),
      };
    }
    return stats;
  }

  /** Clears probe cooldowns only (unit tests). */
  protected clearProbeCooldowns(): void {
    this.lastProbeAt.clear();
  }

  /** Clears probe cooldowns + consecutive-failure counts (unit tests). */
  protected clearProbeState(): void {
    this.clearProbeCooldowns();
    this.probeFailures.clear();
  }

  /** SELECT 1 ping; returns latency ms. */
  protected async pingDb(): Promise<number> {
    const startedAt = Date.now();
    await db.execute(sql`SELECT 1`);
    return Date.now() - startedAt;
  }

  /** pg pool stats via the existing `getPoolRef()` export. */
  protected getPoolStats(): PoolStats {
    const pool = getPoolRef();
    return { poolTotal: pool.totalCount, poolIdle: pool.idleCount, poolWaiting: pool.waitingCount };
  }

  private readIntervalMs(): number {
    const raw = process.env.MONITORING_HEALTH_INTERVAL_MS;
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed >= 1000 ? parsed : 60_000;
  }

  private memoryThresholdBytes(): number {
    const raw = process.env.MONITORING_MEMORY_THRESHOLD_MB;
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return (Number.isFinite(parsed) && parsed > 0 ? parsed : 1536) * 1024 * 1024;
  }

  /**
   * Event-loop lag p95 + max over the last cycle (the histogram is reset after
   * each read, so the window ≈ the check interval). monitorEventLoopDelay values
   * are in **nanoseconds** (nodejs.org/api/perf_hooks.html) — ms = /1e6. The
   * original /1000 assumed µs and read every value 1000× too large, so the 250 ms
   * threshold effectively became 250 µs and a healthy process check degraded on
   * every machine (P1-05 finding 11). Max is published alongside p95 so P2-01
   * rules can alert on isolated stalls that p95 misses (a single long block
   * yields one coalesced sample — nodejs/node#34661). NaN-guarded (empty
   * histogram → 0).
   */
  private readEventLoopLagMs(): { lagP95Ms: number; lagMaxMs: number } {
    try {
      const p95Ns = this.eventLoopDelay.percentile(95);
      const maxNs = this.eventLoopDelay.max;
      this.eventLoopDelay.reset();
      const toMs = (ns: number): number =>
        Number.isNaN(ns) ? 0 : Math.round(ns / 1e6);
      return { lagP95Ms: toMs(p95Ns), lagMaxMs: toMs(maxNs) };
    } catch {
      return { lagP95Ms: 0, lagMaxMs: 0 };
    }
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    return Promise.race([
      promise.finally(() => clearTimeout(timer)),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
        timer.unref?.();
      }),
    ]);
  }
}
