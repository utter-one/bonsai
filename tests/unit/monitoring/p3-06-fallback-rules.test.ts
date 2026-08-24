import 'reflect-metadata';
import { expect } from 'chai';
import { monitoringConfigSchema, type MonitoringConfig } from '../../../src/http/contracts/monitoring';
import { AlertRuleEngine, type AlertEngineDataProviders } from '../../../src/services/monitoring/AlertRuleEngine';
import type { AlertEvent, AlertEventPublisher } from '../../../src/services/monitoring/AlertEventPublisher';
import type { MetricsSnapshot } from '../../../src/services/monitoring/MetricsRegistry';
import { DEFAULT_RULES, type HealthSnapshot, type ProviderWindowStats } from '../../../src/services/monitoring/AlertEvents';

/**
 * P3-06 unit tests — fallback alert rules.
 *
 * Covers the new `provider-chain-exhausted` rule (windowed counter over the
 * delta ring), the per-provider scoping of `provider-auth-failed` and
 * `fallback-active` (spec acceptance criteria), and the chain naming context
 * added to their messages.
 *
 * Everything is faked: metrics snapshot, health snapshot, config service,
 * data providers, publisher, and the clock (same harness shape as P2-01).
 */

const MIN = 60_000;

const defaultConfig = (): MonitoringConfig => monitoringConfigSchema.parse({});

const emptyStats = (providerId: string): ProviderWindowStats => ({
  providerId,
  calls: 0,
  errors: 0,
  errorRate: 0,
  p95DurationMs: 0,
  errorCounts: {},
  ttftRows: 0,
  ttftP50Ms: null,
  ttftP95Ms: null,
  ttftP99Ms: null,
  gapRows: 0,
  stalledRows: 0,
  audioRows: 0,
  rtfOverRows: 0,
  eosRows: 0,
  eosP95Ms: null,
  midStreamRows: 0,
});

interface FakeCheck {
  name: string;
  status: string;
  latencyMs?: number;
  detail?: Record<string, unknown>;
}

class Harness {
  now = 1_700_000_000_000;
  fired: AlertEvent[] = [];
  resolved: AlertEvent[] = [];
  metrics: MetricsSnapshot = { counters: {}, gauges: {}, histograms: {} };
  healthChecks: FakeCheck[] = [
    { name: 'db', status: 'ok', detail: { poolTotal: 10, poolIdle: 10, poolWaiting: 0 } },
    { name: 'process', status: 'ok' },
  ];
  providerNames = new Map<string, { name: string; providerType: string }>();
  callLogs: ProviderWindowStats[] = [];
  fallbackCounts = new Map<string, number>();
  fallbackChains = new Map<string, string[]>();
  config: MonitoringConfig = defaultConfig();
  engine: AlertRuleEngine;

  constructor() {
    this.engine = new AlertRuleEngine(
      {
        snapshot: () => this.metrics,
        start: () => {},
        stop: () => {},
      } as never,
      {
        getSnapshot: (): HealthSnapshot => ({ checkedAt: new Date(), checks: this.healthChecks as never }),
        getProbeFailureCounts: () => new Map<string, number>(),
        getProbeFailures: () => 0,
        runNow: async () => {},
        start: () => {},
        stop: () => {},
      } as never,
      {
        get: async () => this.config,
        reload: async () => {},
        save: async () => {},
      } as never,
      {
        fire: async (event: AlertEvent) => {
          this.fired.push(event);
        },
        resolve: async (event: AlertEvent) => {
          this.resolved.push(event);
        },
      } as AlertEventPublisher,
    );
    this.engine.setNowProviderForTests(() => this.now);
    const providers: Partial<AlertEngineDataProviders> = {
      getRejectionStats: () => ({ total: 0, topKeys: [] }),
      getBreakers: () => new Map<string, 'open'>(),
      queryProviderWindows: async () => this.callLogs,
      queryFallbackCounts: async () => [...this.fallbackCounts.entries()].map(([providerId, count]) => ({ providerId, count, fallbackIds: this.fallbackChains.get(providerId) ?? [] })),
      queryProviderNames: async () => this.providerNames,
      listFiringAlerts: async () => [],
    };
    this.engine.setDataProviders(providers);
  }

