import 'reflect-metadata';
import { expect } from 'chai';
import { monitoringConfigSchema, type MonitoringConfig } from '../../../src/http/contracts/monitoring';
import { AlertRuleEngine, type AlertEngineDataProviders } from '../../../src/services/monitoring/AlertRuleEngine';
import type { AlertEvent, AlertEventPublisher } from '../../../src/services/monitoring/AlertEventPublisher';
import type { MetricsSnapshot } from '../../../src/services/monitoring/MetricsRegistry';
import type { HealthSnapshot, ProviderWindowStats } from '../../../src/services/monitoring/AlertEvents';
import type { RateLimitRejectionKeyStats } from '../../../src/http/middleware/rateLimiter';

/**
 * P2-01 unit tests — alert rule engine.
 *
 * Everything is faked: metrics snapshot, health snapshot, config service,
 * data providers, publisher, and the clock. The engine under test is
 * constructed directly (bypassing DI) and driven pass-by-pass via runNow().
 */

const MIN = 60_000;
const HOUR = 3_600_000;

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
  probeFailures = new Map<string, number>();
  providerNames = new Map<string, { name: string; providerType: string }>();
  callLogs: ProviderWindowStats[] = [];
  fallbackCounts = new Map<string, number>();
  firingAlerts: unknown[] = [];
  rejectionTopKeys: RateLimitRejectionKeyStats[] = [];
  breakers = new Map<string, 'open'>();
  config: MonitoringConfig = defaultConfig();
  configShouldThrow = false;
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
        getProbeFailureCounts: () => this.probeFailures,
        getProbeFailures: () => 0,
        runNow: async () => {},
        start: () => {},
        stop: () => {},
      } as never,
      {
        get: async () => {
          if (this.configShouldThrow) throw new Error('db down');
          return this.config;
        },
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
      getRejectionStats: () => ({
        total: this.rejectionTopKeys.reduce((sum, k) => sum + k.count, 0),
        topKeys: this.rejectionTopKeys,
      }),
      getBreakers: () => this.breakers,
      queryProviderWindows: async () => this.callLogs,
      queryFallbackCounts: async () => [...this.fallbackCounts.entries()].map(([providerId, count]) => ({ providerId, count, fallbackIds: [] })), // P3-06: no chain context in the legacy harness
      queryProviderNames: async () => this.providerNames,
      listFiringAlerts: async () => this.firingAlerts as never,
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
}

