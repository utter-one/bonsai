import 'reflect-metadata';
import { inject, singleton } from 'tsyringe';
import { inArray, sql } from 'drizzle-orm';
import { db } from '../../db';
import { alertEvents, fallbackEvents, providerCallLogs, providers } from '../../db/schema';
import { logger } from '../../utils/logger';
import { generateId } from '../../utils/idGenerator';
import { getRateLimitRejectionStats, type RateLimitRejectionKeyStats } from '../../http/middleware/rateLimiter';
import { HealthCheckService } from './HealthCheckService';
import { CircuitBreakerRegistry } from './CircuitBreakerRegistry';
import { MetricsRegistry, type MetricsSnapshot } from './MetricsRegistry';
import { MonitoringConfigService } from './MonitoringConfigService';
import { monitoringConfigSchema, type MonitoringConfig } from '../../http/contracts/monitoring';
import {
  ALERT_EVENT_PUBLISHER_TOKEN,
  type AlertEvent,
  type AlertEventPublisher,
} from './AlertEventPublisher';
import {
  DEFAULT_RULES,
  RULE_MAP,
  type AlertRuleDef,
  type EvaluationData,
  type HealthSnapshot,
  type ProviderLastSignal,
  type ProviderWindowStats,
  type RuleParams,
  type RuleSeverity,
  type RuleVerdict,
} from './AlertEvents';

/**
 * Alert rule engine (P2-01).
 *
 * Runs a pass every `engineIntervalMinutes` (config) or
 * `MONITORING_ALERT_ENGINE_INTERVAL_MS` (env seam, tests): assembles
 * `EvaluationData` once, evaluates every enabled rule, and drives the
 * anti-flap state machine (ok → pending → firing → resolved) per alert key.
 *
 * Design notes (see the P2-01 spec for the full findings list):
 * - Windowed counter reads come from an in-memory per-series delta ring
 *   (finding 1) — metric-based rules keep firing while the DB is down.
 * - `alert_events.scope_key` stores the FULL key `ruleId:scopePart`
 *   (finding 5); the in-memory state map is keyed by the same string.
 * - Tracked keys always get a verdict (synthesized not-met when their data
 *   disappeared) so firing alerts can resolve (findings 11/13).
 * - The publisher is behind a DI token seam; the engine never touches the
 *   table directly (finding 10) and never throws from fire-and-forget
 *   publisher calls (finding 18).
 */

type KeyStatus = 'ok' | 'pending' | 'firing' | 'resolved';

interface KeyState {
  status: KeyStatus;
  pendingSince: number | null;
  firingSince: number | null;
  lastFiredAt: number | null;
  goodStreak: number;
  alertId: string | null;
  scope: Record<string, unknown>;
  message: string;
  context: Record<string, unknown>;
  severity: RuleSeverity;
}

/** Firing alert row as returned by startup reconciliation (finding 12). */
export type FiringAlertRow = {
  id: string;
  ruleId: string;
  scopeKey: string;
  scope: Record<string, unknown> | null;
  severity: string;
  message: string;
  context: Record<string, unknown> | null;
  firedAt: Date;
};

/**
 * Data providers — overridable in unit tests (fakes). The production
 * defaults are the SQL queries + in-memory stats (finding 19: each source
 * is queried inside its own try/catch so one failure degrades only the
 * rules that depend on it).
 */
/**
 * How far back the "last observed signal" lookup reaches (provider-auth-failed
 * persistence branch). 24 h comfortably exceeds the rule's maxUnresolvedHours
 * (6 h) safety valve, and bounds the scan to one day of call logs.
 */
const LAST_SIGNAL_LOOKBACK_MS = 24 * 60 * 60_000;

export type AlertEngineDataProviders = {
  getRejectionStats: () => { total: number; topKeys: RateLimitRejectionKeyStats[] };
  getBreakers: () => Map<string, 'open'>; // P3-01 seam — empty in Phase 2
  queryProviderWindows: (sinceIso: string) => Promise<ProviderWindowStats[]>;
  queryProviderLastSignals: (sinceIso: string) => Promise<ProviderLastSignal[]>;
  queryFallbackCounts: (sinceIso: string) => Promise<{ providerId: string; count: number; fallbackIds: string[] }[]>;
  queryProviderNames: (ids: string[]) => Promise<Map<string, { name: string; providerType: string }>>;
  listFiringAlerts: () => Promise<FiringAlertRow[]>;
};

const WINDOWED_COUNTERS = ['api_requests_total', 'rate_limit_rejections_total', 'oauth_refresh_total', 'imap_poll_total', 'provider_chain_exhausted_total'] as const;