  /** Run one engine pass after advancing the fake clock by `ms`. */
  async pass(ms = 0): Promise<void> {
    this.now += ms;
    await this.engine.runNow();
  }

  firedFor(scopeKey: string): AlertEvent[] {
    return this.fired.filter((e) => e.scopeKey === scopeKey);
  }

  resolvedFor(scopeKey: string): AlertEvent[] {
    return this.resolved.filter((e) => e.scopeKey === scopeKey);
  }

  /** Fast-fire rule config: no sustainment, resolve on first good pass. */
  fastFire(ruleId: string, extra: Record<string, unknown> = {}): void {
    this.config.rules[ruleId] = { forMinutes: 0, resolveAfterGoodChecks: 1, cooldownMinutes: 0, ...extra };
  }

  /** Increment the app-world-style exhaustion counter for a provider. */
  setExhausted(providerId: string, count: number): void {
    this.metrics.counters.provider_chain_exhausted_total = {
      ...(this.metrics.counters.provider_chain_exhausted_total ?? {}),
      [`provider_id=${providerId}`]: { count, sum: 0 },
    };
  }
}

describe('P3-06 fallback alert rules (unit)', () => {
  describe('rule catalog', () => {
    it('provider-chain-exhausted exists with the spec defaults', () => {
      const rule = DEFAULT_RULES.find((r) => r.id === 'provider-chain-exhausted');
      expect(rule).to.not.equal(undefined, 'provider-chain-exhausted must be a built-in rule');
      expect(rule!.scope).to.equal('per_provider');
      expect(rule!.severity).to.equal('critical');
      expect(rule!.defaultParams).to.deep.equal({
        threshold: 1,
        windowMinutes: 5,
        minSamples: 0,
        forMinutes: 0,
        resolveAfterGoodChecks: 3,
        cooldownMinutes: 10,
        maxUnresolvedHours: 12,
      });
    });
  });

  describe('provider-chain-exhausted', () => {
    it('fires on chain exhaustion in the window — even with no fallback_events rows (single-provider chain)', async () => {
      const h = new Harness();
      h.fastFire('provider-chain-exhausted');
      h.setExhausted('prov_x', 2);
      await h.pass();

      const rows = h.firedFor('provider-chain-exhausted:prov_x');
      expect(rows).to.have.length(1);
      expect(rows[0].severity).to.equal('critical');
      expect(rows[0].scope).to.deep.equal({ providerId: 'prov_x' });
      expect(rows[0].message).to.contain('exhausted its failover chain 2 time(s)');
      expect(rows[0].message).to.contain('prov_x');
      expect(rows[0].context.exhausted).to.equal(2);
      expect(rows[0].context.failoverChain).to.deep.equal(['prov_x']);
    });

    it('does not fire without exhaustion in the window', async () => {
      const h = new Harness();
      h.fastFire('provider-chain-exhausted');
      await h.pass();
      expect(h.firedFor('provider-chain-exhausted:prov_x')).to.be.empty;
    });

    it('excludes exhaustion that aged out of the window', async () => {
      const h = new Harness();
      h.fastFire('provider-chain-exhausted');
      h.setExhausted('prov_x', 1);
      await h.pass();
      expect(h.firedFor('provider-chain-exhausted:prov_x')).to.have.length(1);

      // Flat counter (delta 0) advanced past the whole 5-min window.
      await h.pass(6 * MIN);
      // Still tracked → synthesized not-met → resolves (fastFire: 1 good check).
      const resolved = h.resolvedFor('provider-chain-exhausted:prov_x');
      expect(resolved).to.have.length(1);
      expect(resolved[0].context.resolutionReason).to.equal('auto');
    });

    it('names the failover chain from the window\'s fallback events', async () => {
      const h = new Harness();
      h.fastFire('provider-chain-exhausted');
      h.setExhausted('prov_x', 3);
      h.fallbackCounts.set('prov_x', 4); // also fires fallback-active — assertions are per scope key
      h.fallbackChains.set('prov_x', ['prov_y', 'prov_z']);
      h.providerNames.set('prov_x', { name: 'Prov X', providerType: 'llm' });
      h.providerNames.set('prov_y', { name: 'Prov Y', providerType: 'llm' });
      h.providerNames.set('prov_z', { name: 'Prov Z', providerType: 'llm' });
      await h.pass();

      const rows = h.firedFor('provider-chain-exhausted:prov_x');
      expect(rows).to.have.length(1);
      expect(rows[0].message).to.contain('Prov X (prov_x) → Prov Y (prov_y) → Prov Z (prov_z)');
      expect(rows[0].context.failoverChain).to.deep.equal(['prov_x', 'prov_y', 'prov_z']);
    });

    it('respects a raised threshold', async () => {
      const h = new Harness();
      h.fastFire('provider-chain-exhausted', { threshold: 5 });
      h.setExhausted('prov_x', 3);
      await h.pass();
      expect(h.firedFor('provider-chain-exhausted:prov_x')).to.be.empty;

      h.setExhausted('prov_x', 6); // +3 delta in the window
      await h.pass();
      expect(h.firedFor('provider-chain-exhausted:prov_x')).to.have.length(1);
    });
  });

  describe('provider-auth-failed scoping + chain context (spec acceptance)', () => {
    it('fires only for the provider with auth errors', async () => {
      const h = new Harness();
      h.fastFire('provider-auth-failed');
      h.callLogs = [
        { ...emptyStats('prov_a'), calls: 10, errors: 3, errorRate: 0.3, errorCounts: { auth: 3 } },
        emptyStats('prov_b'),
      ];
      await h.pass();

      expect(h.firedFor('provider-auth-failed:prov_a')).to.have.length(1);
      expect(h.firedFor('provider-auth-failed:prov_b')).to.be.empty;
    });

    it('appends the failover chain when fallback events exist in the window', async () => {
      const h = new Harness();
      h.fastFire('provider-auth-failed');
      h.callLogs = [{ ...emptyStats('prov_a'), calls: 10, errors: 3, errorRate: 0.3, errorCounts: { auth: 3 } }];
      h.fallbackCounts.set('prov_a', 1);
      h.fallbackChains.set('prov_a', ['prov_b']);
      h.providerNames.set('prov_a', { name: 'Prov A', providerType: 'llm' });
      h.providerNames.set('prov_b', { name: 'Prov B', providerType: 'llm' });
      await h.pass();

      const rows = h.firedFor('provider-auth-failed:prov_a');
      expect(rows).to.have.length(1);
      expect(rows[0].message).to.contain('failover chain: Prov A (prov_a) → Prov B (prov_b)');
      expect(rows[0].context.failoverChain).to.deep.equal(['prov_a', 'prov_b']);
    });

    it('leaves the message unchanged when no fallback events exist', async () => {
      const h = new Harness();
      h.fastFire('provider-auth-failed');
      h.callLogs = [{ ...emptyStats('prov_a'), calls: 10, errors: 3, errorRate: 0.3, errorCounts: { auth: 3 } }];
      await h.pass();

      const rows = h.firedFor('provider-auth-failed:prov_a');
      expect(rows).to.have.length(1);
      expect(rows[0].message).to.not.contain('failover chain');
      expect(rows[0].context.failoverChain).to.deep.equal(['prov_a']);
    });
  });

  describe('fallback-active scoping + chain naming (spec acceptance)', () => {
    it('fires only for the provider with fallback executions', async () => {
      const h = new Harness();
      h.fastFire('fallback-active');
      h.fallbackCounts.set('prov_a', 2);
      await h.pass();

      expect(h.firedFor('fallback-active:prov_a')).to.have.length(1);
      expect(h.firedFor('fallback-active:prov_b')).to.be.empty;
    });

    it('names the fallback providers used in the window', async () => {
      const h = new Harness();
      h.fastFire('fallback-active');
      h.fallbackCounts.set('prov_a', 2);
      h.fallbackChains.set('prov_a', ['prov_c']);
      h.providerNames.set('prov_a', { name: 'Prov A', providerType: 'llm' });
      h.providerNames.set('prov_c', { name: 'Prov C', providerType: 'llm' });
      await h.pass();

      const rows = h.firedFor('fallback-active:prov_a');
      expect(rows).to.have.length(1);
      expect(rows[0].message).to.contain('fallbacks used: Prov C (prov_c)');
      expect(rows[0].context.failoverChain).to.deep.equal(['prov_a', 'prov_c']);
    });
  });
});