describe('P2-01 AlertRuleEngine (unit)', () => {
  describe('windowed counter reads (delta ring, finding 1)', () => {
    it('sums per-pass deltas inside the window and excludes older ones', async () => {
      const h = new Harness();
      // 3 passes at 1-min spacing, +10 requests each pass.
      for (let i = 1; i <= 3; i++) {
        h.metrics.counters.api_requests_total = { 'method=GET,route_group=/api/x,status_class=2xx': { count: i * 10, sum: 0 } };
        await h.pass(MIN);
      }
      expect(h.engine.ringSumForTests('api_requests_total', {}, 5 * MIN)).to.equal(30);
      // 2-min-minus-1s window: only the last two deltas.
      expect(h.engine.ringSumForTests('api_requests_total', {}, 2 * MIN - 1)).to.equal(20);
      // Advance past the whole window with a flat counter (delta 0) — everything expires.
      await h.pass(6 * MIN);
      expect(h.engine.ringSumForTests('api_requests_total', {}, 5 * MIN)).to.equal(0);
    });

    it('clamps negative deltas (counter reset) to zero', async () => {
      const h = new Harness();
      h.metrics.counters.api_requests_total = { 'method=GET,route_group=/api/x,status_class=2xx': { count: 30, sum: 0 } };
      await h.pass(MIN);
      // Counter "reset" (process restart semantics): 30 → 5.
      h.metrics.counters.api_requests_total = { 'method=GET,route_group=/api/x,status_class=2xx': { count: 5, sum: 0 } };
      await h.pass(MIN);
      expect(h.engine.ringSumForTests('api_requests_total', {}, 5 * MIN)).to.equal(30);
      h.metrics.counters.api_requests_total = { 'method=GET,route_group=/api/x,status_class=2xx': { count: 8, sum: 0 } };
      await h.pass(MIN);
      expect(h.engine.ringSumForTests('api_requests_total', {}, 5 * MIN)).to.equal(33);
    });

    it('matches label filters exactly (series may carry extra labels)', async () => {
      const h = new Harness();
      h.metrics.counters.api_requests_total = {
        'method=POST,route_group=/api/y,status_class=5xx': { count: 7, sum: 0 },
        'method=GET,route_group=/api/x,status_class=2xx': { count: 40, sum: 0 },
        'method=DELETE,route_group=/api/z,status_class=5xx': { count: 3, sum: 0 },
      };
      await h.pass(MIN);
      expect(h.engine.ringSumForTests('api_requests_total', { status_class: '5xx' }, 5 * MIN)).to.equal(10);
      expect(h.engine.ringSumForTests('api_requests_total', { status_class: '5xx', route_group: '/api/y' }, 5 * MIN)).to.equal(7);
      expect(h.engine.ringSumForTests('api_requests_total', {}, 5 * MIN)).to.equal(50);
    });
  });

  describe('general rules', () => {
    it('db-down fires after 2 consecutive down cycles (finding 4) and never on a single blip', async () => {
      const h = new Harness();
      h.fastFire('db-down');
      h.healthChecks[0] = { name: 'db', status: 'down', detail: { error: 'connection refused' } };
      await h.pass(MIN); // first down pass — previous status is null
      expect(h.firedFor('db-down:global')).to.have.length(0);
      await h.pass(MIN); // second consecutive down pass
      expect(h.firedFor('db-down:global')).to.have.length(1);
      expect(h.fired[0].severity).to.equal('critical');
      expect(h.fired[0].message).to.contain('2 consecutive cycles');
      // Recovery: two good passes resolve it.
      h.healthChecks[0] = { name: 'db', status: 'ok', detail: { poolTotal: 10, poolIdle: 10, poolWaiting: 0 } };
      await h.pass(MIN);
      await h.pass(MIN);
      expect(h.resolvedFor('db-down:global')).to.have.length(1);
    });

    it('db-down stays quiet while the previous pass was healthy', async () => {
      const h = new Harness();
      h.fastFire('db-down');
      await h.pass(MIN); // ok
      h.healthChecks[0] = { name: 'db', status: 'down', detail: { error: 'timeout' } };
      await h.pass(MIN); // single blip — previous pass was ok
      expect(h.fired.length).to.equal(0);
    });

    it('service-stalled fires per stalled heartbeat with heartbeat:<name> scope', async () => {
      const h = new Harness();
      h.fastFire('service-stalled');
      h.healthChecks.push({ name: 'service_heartbeat:imap_inbound', status: 'down' });
      h.healthChecks.push({ name: 'service_heartbeat:conversation_timeout', status: 'ok' });
      h.healthChecks.push({ name: 'service_heartbeat:scenario_run_executor', status: 'unknown', detail: { reason: 'never ticked' } });
      await h.pass(MIN);
      expect(h.fired.map((e) => e.scopeKey)).to.deep.equal(['service-stalled:heartbeat:imap_inbound']);
      expect(h.fired[0].scope).to.deep.equal({ service: 'imap_inbound' });
      expect(h.fired[0].message).to.contain('imap_inbound');
    });

    it('db-pool-saturated requires 5 min of sustainment (finding 15)', async () => {
      const h = new Harness();
      // forMinutes stays at the rule default (5), resolveAfterGoodChecks 1.
      h.config.rules['db-pool-saturated'] = { resolveAfterGoodChecks: 1 };
      h.healthChecks[0] = { name: 'db', status: 'degraded', detail: { poolTotal: 10, poolIdle: 0, poolWaiting: 5 } };
      await h.pass(2 * MIN); // first met pass — pendingSince set here
      await h.pass(2 * MIN); // 2 min sustained — still pending
      expect(h.firedFor('db-pool-saturated:global')).to.have.length(0);
      await h.pass(2 * MIN); // 4 min sustained — still pending
      expect(h.firedFor('db-pool-saturated:global')).to.have.length(0);
      await h.pass(MIN); // 5 min sustained — fires
      expect(h.firedFor('db-pool-saturated:global')).to.have.length(1);
      expect(h.fired[0].message).to.contain('5/10');
    });

    it('db-pool-saturated does not fire when the pool recovers before sustainment', async () => {
      const h = new Harness();
      h.config.rules['db-pool-saturated'] = { resolveAfterGoodChecks: 1 };
      h.healthChecks[0] = { name: 'db', status: 'degraded', detail: { poolTotal: 10, poolIdle: 0, poolWaiting: 5 } };
      await h.pass(3 * MIN); // first met pass
      h.healthChecks[0] = { name: 'db', status: 'ok', detail: { poolTotal: 10, poolIdle: 10, poolWaiting: 0 } };
      await h.pass(3 * MIN); // pending → ok (condition cleared before 5 min)
      expect(h.fired.length).to.equal(0);
      h.healthChecks[0] = { name: 'db', status: 'degraded', detail: { poolTotal: 10, poolIdle: 0, poolWaiting: 5 } };
      await h.pass(6 * MIN); // fresh sustainment starts (pendingSince set)
      await h.pass(6 * MIN); // 6 min sustained — fires
      expect(h.firedFor('db-pool-saturated:global')).to.have.length(1);
    });

    it('api-5xx-spike fires on ratio with minSamples on the denominator', async () => {
      const h = new Harness();
      h.fastFire('api-5xx-spike');
      h.metrics.counters.api_requests_total = {
        'method=GET,route_group=/api/x,status_class=2xx': { count: 90, sum: 0 },
        'method=POST,route_group=/api/y,status_class=5xx': { count: 20, sum: 0 },
      };
      await h.pass(MIN);
      expect(h.firedFor('api-5xx-spike:global')).to.have.length(1);
      expect(h.fired[0].message).to.contain('20/110');
    });

    it('api-5xx-spike does not fire below minSamples or at exactly the ratio threshold', async () => {
      const h = new Harness();
      h.fastFire('api-5xx-spike');
      h.metrics.counters.api_requests_total = {
        'method=GET,route_group=/api/x,status_class=2xx': { count: 10, sum: 0 },
        'method=POST,route_group=/api/y,status_class=5xx': { count: 5, sum: 0 },
      };
      await h.pass(MIN); // 15 total < minSamples 20
      expect(h.fired.length).to.equal(0);
      h.metrics.counters.api_requests_total = {
        'method=GET,route_group=/api/x,status_class=2xx': { count: 190, sum: 0 },
        'method=POST,route_group=/api/y,status_class=5xx': { count: 10, sum: 0 },
      };
      await h.pass(MIN); // window: 190/200 → exactly 5% (strict >, no fire)
      expect(h.fired.length).to.equal(0);
    });

    it('api-429-spike scopes the alert to the dominant rejecting key (finding 2/3)', async () => {
      const h = new Harness();
      h.fastFire('api-429-spike');
      h.metrics.counters.rate_limit_rejections_total = {
        'scope=api,key_type=operator': { count: 30, sum: 0 },
      };
      h.rejectionTopKeys = [
        { keyHash: 'dominant', scope: 'api', keyType: 'operator', count: 26, lastRejectedAt: new Date() },
        { keyHash: 'minor', scope: 'api', keyType: 'ip', count: 4, lastRejectedAt: new Date() },
        { keyHash: 'other-scope', scope: 'auth', keyType: 'ip', count: 99, lastRejectedAt: new Date() },
      ];
      await h.pass(MIN);
      expect(h.fired.map((e) => e.scopeKey)).to.deep.equal(['api-429-spike:key:dominant']);
      expect(h.fired[0].scope).to.deep.equal({ keyHash: 'dominant', keyType: 'operator', scope: 'api' });
      expect(h.fired[0].message).to.contain('dominant');
    });

    it('api-429-spike falls back to global scope when no key dominates', async () => {
      const h = new Harness();
      h.fastFire('api-429-spike');
      h.metrics.counters.rate_limit_rejections_total = {
        'scope=api,key_type=operator': { count: 12, sum: 0 },
        'scope=api,key_type=ip': { count: 12, sum: 0 },
      };
      h.rejectionTopKeys = [
        { keyHash: 'a', scope: 'api', keyType: 'operator', count: 12, lastRejectedAt: new Date() },
        { keyHash: 'b', scope: 'api', keyType: 'ip', count: 12, lastRejectedAt: new Date() },
      ];
      await h.pass(MIN);
      expect(h.fired.map((e) => e.scopeKey)).to.deep.equal(['api-429-spike:global']);
      expect(h.fired[0].message).to.contain('no single key dominates');
    });

    it('auth-429-spike fires on auth-scope rejections (security signal)', async () => {
      const h = new Harness();
      h.fastFire('auth-429-spike');
      h.metrics.counters.rate_limit_rejections_total = {
        'scope=auth,key_type=ip': { count: 6, sum: 0 },
      };
      await h.pass(MIN);
      expect(h.fired.map((e) => e.scopeKey)).to.deep.equal(['auth-429-spike:global']);
      expect(h.fired[0].message).to.contain('login');
    });

    it('high-memory fires on the rss_bytes gauge and never without it (finding 13)', async () => {
      const h = new Harness();
      h.fastFire('high-memory');
      // No gauge yet (pre-first health cycle) — never fires.
      await h.pass(MIN);
      expect(h.fired.length).to.equal(0);
      h.metrics.gauges.rss_bytes = { '': 2_147_483_648 };
      await h.pass(MIN);
      expect(h.firedFor('high-memory:global')).to.have.length(1);
      expect(h.fired[0].message).to.contain('2048 MB');
    });

    it('event-loop-lag fires when p95 exceeds the threshold', async () => {
      const h = new Harness();
      h.fastFire('event-loop-lag');
      h.metrics.gauges.event_loop_lag_p95_ms = { '': 300 };
      await h.pass(MIN);
      expect(h.firedFor('event-loop-lag:global')).to.have.length(1);
      expect(h.fired[0].message).to.contain('300 ms');
    });
  });

  describe('per-provider rules (provider_call_logs window, finding 16 denominators)', () => {
    const stats = (overrides: Partial<ProviderWindowStats>): ProviderWindowStats => ({ ...emptyStats('prov_1'), ...overrides });
    const name = () => {
      const m = new Map<string, { name: string; providerType: string }>();
      return m;
    };

    it('provider-down fires on 100% error rate with minSamples', async () => {
      const h = new Harness();
      h.fastFire('provider-down');
      h.callLogs = [stats({ calls: 5, errors: 5, errorRate: 1, errorCounts: { unavailable: 5 } })];
      h.providerNames = name();
      h.providerNames.set('prov_1', { name: 'Anthropic', providerType: 'llm' });
      await h.pass(MIN);
      expect(h.firedFor('provider-down:prov_1')).to.have.length(1);
      expect(h.fired[0].severity).to.equal('critical');
      expect(h.fired[0].message).to.contain('Anthropic');
      expect(h.fired[0].message).to.contain('100% of 5');
      expect(h.fired[0].context).to.include({ providerId: 'prov_1', calls: 5, errors: 5 });
    });

    it('provider-down does not fire below minSamples calls', async () => {
      const h = new Harness();
      h.fastFire('provider-down');
      h.callLogs = [stats({ calls: 4, errors: 4, errorRate: 1, errorCounts: { unavailable: 4 } })];
      await h.pass(MIN);
      expect(h.fired.length).to.equal(0);
    });

    it('provider-down fires via the probe-failure branch for probe-only providers (finding 6)', async () => {
      const h = new Harness();
      h.fastFire('provider-down');
      h.probeFailures.set('prov_probe', 3); // no call rows at all
      await h.pass(MIN);
      expect(h.firedFor('provider-down:prov_probe')).to.have.length(1);
      expect(h.fired[0].message).to.contain('3 consecutive health-probe failures');
    });

    it('provider-down fires via the breaker seam (P3-01)', async () => {
      const h = new Harness();
      h.fastFire('provider-down');
      h.breakers.set('prov_break', 'open');
      await h.pass(MIN);
      expect(h.firedFor('provider-down:prov_break')).to.have.length(1);
      expect(h.fired[0].message).to.contain('circuit breaker is OPEN');
    });

    it('provider-degraded fires on error rate (minSamples on both branches, finding 7)', async () => {
      const h = new Harness();
      h.fastFire('provider-degraded');
      h.callLogs = [stats({ calls: 20, errors: 10, errorRate: 0.5, errorCounts: { timeout: 10 } })];
      await h.pass(MIN);
      expect(h.firedFor('provider-degraded:prov_1')).to.have.length(1);
      expect(h.fired[0].message).to.contain('50.0%');
    });

    it('provider-degraded fires on per-type p95 duration and not for types without a threshold', async () => {
      const h = new Harness();
      h.fastFire('provider-degraded');
      h.callLogs = [stats({ calls: 12, errors: 0, errorRate: 0, p95DurationMs: 25_000 })];
      h.providerNames.set('prov_1', { name: 'OpenAI', providerType: 'llm' });
      await h.pass(MIN);
      expect(h.firedFor('provider-degraded:prov_1')).to.have.length(1);
      expect(h.fired[0].message).to.contain('25.0s');
      // embeddings has no latency threshold — same data must not fire.
      const h2 = new Harness();
      h2.fastFire('provider-degraded');
      h2.callLogs = [stats({ calls: 12, errors: 0, errorRate: 0, p95DurationMs: 25_000 })];
      h2.providerNames.set('prov_1', { name: 'Voyage', providerType: 'embeddings' });
      await h2.pass(MIN);
      expect(h2.fired.length).to.equal(0);
    });

    it('provider-rate-limited fires on rate_limited error counts (429s are distinct from outages)', async () => {
      const h = new Harness();
      h.fastFire('provider-rate-limited');
      h.callLogs = [stats({ calls: 20, errors: 5, errorRate: 0.25, errorCounts: { rate_limited: 5 } })];
      await h.pass(MIN);
      expect(h.firedFor('provider-rate-limited:prov_1')).to.have.length(1);
      expect(h.fired[0].message).to.contain('5 rate_limited');
    });

    it('provider-auth-failed fires immediately on a single auth error (forMinutes 0)', async () => {
      const h = new Harness();
      h.fastFire('provider-auth-failed');
      h.callLogs = [stats({ calls: 20, errors: 1, errorRate: 0.05, errorCounts: { auth: 1 } })];
      await h.pass(MIN);
      expect(h.firedFor('provider-auth-failed:prov_1')).to.have.length(1);
      expect(h.fired[0].message).to.contain('will not self-heal');
    });

    it('oauth-refresh-failing and imap-poll-failing fire on ok=false counter series', async () => {
      const h = new Harness();
      h.fastFire('oauth-refresh-failing');
      h.fastFire('imap-poll-failing');
      h.metrics.counters.oauth_refresh_total = {
        'ok=false,provider_id=prov_9': { count: 3, sum: 0 },
        'ok=true,provider_id=prov_9': { count: 50, sum: 0 },
      };
      h.metrics.counters.imap_poll_total = {
        'ok=false,provider_id=prov_10': { count: 5, sum: 0 },
      };
      await h.pass(MIN);
      expect(h.firedFor('oauth-refresh-failing:prov_9')).to.have.length(1);
      expect(h.firedFor('imap-poll-failing:prov_10')).to.have.length(1);
    });

    it('fallback-active fires on the first fallback event in the window', async () => {
      const h = new Harness();
      h.fastFire('fallback-active');
      h.fallbackCounts.set('prov_fb', 1);
      await h.pass(MIN);
      expect(h.firedFor('fallback-active:prov_fb')).to.have.length(1);
      expect(h.fired[0].severity).to.equal('info');
    });

    it('stream-slow-ttft uses the ttft-denominator and a tighter TTS limit', async () => {
      const h = new Harness();
      h.fastFire('stream-slow-ttft');
      h.callLogs = [stats({ calls: 12, errors: 0, errorRate: 0, ttftRows: 12, ttftP95Ms: 15_000, ttftP50Ms: 4_000 })];
      h.providerNames.set('prov_1', { name: 'OpenAI', providerType: 'llm' });
      await h.pass(MIN);
      expect(h.firedFor('stream-slow-ttft:prov_1')).to.have.length(1);
      expect(h.fired[0].message).to.contain('15.0s');

      const h2 = new Harness();
      h2.fastFire('stream-slow-ttft');
      h2.callLogs = [stats({ calls: 12, errors: 0, errorRate: 0, ttftRows: 12, ttftP95Ms: 5_000 })];
      h2.providerNames.set('prov_1', { name: 'ElevenLabs', providerType: 'tts' });
      await h2.pass(MIN);
      expect(h2.firedFor('stream-slow-ttft:prov_1')).to.have.length(1); // 5s > 3s TTS limit
    });

    it('stream-stalls uses streamed-rows-with-gaps as the denominator', async () => {
      const h = new Harness();
      h.fastFire('stream-stalls');
      h.callLogs = [stats({ calls: 40, errors: 0, errorRate: 0, gapRows: 20, stalledRows: 3 })];
      await h.pass(MIN);
      expect(h.firedFor('stream-stalls:prov_1')).to.have.length(1);
      expect(h.fired[0].message).to.contain('3/20');
    });

    it('stream-abort-rate uses ALL provider rows as the denominator', async () => {
      const h = new Harness();
      h.fastFire('stream-abort-rate');
      h.callLogs = [stats({ calls: 20, errors: 3, errorRate: 0.15, midStreamRows: 3 })];
      await h.pass(MIN);
      expect(h.firedFor('stream-abort-rate:prov_1')).to.have.length(1);
      expect(h.fired[0].message).to.contain('3/20');
    });

    it('tts-rtf-degraded fires when the RTF>1 fraction exceeds the threshold', async () => {
      const h = new Harness();
      h.fastFire('tts-rtf-degraded');
      h.callLogs = [stats({ calls: 20, errors: 0, errorRate: 0, audioRows: 20, rtfOverRows: 3 })];
      await h.pass(MIN);
      expect(h.firedFor('tts-rtf-degraded:prov_1')).to.have.length(1);
    });

    it('asr-final-latency fires on eosToFinalMs p95 with minSamples 5', async () => {
      const h = new Harness();
      h.fastFire('asr-final-latency');
      h.callLogs = [stats({ calls: 6, errors: 0, errorRate: 0, eosRows: 6, eosP95Ms: 15_000 })];
      await h.pass(MIN);
      expect(h.firedFor('asr-final-latency:prov_1')).to.have.length(1);
      expect(h.fired[0].message).to.contain('15.0s');
    });
  });

  describe('anti-flap state machine', () => {
    it('flaps correctly: fire → resolve → re-fire (no duplicate fires while firing)', async () => {
      const h = new Harness();
      h.fastFire('high-memory');
      h.metrics.gauges.rss_bytes = { '': 2_000_000_000 };
      await h.pass(MIN); // fires
      await h.pass(MIN); // still met — stays firing, no duplicate
      expect(h.firedFor('high-memory:global')).to.have.length(1);
      h.metrics.gauges.rss_bytes = { '': 1_000_000 };
      await h.pass(MIN); // not met → resolves (resolveAfterGoodChecks 1)
      expect(h.resolvedFor('high-memory:global')).to.have.length(1);
      h.metrics.gauges.rss_bytes = { '': 2_000_000_000 };
      await h.pass(MIN); // re-fires (cooldown 0)
      expect(h.firedFor('high-memory:global')).to.have.length(2);
    });

    it('blocks re-fire within the cooldown and allows it after (finding 8)', async () => {
      const h = new Harness();
      h.fastFire('high-memory', { cooldownMinutes: 15 });
      h.metrics.gauges.rss_bytes = { '': 2_000_000_000 };
      await h.pass(MIN); // fires at t0
      h.metrics.gauges.rss_bytes = { '': 1_000_000 };
      await h.pass(MIN); // resolves at t0+1m
      h.metrics.gauges.rss_bytes = { '': 2_000_000_000 };
      await h.pass(5 * MIN); // t0+6m — met but inside the 15-min cooldown
      expect(h.firedFor('high-memory:global')).to.have.length(1);
      await h.pass(10 * MIN); // t0+16m — cooldown elapsed → re-fires
      expect(h.firedFor('high-memory:global')).to.have.length(2);
    });

    it('cooldown precedence: rule override > alerting.defaultCooldownMinutes > rule default (finding 8)', async () => {
      // No rule override: alerting default (45) beats the rule default (15).
      const h1 = new Harness();
      h1.config.rules['high-memory'] = { forMinutes: 0, resolveAfterGoodChecks: 1 };
      h1.config.alerting.defaultCooldownMinutes = 45;
      h1.metrics.gauges.rss_bytes = { '': 2_000_000_000 };
      await h1.pass(MIN); // fires at t0
      h1.metrics.gauges.rss_bytes = { '': 1_000_000 };
      await h1.pass(MIN);
      h1.metrics.gauges.rss_bytes = { '': 2_000_000_000 };
      await h1.pass(31 * MIN); // t0+32m — past 15 (rule default) but inside 45
      expect(h1.firedFor('high-memory:global')).to.have.length(1);

      // Rule override (5) beats the alerting default (45).
      const h2 = new Harness();
      h2.fastFire('high-memory', { cooldownMinutes: 5 });
      h2.config.alerting.defaultCooldownMinutes = 45;
      h2.metrics.gauges.rss_bytes = { '': 2_000_000_000 };
      await h2.pass(MIN); // fires at t0
      h2.metrics.gauges.rss_bytes = { '': 1_000_000 };
      await h2.pass(MIN);
      h2.metrics.gauges.rss_bytes = { '': 2_000_000_000 };
      await h2.pass(5 * MIN); // t0+6m — past 5 → re-fires
      expect(h2.firedFor('high-memory:global')).to.have.length(2);
    });

    it('maxUnresolvedHours auto-resolves even while the condition stays met (finding 12)', async () => {
      const h = new Harness();
      h.fastFire('high-memory', { maxUnresolvedHours: 1 });
      h.metrics.gauges.rss_bytes = { '': 2_000_000_000 };
      await h.pass(MIN); // fires
      await h.pass(70 * MIN); // still met, but past maxUnresolvedHours
      expect(h.resolvedFor('high-memory:global')).to.have.length(1);
      expect(h.resolved[0].context).to.include({ resolutionReason: 'max_unresolved_hours' });
    });

    it('resolveAfterGoodChecks requires N consecutive good passes', async () => {
      const h = new Harness();
      h.fastFire('high-memory', { resolveAfterGoodChecks: 2 });
      h.metrics.gauges.rss_bytes = { '': 2_000_000_000 };
      await h.pass(MIN); // fires
      h.metrics.gauges.rss_bytes = { '': 1_000_000 };
      await h.pass(MIN); // good 1/2 — still firing
      expect(h.resolvedFor('high-memory:global')).to.have.length(0);
      h.metrics.gauges.rss_bytes = { '': 2_000_000_000 };
      await h.pass(MIN); // met again — streak resets, stays firing
      h.metrics.gauges.rss_bytes = { '': 1_000_000 };
      await h.pass(MIN); // good 1/2 again
      await h.pass(MIN); // good 2/2 — resolves
      expect(h.resolvedFor('high-memory:global')).to.have.length(1);
    });

    it('a tracked per-provider key resolves when its data disappears (findings 11/13)', async () => {
      const h = new Harness();
      h.fastFire('provider-down');
      h.callLogs = [stats2({ calls: 5, errors: 5, errorRate: 1, errorCounts: { unavailable: 5 } })];
      await h.pass(MIN); // fires
      expect(h.firedFor('provider-down:prov_1')).to.have.length(1);
      h.callLogs = []; // provider went quiet — no verdicts this pass
      await h.pass(MIN); // synthesized not-met → resolves (N=1)
      expect(h.resolvedFor('provider-down:prov_1')).to.have.length(1);
    });

    it('disabled rules are never evaluated', async () => {
      const h = new Harness();
      h.config.rules['high-memory'] = { enabled: false };
      h.metrics.gauges.rss_bytes = { '': 2_000_000_000 };
      await h.pass(MIN);
      await h.pass(MIN);
      expect(h.fired.length).to.equal(0);
    });

    it('severity and threshold overrides from the config apply', async () => {
      const h = new Harness();
      h.fastFire('event-loop-lag', { threshold: 50, severity: 'critical' });
      h.metrics.gauges.event_loop_lag_p95_ms = { '': 300 };
      await h.pass(MIN);
      expect(h.firedFor('event-loop-lag:global')).to.have.length(1);
      expect(h.fired[0].severity).to.equal('critical');

      const h2 = new Harness();
      h2.fastFire('event-loop-lag', { threshold: 1000 });
      h2.metrics.gauges.event_loop_lag_p95_ms = { '': 300 };
      await h2.pass(MIN);
      expect(h2.fired.length).to.equal(0);
    });
  });

  describe('engine mechanics', () => {
    it('startup reconciliation resolves old orphans and keeps young ones (finding 12)', async () => {
      const h = new Harness();
      h.firingAlerts = [
        {
          id: 'alrt_old',
          ruleId: 'high-memory',
          scopeKey: 'high-memory:global',
          scope: {},
          severity: 'warning',
          message: 'old alert',
          context: {},
          firedAt: new Date(h.now - 7 * HOUR),
        },
        {
          id: 'alrt_young',
          ruleId: 'high-memory',
          scopeKey: 'high-memory:global',
          scope: {},
          severity: 'warning',
          message: 'young alert',
          context: {},
          firedAt: new Date(h.now - 1 * HOUR),
        },
      ];
      await h.pass(MIN); // first pass → reconcileStartup
      expect(h.resolved.map((e) => e.id)).to.deep.equal(['alrt_old']);
      expect(h.resolved[0].context).to.include({ resolutionReason: 'engine_restart' });
    });

    it('reconciliation is skipped when the query fails (DB down at boot)', async () => {
      const h = new Harness();
      h.firingAlerts = [];
      const engine = h.engine;
      engine.setDataProviders({ listFiringAlerts: async () => { throw new Error('db down'); } } as Partial<AlertEngineDataProviders>);
      await h.pass(MIN); // must not crash
      expect(h.resolved.length).to.equal(0);
    });

    it('config load failure degrades to schema defaults (finding 19)', async () => {
      const h = new Harness();
      h.configShouldThrow = true;
      h.metrics.gauges.rss_bytes = { '': 2_000_000_000 }; // above the DEFAULT 1536 MB threshold
      // Schema-default rule params: forMinutes 2 → 2 min of sustained met passes.
      await h.pass(MIN);
      await h.pass(MIN);
      await h.pass(MIN);
      expect(h.firedFor('high-memory:global')).to.have.length(1);
    });

    it('a throwing evaluator is isolated — other rules still run (per-source isolation, finding 19)', async () => {
      const h = new Harness();
      h.fastFire('high-memory');
      (h as { healthChecks: unknown }).healthChecks = 'corrupted'; // db-down's .find throws
      h.metrics.gauges.rss_bytes = { '': 2_000_000_000 };
      await h.pass(MIN);
      expect(h.firedFor('high-memory:global')).to.have.length(1);
    });

    it('publisher failures never propagate (fire-and-forget double guard, finding 18)', async () => {
      const h = new Harness();
      h.fastFire('high-memory');
      h.metrics.gauges.rss_bytes = { '': 2_000_000_000 };
      // Replace the publisher with a throwing one after construction.
      const engine = h.engine;
      (engine as unknown as { publisher: AlertEventPublisher }).publisher = {
        fire: async () => { throw new Error('insert failed'); },
        resolve: async () => { throw new Error('update failed'); },
      };
      await h.pass(MIN); // fire attempt → swallowed
      h.metrics.gauges.rss_bytes = { '': 1_000_000 };
      await h.pass(MIN); // resolve attempt → swallowed
      await h.pass(MIN); // next pass still works
      expect(h.fired.length).to.equal(0); // fake never saw the event (it threw before pushing)
    });
  });
});

// Local helper for the "data disappears" test (kept outside the Harness class).
function stats2(overrides: Partial<ProviderWindowStats>): ProviderWindowStats {
  return { ...emptyStats('prov_1'), ...overrides };
}