/**
 * Counters whose `provider_id`-labeled series must enter the per-provider
 * evaluation set even when no call-log row, fallback-event row, or breaker
 * state exists for the provider (P3-06: a chain exhaustion on a
 * single-provider chain leaves no fallback_events row).
 */
const PROVIDER_ID_COUNTERS = ['oauth_refresh_total', 'imap_poll_total', 'provider_chain_exhausted_total'] as const;
const MIN_INTERVAL_MS = 1000;
const FALLBACK_INTERVAL_MS = 60_000;

/** Decode a `k=v,k=v` series key (alphabetically sorted, values stringified). */
export function parseSeriesKey(key: string): Record<string, string> {
  if (key === '') return {};
  const out: Record<string, string> = {};
  for (const pair of key.split(',')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    out[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return out;
}

const labelsMatch = (seriesLabels: Record<string, string>, filter: Record<string, string>): boolean =>
  Object.entries(filter).every(([k, v]) => seriesLabels[k] === v);

const defaultScope = (rule: AlertRuleDef, scopePart: string): Record<string, unknown> => {
  if (rule.scope === 'per_provider') return { providerId: scopePart };
  if (scopePart === 'global') return {};
  if (scopePart.startsWith('key:')) return { keyHash: scopePart.slice('key:'.length) };
  if (scopePart.startsWith('heartbeat:')) return { service: scopePart.slice('heartbeat:'.length) };
  return { scope: scopePart };
};

@singleton()
export class AlertRuleEngine {
  private timer: NodeJS.Timeout | undefined;
  private currentIntervalMs = FALLBACK_INTERVAL_MS;
  private isProcessing = false;
  private hasReconciled = false;
  private configLoadFailed = false;

  /** In-memory anti-flap state, keyed by the FULL `ruleId:scopePart` key (finding 5). */
  private readonly states = new Map<string, KeyState>();
  /** Previous pass's `db` health status — `db-down` needs 2 consecutive passes (finding 4). */
  private previousDbCheckStatus: string | null = null;

  // Delta ring (finding 1): fullKey `counterName|seriesKey` → per-pass deltas.
  private readonly prevCounterValues = new Map<string, number>();
  private readonly ring = new Map<string, { ts: number; delta: number }[]>();

  private dataProviders: AlertEngineDataProviders;
  private nowProvider = () => Date.now();
  /** Test seam (e2e): override the config source (app-world singletons can live in a different module graph). */
  private configProviderForTests: (() => Promise<MonitoringConfig>) | null = null;

  constructor(
    @inject(MetricsRegistry) private readonly metricsRegistry: MetricsRegistry,
    @inject(HealthCheckService) private readonly healthCheckService: HealthCheckService,
    @inject(MonitoringConfigService) private readonly monitoringConfigService: MonitoringConfigService,
    @inject(ALERT_EVENT_PUBLISHER_TOKEN) private readonly publisher: AlertEventPublisher,
    @inject(CircuitBreakerRegistry) private readonly breakerRegistry: CircuitBreakerRegistry,
  ) {
    this.dataProviders = this.productionDataProviders();
  }

  start(): void {
    if (this.timer) return;
    this.currentIntervalMs = this.readEnvIntervalMs() ?? FALLBACK_INTERVAL_MS;
    logger.info({ intervalMs: this.currentIntervalMs }, 'Starting AlertRuleEngine (alert rule evaluation loop)');
    void this.runPass(); // first pass immediately — startup reconciliation + no blind spot
    this.timer = setInterval(() => {
      void this.runPass();
    }, this.currentIntervalMs);
  }

  /** Stops the loop (P1-09 shutdown hook). */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
      logger.info('AlertRuleEngine stopped');
    }
  }

  // ---------------------------------------------------------------------
  // Pass orchestration
  // ---------------------------------------------------------------------

  /** Test seam (unit + e2e): run one pass synchronously. */
  async runNow(): Promise<void> {
    await this.runPass();
  }

  private async runPass(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    const now = this.nowProvider();
    try {
      const config = await this.loadConfig(now);
      this.readoptInterval(config);
      const data = await this.assembleData(now, config);
      this.sampleRing(data.metrics, now, config);
      if (!this.hasReconciled) {
        await this.reconcileStartup(now, config);
        this.hasReconciled = true;
      }
      for (const rule of DEFAULT_RULES) {
        const effective = this.effectiveRule(rule, config);
        if (!effective.enabled) continue;
        this.evaluateRule(rule, effective.severity, effective.params, data, now);
      }
      this.previousDbCheckStatus = data.health.checks.find((c) => c.name === 'db')?.status ?? null;
    } catch (error) {
      logger.error({ error }, 'AlertRuleEngine pass failed');
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Config load failure (e.g. DB down at boot) degrades to schema defaults —
   * the engine must keep working on in-memory sources (finding 19).
   */
  private async loadConfig(now: number): Promise<MonitoringConfig> {
    if (this.configProviderForTests) {
      try {
        return await this.configProviderForTests();
      } catch (error) {
        logger.error({ error, now }, 'AlertRuleEngine: test config provider failed — using schema defaults for this pass');
        return monitoringConfigSchema.parse({});
      }
    }
    try {
      return await this.monitoringConfigService.get();
    } catch (error) {
      if (!this.configLoadFailed) {
        logger.error({ error, now }, 'AlertRuleEngine: monitoring config load failed — using schema defaults until it succeeds');
        this.configLoadFailed = true;
      }
      return monitoringConfigSchema.parse({});
    }
  }

  /**
   * Env seam wins for the whole process (tests); otherwise the config's
   * `engineIntervalMinutes` is re-adopted live (rescheduled on change).
   */
  private readonly readEnvIntervalMs = (): number | null => {
    const raw = process.env.MONITORING_ALERT_ENGINE_INTERVAL_MS;
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed >= MIN_INTERVAL_MS ? parsed : null;
  };

  private readonly readoptInterval = (config: MonitoringConfig): void => {
    if (this.readEnvIntervalMs() !== null) return;
    const configMs = config.alerting.engineIntervalMinutes * 60_000;
    if (configMs === this.currentIntervalMs || !this.timer) return;
    this.currentIntervalMs = configMs;
    this.timer = setInterval(() => {
      void this.runPass();
    }, configMs);
    logger.info({ intervalMs: configMs }, 'AlertRuleEngine: engine interval re-adopted from monitoring config');
  };

  /** Effective params: config override > `alerting.defaultCooldownMinutes` > rule default (finding 8). */
  private effectiveRule(rule: AlertRuleDef, config: MonitoringConfig): { enabled: boolean; severity: RuleSeverity; params: RuleParams } {
    const ov = config.rules[rule.id] ?? {};
    const params: RuleParams = {
      threshold: ov.threshold ?? rule.defaultParams.threshold,
      windowMinutes: ov.windowMinutes ?? rule.defaultParams.windowMinutes,
      minSamples: ov.minSamples ?? rule.defaultParams.minSamples,
      forMinutes: ov.forMinutes ?? rule.defaultParams.forMinutes,
      resolveAfterGoodChecks: ov.resolveAfterGoodChecks ?? rule.defaultParams.resolveAfterGoodChecks,
      cooldownMinutes: ov.cooldownMinutes ?? config.alerting.defaultCooldownMinutes ?? rule.defaultParams.cooldownMinutes,
      maxUnresolvedHours: ov.maxUnresolvedHours ?? rule.defaultParams.maxUnresolvedHours,
    };
    return { enabled: ov.enabled ?? true, severity: ov.severity ?? rule.severity, params };
  }

  // ---------------------------------------------------------------------
  // Data assembly
  // ---------------------------------------------------------------------

  private async assembleData(now: number, config: MonitoringConfig): Promise<EvaluationData> {
    const metrics = this.metricsRegistry.snapshot();
    const health: HealthSnapshot = this.healthCheckService.getSnapshot();
    const probeFailures = this.healthCheckService.getProbeFailureCounts();
    const breakers = this.dataProviders.getBreakers();

    // Distinct windows across the enabled per-provider call-log rules — one
    // aggregate query per distinct window, not per rule (implementation note).
    const windowsMs = new Set<number>();
    for (const rule of DEFAULT_RULES) {
      if (rule.scope !== 'per_provider') continue;
      if (config.rules[rule.id]?.enabled === false) continue;
      windowsMs.add((config.rules[rule.id]?.windowMinutes ?? rule.defaultParams.windowMinutes) * 60_000);
    }

    const callLogs = new Map<number, Map<string, ProviderWindowStats>>();
    let providerLastSignals = new Map<string, ProviderLastSignal>();
    let fallbackEventCounts = new Map<string, number>();
    let fallbackChains = new Map<string, string[]>();
    try {
      const perWindow = await Promise.all(
        [...windowsMs].map(async (windowMs) => {
          const stats = await this.dataProviders.queryProviderWindows(new Date(now - windowMs).toISOString());
          return [windowMs, new Map(stats.map((s) => [s.providerId, s]))] as const;
        }),
      );
      for (const [windowMs, byProvider] of perWindow) callLogs.set(windowMs, byProvider);
    } catch (error) {
      logger.error({ error }, 'AlertRuleEngine: provider call/fallback data unavailable — dependent rules evaluate to not-met this pass');
    }

    try {
      const signals = await this.dataProviders.queryProviderLastSignals(new Date(now - LAST_SIGNAL_LOOKBACK_MS).toISOString());
      providerLastSignals = new Map(signals.map((s) => [s.providerId, s]));
    } catch (error) {
      logger.error({ error }, 'AlertRuleEngine: provider last-signal data unavailable — provider-auth-failed persists via the windowed count only this pass');
    }

    try {
      const fbSinceIso = new Date(now - Math.max(10 * 60_000, ...windowsMs)).toISOString();
      const fallbackRows = await this.dataProviders.queryFallbackCounts(fbSinceIso);
      fallbackEventCounts = new Map(fallbackRows.map((r) => [r.providerId, r.count]));
      fallbackChains = new Map(fallbackRows.map((r) => [r.providerId, r.fallbackIds]));
    } catch (error) {
      logger.error({ error }, 'AlertRuleEngine: provider call/fallback data unavailable — dependent rules evaluate to not-met this pass');
    }

    // Provider ids needing names: everything entering the per-provider
    // evaluation set this pass (finding 7/11).
    const ids = new Set<string>();
    for (const byProvider of callLogs.values()) for (const id of byProvider.keys()) ids.add(id);
    for (const id of providerLastSignals.keys()) ids.add(id); // a provider whose only recent trace is an old signal still evaluates
    for (const id of probeFailures.keys()) ids.add(id);
    for (const id of fallbackEventCounts.keys()) ids.add(id);
    for (const chain of fallbackChains.values()) for (const id of chain) ids.add(id); // P3-06: name the fallbacks in chain context
    for (const id of breakers.keys()) ids.add(id);
    for (const counterName of PROVIDER_ID_COUNTERS) {
      for (const seriesKey of Object.keys(metrics.counters[counterName] ?? {})) {
        const labels = parseSeriesKey(seriesKey);
        if (labels.provider_id) ids.add(labels.provider_id);
      }
    }
    for (const [key, state] of this.states) {
      if (state.status !== 'pending' && state.status !== 'firing') continue;
      const ruleId = key.slice(0, key.indexOf(':'));
      if (RULE_MAP.get(ruleId)?.scope === 'per_provider') ids.add(key.slice(key.indexOf(':') + 1));
    }

    let providerNames = new Map<string, { name: string; providerType: string }>();
    try {
      providerNames = await this.dataProviders.queryProviderNames([...ids]);
    } catch (error) {
      logger.error({ error }, 'AlertRuleEngine: provider name lookup failed — using raw provider ids in messages');
    }

    return {
      now,
      metrics,
      windowSum: (name, labels, windowMs) => this.ringSum(name, labels, windowMs, now),
      health,
      previousDbCheckStatus: this.previousDbCheckStatus,
      providerNames,
      callLogs,
      providerLastSignals,
      breakers,
      probeFailures,
      fallbackEventCounts,
      fallbackChains,
      rejections: { topKeys: this.dataProviders.getRejectionStats().topKeys },
    };
  }

  // ---------------------------------------------------------------------
  // Rule evaluation
  // ---------------------------------------------------------------------

  private evaluateRule(
    rule: AlertRuleDef,
    severity: RuleSeverity,
    params: RuleParams,
    data: EvaluationData,
    now: number,
  ): void {
    if (rule.scope === 'per_provider') {
      const parts = this.perProviderScopeParts(data);
      const failedParts = new Set<string>();
      for (const part of parts) {
        const verdict = this.runEvaluator(rule, params, data, part);
        if (verdict === null) {
          failedParts.add(part); // evaluator threw — no state change, no synthesis
          continue;
        }
        this.processKey(rule, severity, part, verdict, params, now);
      }
      this.synthesizeMissingVerdicts(rule, severity, params, parts, failedParts, now);
      return;
    }

    let verdicts: RuleVerdict[];
    try {
      verdicts = rule.evaluate(data, params);
    } catch (error) {
      logger.error({ error, ruleId: rule.id }, 'AlertRuleEngine: rule evaluation threw — rule skipped this pass');
      this.synthesizeMissingVerdicts(rule, severity, params, new Set<string>(), new Set<string>(), now);
      return;
    }
    const seen = new Set<string>();
    for (const verdict of verdicts) {
      const part = verdict.scopePart ?? 'global';
      seen.add(part);
      this.processKey(rule, severity, part, verdict, params, now);
    }
    this.synthesizeMissingVerdicts(rule, severity, params, seen, new Set<string>(), now);
  }

  /** The per-provider evaluation set this pass (finding 11). */
  private perProviderScopeParts(data: EvaluationData): Set<string> {
    const parts = new Set<string>();
    for (const byProvider of data.callLogs.values()) for (const id of byProvider.keys()) parts.add(id);
    for (const id of data.providerLastSignals.keys()) parts.add(id); // old-signal-only providers must still evaluate (auth persistence)
    for (const id of data.breakers.keys()) parts.add(id);
    for (const id of data.probeFailures.keys()) parts.add(id);
    for (const id of data.fallbackEventCounts.keys()) parts.add(id);
    for (const counterName of PROVIDER_ID_COUNTERS) {
      for (const seriesKey of Object.keys(data.metrics.counters[counterName] ?? {})) {
        const labels = parseSeriesKey(seriesKey);
        if (labels.provider_id) parts.add(labels.provider_id);
      }
    }
    // Tracked keys are always re-evaluated so their alerts can resolve.
    for (const [key, state] of this.states) {
      if (state.status !== 'pending' && state.status !== 'firing') continue;
      const ruleId = key.slice(0, key.indexOf(':'));
      if (RULE_MAP.get(ruleId)?.scope === 'per_provider') parts.add(key.slice(key.indexOf(':') + 1));
    }
    return parts;
  }

  /**
   * Tracked (pending/firing) scope parts that received no verdict this pass
   * — their data disappeared, which is treated as not-met so the alert can
   * resolve (findings 11/13). Parts whose evaluator threw are excluded: a
   * transient error must not count as a good evaluation.
   */
  private synthesizeMissingVerdicts(
    rule: AlertRuleDef,
    severity: RuleSeverity,
    params: RuleParams,
    seen: Set<string>,
    failed: Set<string>,
    now: number,
  ): void {
    const prefix = `${rule.id}:`;
    for (const [key, state] of this.states) {
      if (state.status !== 'pending' && state.status !== 'firing') continue;
      if (!key.startsWith(prefix)) continue;
      const part = key.slice(prefix.length);
      if (seen.has(part) || failed.has(part)) continue;
      this.processKey(rule, severity, part, { met: false }, params, now);
    }
  }

  private runEvaluator(rule: AlertRuleDef, params: RuleParams, data: EvaluationData, providerId: string): RuleVerdict | null {
    try {
      const verdicts = rule.evaluate(data, params, providerId);
      return verdicts[0] ?? null;
    } catch (error) {
      logger.error({ error, ruleId: rule.id, providerId }, 'AlertRuleEngine: rule evaluation threw — key skipped this pass');
      return null;
    }
  }

  // ---------------------------------------------------------------------
  // Anti-flap state machine (ok → pending → firing → resolved)
  // ---------------------------------------------------------------------

  private processKey(
    rule: AlertRuleDef,
    severity: RuleSeverity,
    scopePart: string,
    verdict: RuleVerdict,
    params: RuleParams,
    now: number,
  ): void {
    const key = `${rule.id}:${scopePart}`;
    let state = this.states.get(key);
    if (!state) {
      state = {
        status: 'ok',
        pendingSince: null,
        firingSince: null,
        lastFiredAt: null,
        goodStreak: 0,
        alertId: null,
        scope: defaultScope(rule, scopePart),
        message: rule.id,
        context: {},
        severity,
      };
      this.states.set(key, state);
    }
    state.severity = severity;

    // maxUnresolvedHours safety valve — first, even while the condition still holds (finding 12).
    if (state.status === 'firing' && state.firingSince !== null && now - state.firingSince >= params.maxUnresolvedHours * 3_600_000) {
      this.resolveKey(key, state, now, 'max_unresolved_hours');
      if (verdict.met) {
        state.status = 'pending';
        state.pendingSince = now;
        state.goodStreak = 0;
      }
      return;
    }

    if (verdict.met) {
      state.goodStreak = 0;
      if (verdict.message) state.message = verdict.message;
      if (verdict.context) state.context = { ...verdict.context };
      state.scope = { ...defaultScope(rule, scopePart), ...(verdict.scopeDetails ?? {}) };
      if (state.status === 'ok' || state.status === 'resolved') {
        state.status = 'pending';
        state.pendingSince = now;
      }
      if (state.status === 'pending') {
        // forMinutes 0 ⇒ fire on the first met pass; forMinutes N ⇒ sustained
        // across N minutes of pending passes.
        const sustained = now - (state.pendingSince ?? now) >= params.forMinutes * 60_000;
        const cooldownElapsed = state.lastFiredAt === null || now - state.lastFiredAt >= params.cooldownMinutes * 60_000;
        if (sustained && cooldownElapsed) this.fireKey(state, key, now);
      }
      // firing: the condition staying true never re-fires (anti-flap).
    } else {
      if (state.status === 'pending') {
        state.status = 'ok';
        state.pendingSince = null;
        state.goodStreak = 0;
      } else if (state.status === 'firing') {
        state.goodStreak += 1;
        if (state.goodStreak >= params.resolveAfterGoodChecks) this.resolveKey(key, state, now, 'auto');
      } else {
        state.goodStreak = 0;
      }
    }
  }

  // ---------------------------------------------------------------------
  // Fire / resolve (publisher seam — finding 10/18)
  // ---------------------------------------------------------------------

  private fireKey(state: KeyState, key: string, now: number): void {
    const event: AlertEvent = {
      id: generateId('alrt'),
      ruleId: key.slice(0, key.indexOf(':')),
      scopeKey: key,
      scope: state.scope,
      severity: state.severity,
      message: state.message,
      context: state.context,
      firedAt: new Date(now),
    };
    state.status = 'firing';
    state.firingSince = now;
    state.lastFiredAt = now;
    state.alertId = event.id;
    // Double guard (finding 18): the publisher must never throw, but the
    // fire-and-forget call is caught defensively anyway.
    void this.publisher.fire(event).catch((error) => {
      logger.error({ error, alertId: event.id, scopeKey: key }, 'AlertRuleEngine: publisher.fire failed (fire-and-forget)');
    });
  }

  private resolveKey(key: string, state: KeyState, now: number, reason: 'auto' | 'max_unresolved_hours' | 'engine_restart'): void {
    if (state.alertId) {
      const event: AlertEvent = {
        id: state.alertId,
        ruleId: key.slice(0, key.indexOf(':')),
        scopeKey: key,
        scope: state.scope,
        severity: state.severity,
        message: state.message,
        context: { ...state.context, resolutionReason: reason },
        firedAt: new Date(state.firingSince ?? now),
        resolvedAt: new Date(now),
      };
      void this.publisher.resolve(event).catch((error) => {
        logger.error({ error, alertId: state.alertId, scopeKey: key }, 'AlertRuleEngine: publisher.resolve failed (fire-and-forget)');
      });
    }
    state.status = 'resolved';
    state.pendingSince = null;
    state.firingSince = null;
    state.goodStreak = 0;
    state.alertId = null;
  }

  // ---------------------------------------------------------------------
  // Startup reconciliation (finding 12)
  // ---------------------------------------------------------------------

  /**
   * First pass only: state is in-memory, so a restart orphans `firing` rows
   * that nothing else would resolve. Orphans older than their rule's
   * `maxUnresolvedHours` are resolved (context `engine-restart`); younger
   * ones are kept (the new engine may re-fire under the same key later).
   */
  private async reconcileStartup(now: number, config: MonitoringConfig): Promise<void> {
    let orphans: FiringAlertRow[];
    try {
      orphans = await this.dataProviders.listFiringAlerts();
    } catch (error) {
      logger.error({ error }, 'AlertRuleEngine: startup reconciliation query failed — skipping');
      return;
    }
    for (const row of orphans) {
      const rule = RULE_MAP.get(row.ruleId);
      if (!rule) continue;
      const params = this.effectiveRule(rule, config).params;
      if (now - row.firedAt.getTime() < params.maxUnresolvedHours * 3_600_000) continue;
      const event: AlertEvent = {
        id: row.id,
        ruleId: row.ruleId,
        scopeKey: row.scopeKey,
        scope: row.scope ?? {},
        severity: (row.severity as RuleSeverity) ?? 'warning',
        message: row.message,
        context: { ...(row.context ?? {}), resolutionReason: 'engine_restart' },
        firedAt: row.firedAt,
        resolvedAt: new Date(now),
      };
      void this.publisher.resolve(event).catch((error) => {
        logger.error({ error, alertId: row.id }, 'AlertRuleEngine: startup reconciliation resolve failed (fire-and-forget)');
      });
      logger.warn({ alertId: row.id, scopeKey: row.scopeKey }, 'AlertRuleEngine: resolved orphaned firing alert from a previous process lifetime (max_unresolved_hours exceeded)');
    }
  }

  // ---------------------------------------------------------------------
  // Delta ring — windowed counter reads (finding 1)
  // ---------------------------------------------------------------------

  private sampleRing(metrics: MetricsSnapshot, now: number, config: MonitoringConfig): void {
    const retainMs = Math.max(60 * 60_000, this.maxWindowMs(config)) + 2 * this.currentIntervalMs;
    const cutoff = now - retainMs;
    for (const name of WINDOWED_COUNTERS) {
      const series = metrics.counters[name];
      if (!series) continue;
      for (const [seriesKey, value] of Object.entries(series)) {
        const fullKey = `${name}|${seriesKey}`;
        const prev = this.prevCounterValues.get(fullKey);
        const delta = prev === undefined ? value.count : Math.max(0, value.count - prev);
        this.prevCounterValues.set(fullKey, value.count);
        let deque = this.ring.get(fullKey);
        if (!deque) {
          deque = [];
          this.ring.set(fullKey, deque);
        }
        deque.push({ ts: now, delta });
        while (deque.length > 0 && deque[0].ts < cutoff) deque.shift();
      }
    }
  }

  private ringSum(name: string, labels: Record<string, string>, windowMs: number, now: number): number {
    const cutoff = now - windowMs;
    const prefix = `${name}|`;
    let sum = 0;
    for (const [fullKey, deque] of this.ring.entries()) {
      if (!fullKey.startsWith(prefix)) continue;
      if (!labelsMatch(parseSeriesKey(fullKey.slice(prefix.length)), labels)) continue;
      for (const entry of deque) {
        if (entry.ts >= cutoff) sum += entry.delta;
      }
    }
    return sum;
  }

  /** Largest evaluation window among enabled rules — sizes the ring retention. */
  private maxWindowMs(config: MonitoringConfig): number {
    let max = 60_000;
    for (const rule of DEFAULT_RULES) {
      if (config.rules[rule.id]?.enabled === false) continue;
      const windowMinutes = config.rules[rule.id]?.windowMinutes ?? rule.defaultParams.windowMinutes;
      max = Math.max(max, windowMinutes * 60_000);
    }
    return max;
  }

  // ---------------------------------------------------------------------
  // Test seams + production data providers
  // ---------------------------------------------------------------------

  /** Test seam (unit): override data providers (fakes). */
  setDataProviders(providers: Partial<AlertEngineDataProviders>): void {
    this.dataProviders = { ...this.dataProviders, ...providers };
  }

  /** Test seam (unit): override the clock. */
  setNowProviderForTests(provider: () => number): void {
    this.nowProvider = provider;
  }

  /** Test seam (e2e): override the config source. Pass null to restore production behavior. */
  setConfigProviderForTests(provider: (() => Promise<MonitoringConfig>) | null): void {
    this.configProviderForTests = provider;
  }

  /** Test seam (unit): read the delta ring directly (finding 1). */
  ringSumForTests(name: string, labels: Record<string, string>, windowMs: number): number {
    return this.ringSum(name, labels, windowMs, this.nowProvider());
  }

  private productionDataProviders(): AlertEngineDataProviders {
    return {
      getRejectionStats: () => getRateLimitRejectionStats(),
      getBreakers: () => new Map(this.breakerRegistry.openProviderIds().map((providerId) => [providerId, 'open'] as const)),
      queryProviderWindows: async (sinceIso) => {
        const rows = (await db.execute(sql`
          WITH base AS (
            SELECT
              provider_id,
              ok,
              error_code,
              duration_ms,
              (metrics ->> 'ttftMs')::double precision AS ttft_ms,
              (metrics ->> 'maxChunkGapMs')::double precision AS max_gap_ms,
              (metrics ->> 'audioDurationMs')::double precision AS audio_ms,
              (metrics ->> 'eosToFinalMs')::double precision AS eos_ms,
              metrics ->> 'errorPhase' AS error_phase
            FROM provider_call_logs
            WHERE created_at >= ${sinceIso}
          ),
          errors_by_code AS (
            SELECT provider_id, error_code, count(*) AS cnt
            FROM base
            WHERE NOT ok AND error_code IS NOT NULL
            GROUP BY provider_id, error_code
          ),
          errors_agg AS (
            SELECT provider_id, jsonb_object_agg(error_code, cnt) AS error_counts
            FROM errors_by_code
            GROUP BY provider_id
          )
          SELECT
            b.provider_id AS provider_id,
            count(*) AS calls,
            count(*) FILTER (WHERE NOT b.ok) AS errors,
            COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY b.duration_ms), 0) AS p95_duration_ms,
            count(*) FILTER (WHERE b.ttft_ms IS NOT NULL) AS ttft_rows,
            percentile_cont(0.50) WITHIN GROUP (ORDER BY b.ttft_ms) FILTER (WHERE b.ttft_ms IS NOT NULL) AS ttft_p50,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY b.ttft_ms) FILTER (WHERE b.ttft_ms IS NOT NULL) AS ttft_p95,
            percentile_cont(0.99) WITHIN GROUP (ORDER BY b.ttft_ms) FILTER (WHERE b.ttft_ms IS NOT NULL) AS ttft_p99,
            count(*) FILTER (WHERE b.max_gap_ms IS NOT NULL) AS gap_rows,
            count(*) FILTER (WHERE b.max_gap_ms > 10000) AS stalled_rows,
            count(*) FILTER (WHERE b.audio_ms IS NOT NULL) AS audio_rows,
            count(*) FILTER (WHERE b.audio_ms IS NOT NULL AND b.duration_ms > b.audio_ms) AS rtf_over_rows,
            count(*) FILTER (WHERE b.eos_ms IS NOT NULL) AS eos_rows,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY b.eos_ms) FILTER (WHERE b.eos_ms IS NOT NULL) AS eos_p95,
            count(*) FILTER (WHERE b.error_phase = 'mid_stream') AS mid_stream_rows,
            COALESCE(e.error_counts, '{}'::jsonb) AS error_counts
          FROM base b
          LEFT JOIN errors_agg e ON e.provider_id = b.provider_id
          GROUP BY b.provider_id, e.error_counts
        `)).rows as Array<Record<string, unknown>>;
        return rows.map((r) => {
          const calls = Number(r.calls);
          const errors = Number(r.errors);
          return {
            providerId: String(r.provider_id),
            calls,
            errors,
            errorRate: calls > 0 ? errors / calls : 0,
            p95DurationMs: Number(r.p95_duration_ms),
            errorCounts: (r.error_counts ?? {}) as Record<string, number>,
            ttftRows: Number(r.ttft_rows),
            ttftP50Ms: r.ttft_p50 === null ? null : Number(r.ttft_p50),
            ttftP95Ms: r.ttft_p95 === null ? null : Number(r.ttft_p95),
            ttftP99Ms: r.ttft_p99 === null ? null : Number(r.ttft_p99),
            gapRows: Number(r.gap_rows),
            stalledRows: Number(r.stalled_rows),
            audioRows: Number(r.audio_rows),
            rtfOverRows: Number(r.rtf_over_rows),
            eosRows: Number(r.eos_rows),
            eosP95Ms: r.eos_p95 === null ? null : Number(r.eos_p95),
            midStreamRows: Number(r.mid_stream_rows),
          };
        });
      },
      queryProviderLastSignals: async (sinceIso) => {
        // One row per provider: the most recent call-log row in the lookback
        // horizon (any operation — real calls and probe pings alike). The
        // (provider_id, created_at) index serves the DISTINCT ON ordering.
        const rows = (await db.execute(sql`
          SELECT DISTINCT ON (provider_id)
            provider_id,
            created_at,
            ok,
            error_code
          FROM provider_call_logs
          WHERE created_at >= ${sinceIso}
          ORDER BY provider_id, created_at DESC, id DESC
        `)).rows as Array<Record<string, unknown>>;
        return rows.map((r) => ({
          providerId: String(r.provider_id),
          at: new Date(r.created_at as string | Date),
          ok: Boolean(r.ok),
          errorCode: r.error_code === null ? null : String(r.error_code),
        }));
      },
      queryFallbackCounts: async (sinceIso) => {
        // Total row count per primary (fallback-active) plus the ordered
        // distinct fallback ids per primary (P3-06 chain naming context),
        // ordered by first appearance in the window.
        const rows = (await db.execute(sql`
          WITH fb AS (
            SELECT provider_id, fallback_provider_id, created_at
            FROM fallback_events
            WHERE created_at >= ${sinceIso}
          ),
          counts AS (
            SELECT provider_id, count(*) AS count
            FROM fb
            GROUP BY provider_id
          ),
          firsts AS (
            SELECT provider_id, fallback_provider_id, min(created_at) AS first_seen
            FROM fb
            GROUP BY provider_id, fallback_provider_id
          )
          SELECT c.provider_id, c.count, array_agg(f.fallback_provider_id ORDER BY f.first_seen) AS fallback_ids
          FROM counts c
          LEFT JOIN firsts f ON f.provider_id = c.provider_id
          GROUP BY c.provider_id, c.count
        `)).rows as Array<{ provider_id: string; count: string; fallback_ids: string[] | null }>;
        return rows.map((r) => ({ providerId: r.provider_id, count: Number(r.count), fallbackIds: r.fallback_ids ?? [] }));
      },
      queryProviderNames: async (ids) => {
        if (ids.length === 0) return new Map<string, { name: string; providerType: string }>();
        const rows = await db
          .select({ id: providers.id, name: providers.name, providerType: providers.providerType })
          .from(providers)
          .where(inArray(providers.id, ids));
        return new Map(rows.map((r) => [r.id, { name: r.name, providerType: r.providerType }]));
      },
      listFiringAlerts: async () => {
        // fired_at is a tz-less timestamp — fetch as text and mark UTC (house TZ convention).
        const rows = (await db.execute(sql`
          SELECT id, rule_id, scope_key, scope, severity, message, context, fired_at::text AS fired_at
          FROM alert_events
          WHERE status = 'firing'
        `)).rows as Array<Record<string, unknown>>;
        return rows.map((r) => ({
          id: String(r.id),
          ruleId: String(r.rule_id),
          scopeKey: String(r.scope_key),
          scope: (r.scope ?? null) as Record<string, unknown> | null,
          severity: String(r.severity),
          message: String(r.message),
          context: (r.context ?? null) as Record<string, unknown> | null,
          firedAt: new Date(`${String(r.fired_at).replace(' ', 'T')}Z`),
        }));
      },
    };
  }
}
