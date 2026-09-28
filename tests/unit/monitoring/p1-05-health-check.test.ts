import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { HeartbeatRegistry } from '../../../src/services/monitoring/HeartbeatRegistry';
import { HealthCheckService, overallHealthStatus, type HealthCheckResult, type HealthCheckStatus } from '../../../src/services/monitoring/HealthCheckService';
import { MetricsRegistry, type MetricSampleRow } from '../../../src/services/monitoring/MetricsRegistry';
import type { LlmProviderFactory } from '../../../src/services/providers/llm/LlmProviderFactory';
import type { StorageProviderFactory } from '../../../src/services/providers/storage/StorageProviderFactory';
import type { AsrProviderFactory } from '../../../src/services/providers/asr/AsrProviderFactory';
import type { TtsProviderFactory } from '../../../src/services/providers/tts/TtsProviderFactory';
import type { Provider } from '../../../src/types/models';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class QuietRegistry extends MetricsRegistry {
  protected async persistRows(rows: MetricSampleRow[]): Promise<void> {
    // no DB in unit tests
  }
  protected onFlushError(err: unknown): void {
    // swallow
  }
}

interface CallStats {
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastCallAt: Date | null;
}

/** HealthCheckService with every external boundary stubbed. */
class TestHealthCheckService extends HealthCheckService {
  /** Seam: shorten the per-check timeout so the timeout path is testable in <1 s. */
  setCheckTimeoutMs(ms: number): void {
    this.checkTimeoutMs = ms;
  }

  pingDbMode: 'ok' | 'error' | 'hang' = 'ok';
  poolStats = { poolTotal: 5, poolIdle: 3, poolWaiting: 0 };
  providers: Provider[] = [];
  callStats: Record<string, CallStats> = {};
  providersFetchError: string | null = null;
  persisted: HealthCheckResult[][] = [];

  protected async pingDb(): Promise<number> {
    if (this.pingDbMode === 'error') throw new Error('db down');
    if (this.pingDbMode === 'hang') await new Promise((resolve) => setTimeout(resolve, 10_000));
    return 3;
  }
  protected getPoolStats() {
    return this.poolStats;
  }
  protected async fetchProviders(): Promise<Provider[]> {
    if (this.providersFetchError) throw new Error(this.providersFetchError);
    return this.providers;
  }
  protected async fetchRecentCallStats(): Promise<Record<string, CallStats>> {
    return this.callStats;
  }
  protected async persistResults(results: HealthCheckResult[]): Promise<void> {
    this.persisted.push(results);
  }
}

function providerRow(id: string, providerType: string): Provider {
  return {
    id,
    name: id,
    description: null,
    providerType,
    apiType: providerType === 'llm' ? 'anthropic' : 'elevenlabs',
    config: {},
    fallbacks: [],
    createdBy: null,
    tags: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Provider;
}

function makeLlmFactory(behavior: { calls: number[]; fail?: boolean }): LlmProviderFactory {
  return {
    createProviderForEnumeration: async () => ({
      init: async () => { /* client construction only */ },
      enumerateModels: async () => {
        behavior.calls.push(Date.now());
        if (behavior.fail) throw new Error('probe failed');
        return [];
      },
    }),
  } as unknown as LlmProviderFactory;
}

function makeStorageFactory(behavior: { calls: number[]; fail?: boolean }): StorageProviderFactory {
  return {
    createProvider: async () => ({
      list: async () => {
        behavior.calls.push(Date.now());
        if (behavior.fail) throw new Error('probe failed');
        return [];
      },
    }),
  } as unknown as StorageProviderFactory;
}

/** ASR/TTS probe factory stub: instances expose ping() unless withPing is false (P1-05b). */
function makeProbeFactory(behavior: { calls: number[]; fail?: boolean; withPing?: boolean }): AsrProviderFactory & TtsProviderFactory {
  return {
    createProviderForProbing: async () => {
      const instance: Record<string, unknown> = {};
      if (behavior.withPing !== false) {
        instance.ping = async () => {
          behavior.calls.push(Date.now());
          if (behavior.fail) throw new Error('probe failed');
        };
      }
      return instance;
    },
  } as unknown as AsrProviderFactory & TtsProviderFactory;
}

function makeConfigService(options?: { probeSettings?: { llmProbe?: 'models' | 'one_token' | 'off'; asrProbe?: 'free' | 'off'; ttsProbe?: 'free' | 'off'; cooldownMinutes?: number }; fail?: boolean }) {
  return {
    get: async () => {
      if (options?.fail) throw new Error('config unavailable');
      return {
        notifiers: [],
        rules: {},
        retentionDays: 90,
        probeSettings: { llmProbe: 'models', asrProbe: 'free', ttsProbe: 'free', cooldownMinutes: 10, ...options?.probeSettings },
        alerting: { engineIntervalMinutes: 1, defaultCooldownMinutes: 15 },
      };
    },
  } as unknown as import('../../../src/services/monitoring/MonitoringConfigService').MonitoringConfigService;
}

function makeService(probesEnv?: string): {
  service: TestHealthCheckService;
  registry: QuietRegistry;
  hb: HeartbeatRegistry;
  restoreEnv: () => void;
} {
  const previous = process.env.MONITORING_HEALTH_PROBES;
  if (probesEnv !== undefined) process.env.MONITORING_HEALTH_PROBES = probesEnv;
  const registry = new QuietRegistry();
  const hb = new HeartbeatRegistry(registry);
  const service = new TestHealthCheckService(hb, registry, makeLlmFactory({ calls: [] }), makeStorageFactory({ calls: [] }), makeProbeFactory({ calls: [] }), makeProbeFactory({ calls: [] }), makeConfigService());
  return { service, registry, hb, restoreEnv: () => {
    if (previous === undefined) delete process.env.MONITORING_HEALTH_PROBES;
    else process.env.MONITORING_HEALTH_PROBES = previous;
  } };
}

function byName(rows: HealthCheckResult[]): Record<string, HealthCheckResult> {
  return Object.fromEntries(rows.map((row) => [row.name, row]));
}

describe('HeartbeatRegistry per-service intervals (P1-05)', () => {
  it('tick(service, intervalMs) declares the interval and serviceStates() computes 3x threshold', () => {
    const hb = new HeartbeatRegistry(new QuietRegistry());
    hb.tick('svc', 10_000);
    const states = hb.serviceStates();
    expect(states.svc.declaredIntervalMs).to.equal(10_000);
    expect(states.svc.thresholdMs).to.equal(30_000);
    expect(states.svc.stale).to.equal(false);
    expect(states.svc.errorCount).to.equal(0);
  });

  it('undeclared services fall back to the 60 s default threshold', () => {
    const hb = new HeartbeatRegistry(new QuietRegistry());
    hb.tick('svc');
    expect(hb.serviceStates().svc.thresholdMs).to.equal(180_000);
  });

  it('declareInterval() works without a tick and is honored by serviceStates()', () => {
    const hb = new HeartbeatRegistry(new QuietRegistry());
    hb.tick('svc');
    hb.declareInterval('svc', 5_000);
    expect(hb.serviceStates().svc.declaredIntervalMs).to.equal(5_000);
    expect(hb.serviceStates().svc.thresholdMs).to.equal(15_000);
  });

  it('serviceStates() reports stale beyond 3x and excludes never-ticked services', () => {
    const hb = new HeartbeatRegistry(new QuietRegistry());
    hb.tick('fresh', 10_000);
    const now = Date.now();
    expect(hb.serviceStates(now).fresh.stale).to.equal(false);
    expect(hb.serviceStates(now + 29_000).fresh.stale).to.equal(false);
    expect(hb.serviceStates(now + 31_000).fresh.stale).to.equal(true);
    expect(hb.serviceStates(now + 31_000)).to.not.have.property('never-ticked');
  });

  it('serviceStates() carries the cumulative error count', () => {
    const hb = new HeartbeatRegistry(new QuietRegistry());
    hb.tick('svc', 10_000);
    hb.recordError('svc');
    hb.recordError('svc');
    expect(hb.serviceStates().svc.errorCount).to.equal(2);
  });

  it('P1-02 API stays intact: staleServices(maxAgeMs) single-threshold behavior', () => {
    const hb = new HeartbeatRegistry(new QuietRegistry());
    hb.tick('svc', 10_000);
    const now = Date.now();
    expect(hb.staleServices(60_000, now)).to.deep.equal([]);
    expect(hb.staleServices(0, now + 1)).to.deep.equal(['svc']);
  });
});

describe('HealthCheckService (P1-05)', () => {
  let restoreEnv: () => void;

  beforeEach(() => {
    delete process.env.MONITORING_MEMORY_THRESHOLD_MB;
  });

  afterEach(() => {
    restoreEnv?.();
    restoreEnv = undefined;
    delete process.env.MONITORING_MEMORY_THRESHOLD_MB;
  });

  it('full cycle: db/process/8-heartbeat checks, gauges published, snapshot updated', async () => {
    const { service, registry, hb, restoreEnv: restore } = makeService();
    restoreEnv = restore;
    hb.tick('conversation-timeout', 60_000); // fresh known service
    hb.declareInterval('imap-inbound', 60_000); // known service, never ticked
    hb.tick('svc-c', 100); // unknown name but ticked — threshold 300 ms
    await sleep(350);

    await service.runNow();

    const rows = byName(service.persisted[0]);
    expect(rows['db']?.status).to.equal('ok');
    expect(rows['db']?.latencyMs).to.be.a('number').that.is.gte(0);
    expect(rows['db']?.detail).to.deep.equal({ poolTotal: 5, poolIdle: 3, poolWaiting: 0 });
    // 'degraded' is possible here: under load a sub-second window can pick up a
    // >250 ms lag spike; the dedicated tests below cover the degraded path and
    // pin the lag magnitude (finding 11).
    expect(rows['process']?.status).to.be.oneOf(['ok', 'degraded']);
    expect(rows['process']?.detail).to.include.key('eventLoopLagMaxMs');
    expect(rows['service_heartbeat:health-checks']?.status).to.equal('ok');
    expect(rows['service_heartbeat:conversation-timeout']?.status).to.equal('ok');
    expect(rows['service_heartbeat:imap-inbound']?.status).to.equal('unknown');
    expect(rows['service_heartbeat:imap-inbound']?.detail).to.deep.equal({ reason: 'never ticked' });
    // unticked known services are still checked
    expect(rows['service_heartbeat:processing-deferral']?.status).to.equal('unknown');
    expect(rows['service_heartbeat:svc-c']?.status).to.equal('down');
    expect(rows['service_heartbeat:svc-c']?.detail).to.include({ errorCount: 0 });

    const gauges = registry.snapshot().gauges;
    expect(gauges.db_pool_total?.['']).to.equal(5);
    expect(gauges.db_pool_idle?.['']).to.equal(3);
    expect(gauges.db_pool_waiting?.['']).to.equal(0);
    expect(gauges.rss_bytes?.['']).to.be.greaterThan(0);
    expect(gauges.event_loop_lag_p95_ms?.['']).to.be.gte(0);
    expect(gauges.event_loop_lag_max_ms?.['']).to.be.gte(0);
    expect(gauges.background_service_last_run_ts?.['service=health-checks']).to.be.a('number');

    const snapshot = service.getSnapshot();
    expect(snapshot.checkedAt).to.be.instanceOf(Date);
    // db + process + 8 heartbeats (7 known + ticked unknown svc-c)
    expect(snapshot.checks).to.have.length(10);
  });

  it('db check: pool waiting > 0 degrades; ping failure is down with the error', async () => {
    const { service } = makeService();
    service.poolStats = { poolTotal: 5, poolIdle: 0, poolWaiting: 2 };
    await service.runNow();
    expect(byName(service.persisted[0])['db']?.status).to.equal('degraded');

    service.pingDbMode = 'error';
    await service.runNow();
    const down = byName(service.persisted[1])['db'];
    expect(down?.status).to.equal('down');
    expect(down?.detail).to.deep.equal({ error: 'db down' });
  });

  it('process check: tiny memory threshold degrades (env-driven)', async () => {
    const { service } = makeService();
    process.env.MONITORING_MEMORY_THRESHOLD_MB = '1'; // ~1 MB — every node process exceeds this
    await service.runNow();
    const row = byName(service.persisted[0])['process'];
    expect(row?.status).to.equal('degraded');
    expect(row?.detail).to.include.keys('rssBytes', 'heapUsedBytes', 'eventLoopLagP95Ms', 'eventLoopLagMaxMs', 'uptimeSec');
  });

  it('process check: event-loop lag p95 is real ms (unit regression — finding 11)', async () => {
    const { service } = makeService();
    await sleep(50); // let the 20 ms probe tick a few times
    // Deterministic ~300 ms main-thread block → one coalesced large lag sample.
    const t0 = Date.now();
    while (Date.now() - t0 < 300) { /* spin */ }
    await sleep(80); // let the delayed probe tick record the block
    await service.runNow();
    const row = byName(service.persisted[0])['process'];
    const lag = row?.detail?.eventLoopLagP95Ms as number;
    // Must land in the ~300 ms order: the old /1000 (µs-assumption) conversion
    // would report ~300,000, and reading the raw value as µs would report ~0.3.
    expect(lag).to.be.gte(200);
    expect(lag).to.be.lt(10_000);
    expect(row?.status).to.equal('degraded'); // > 250 ms threshold
    const lagMax = row?.detail?.eventLoopLagMaxMs as number;
    expect(lagMax).to.be.at.least(lag); // max ≥ p95 by construction
    expect(lagMax).to.be.lt(10_000); // same unit regression guard
  });

  it('provider inference (probes off): ok / degraded / stale-unknown / no-activity-unknown', async () => {
    const { service, restoreEnv: restore } = makeService('off');
    restoreEnv = restore;
    const now = Date.now();
    service.providers = [
      providerRow('prov_ok', 'llm'),
      providerRow('prov_fail', 'llm'),
      providerRow('prov_stale', 'asr'),
      providerRow('prov_none', 'channel'),
    ];
    service.callStats = {
      prov_ok: { lastSuccessAt: new Date(now - 60_000), lastFailureAt: null, lastCallAt: new Date(now - 60_000) },
      prov_fail: { lastSuccessAt: null, lastFailureAt: new Date(now - 60_000), lastCallAt: new Date(now - 60_000) },
      prov_stale: { lastSuccessAt: new Date(now - 2 * 3_600_000), lastFailureAt: null, lastCallAt: new Date(now - 2 * 3_600_000) },
    };

    await service.runNow();

    const rows = byName(service.persisted[0]);
    expect(rows['provider:prov_ok']?.status).to.equal('ok');
    expect(rows['provider:prov_ok']?.detail).to.include({ inferred: true });
    expect(rows['provider:prov_fail']?.status).to.equal('degraded');
    expect(rows['provider:prov_stale']?.status).to.equal('unknown');
    expect(rows['provider:prov_stale']?.detail).to.include({ reason: 'no calls in the last 30 min' });
    expect(rows['provider:prov_none']?.status).to.equal('unknown');
    expect(rows['provider:prov_none']?.detail).to.include({ reason: 'no calls in the last 24 h' });
  });

  it('llm probe: runs once, ok on success, cooldown skips the second cycle, recent success skips entirely', async () => {
    const calls: number[] = [];
    const registry = new QuietRegistry();
    const hb = new HeartbeatRegistry(registry);
    const previous = process.env.MONITORING_HEALTH_PROBES;
    process.env.MONITORING_HEALTH_PROBES = 'on';
    const service = new TestHealthCheckService(hb, registry, makeLlmFactory({ calls }), makeStorageFactory({ calls: [] }), makeProbeFactory({ calls: [] }), makeProbeFactory({ calls: [] }), makeConfigService());
    service.providers = [providerRow('prov_llm', 'llm')];

    await service.runNow();
    expect(calls).to.have.length(1);
    const first = byName(service.persisted[0])['provider:prov_llm'];
    expect(first?.status).to.equal('ok');
    expect(first?.detail).to.deep.equal({ probed: true, circuitBreaker: 'closed' }); // P3-01: no registry in this test → 'closed'
    expect(service.getProbeFailures('prov_llm')).to.equal(0);

    // Cooldown: second cycle within 10 min must not probe again (fallback: unknown, no call logs)
    await service.runNow();
    expect(calls).to.have.length(1);
    expect(byName(service.persisted[1])['provider:prov_llm']?.status).to.equal('unknown');

    // Recent success (success row < 10 min old) skips the probe even without cooldown
    service.clearProbeCooldowns();
    service.callStats = { prov_llm: { lastSuccessAt: new Date(), lastFailureAt: null, lastCallAt: new Date() } };
    await service.runNow();
    expect(calls).to.have.length(1);
    expect(byName(service.persisted[2])['provider:prov_llm']?.status).to.equal('ok');
    if (previous === undefined) delete process.env.MONITORING_HEALTH_PROBES;
    else process.env.MONITORING_HEALTH_PROBES = previous;
  });

  it('llm probe: failures map to degraded with consecutive count, reset on success', async () => {
    const calls: number[] = [];
    let fail = true;
    const registry = new QuietRegistry();
    const hb = new HeartbeatRegistry(registry);
    const previous = process.env.MONITORING_HEALTH_PROBES;
    process.env.MONITORING_HEALTH_PROBES = 'on';
    const service = new TestHealthCheckService(
      hb, registry,
      makeLlmFactory({ calls, get fail() { return fail; } }) as LlmProviderFactory,
      makeStorageFactory({ calls: [] }),
      makeProbeFactory({ calls: [] }),
      makeProbeFactory({ calls: [] }),
      makeConfigService(),
    );
    service.providers = [providerRow('prov_llm', 'llm')];

    await service.runNow();
    let row = byName(service.persisted[0])['provider:prov_llm'];
    expect(row?.status).to.equal('degraded');
    expect(row?.detail).to.include({ probed: true, probeError: 'probe failed', consecutiveProbeFailures: 1 });
    expect(service.getProbeFailures('prov_llm')).to.equal(1);

    service.clearProbeCooldowns(); // clear cooldown for the next probe
    await service.runNow();
    row = byName(service.persisted[1])['provider:prov_llm'];
    expect(row?.detail).to.include({ consecutiveProbeFailures: 2 });
    expect(service.getProbeFailures('prov_llm')).to.equal(2);

    fail = false;
    service.clearProbeCooldowns();
    await service.runNow();
    row = byName(service.persisted[2])['provider:prov_llm'];
    expect(row?.status).to.equal('ok');
    expect(service.getProbeFailures('prov_llm')).to.equal(0);
    if (previous === undefined) delete process.env.MONITORING_HEALTH_PROBES;
    else process.env.MONITORING_HEALTH_PROBES = previous;
  });

  it('storage probe: list("", 1) once, cooldown skips the second cycle', async () => {
    const calls: number[] = [];
    const registry = new QuietRegistry();
    const hb = new HeartbeatRegistry(registry);
    const previous = process.env.MONITORING_HEALTH_PROBES;
    process.env.MONITORING_HEALTH_PROBES = 'on';
    const service = new TestHealthCheckService(hb, registry, makeLlmFactory({ calls: [] }), makeStorageFactory({ calls }), makeProbeFactory({ calls: [] }), makeProbeFactory({ calls: [] }), makeConfigService());
    service.providers = [providerRow('prov_s3', 'storage')];

    await service.runNow();
    expect(calls).to.have.length(1);
    expect(byName(service.persisted[0])['provider:prov_s3']?.status).to.equal('ok');

    await service.runNow();
    expect(calls).to.have.length(1);
    if (previous === undefined) delete process.env.MONITORING_HEALTH_PROBES;
    else process.env.MONITORING_HEALTH_PROBES = previous;
  });

  it('provider fetch failure does not discard the cycle (db/process/heartbeats still persist)', async () => {
    const { service } = makeService();
    service.providersFetchError = 'providers query failed';

    await service.runNow();

    const rows = byName(service.persisted[0]);
    expect(rows['db']?.status).to.equal('ok');
    expect(rows['process']).to.be.an('object');
    expect(rows['service_heartbeat:health-checks']?.status).to.equal('ok');
  });

  it('checkReady(): ready on success, unavailable with reason on failure and on timeout', async () => {
    const { service, restoreEnv: restore } = makeService();
    restoreEnv = restore;

    const ok = await service.checkReady();
    expect(ok).to.deep.equal({ ready: true });

    service.pingDbMode = 'error';
    const failed = await service.checkReady();
    expect(failed.ready).to.equal(false);
    expect(failed.reason).to.equal('db down');

    service.pingDbMode = 'hang';
    const timedOut = await service.checkReady();
    expect(timedOut.ready).to.equal(false);
    expect(timedOut.reason).to.equal('timeout');
  }, 15_000);

  it('probes default to on when MONITORING_HEALTH_PROBES is unset', async () => {
    const calls: number[] = [];
    const registry = new QuietRegistry();
    const hb = new HeartbeatRegistry(registry);
    const previous = process.env.MONITORING_HEALTH_PROBES;
    delete process.env.MONITORING_HEALTH_PROBES;
    const service = new TestHealthCheckService(hb, registry, makeLlmFactory({ calls }), makeStorageFactory({ calls: [] }), makeProbeFactory({ calls: [] }), makeProbeFactory({ calls: [] }), makeConfigService());
    service.providers = [providerRow('prov_llm', 'llm')];

    await service.runNow();
    expect(calls).to.have.length(1); // probe ran — default on
    if (previous === undefined) delete process.env.MONITORING_HEALTH_PROBES;
    else process.env.MONITORING_HEALTH_PROBES = previous;
  });

  it('snapshot.overall: worst non-unknown status — unknown checks are ignored', async () => {
    const { service, hb } = makeService();
    hb.declareInterval('imap-inbound', 60_000); // known service, never ticked → unknown

    await service.runNow();
    // unknowns present (unticked services), no down → healthy overall
    expect(byName(service.persisted[0])['service_heartbeat:imap-inbound']?.status).to.equal('unknown');
    expect(service.getSnapshot().overall).to.equal('ok');

    service.poolStats = { poolTotal: 5, poolIdle: 0, poolWaiting: 2 };
    await service.runNow();
    expect(service.getSnapshot().overall).to.equal('degraded');

    service.pingDbMode = 'error';
    await service.runNow();
    expect(service.getSnapshot().overall).to.equal('down');
  });
});

describe('HealthCheckService health-check metrics (specs/health-check-metrics-spec.md)', () => {
  let restoreEnv: (() => void) | undefined;

  afterEach(() => {
    restoreEnv?.();
    restoreEnv = undefined;
  });

  it('runCheckCycle publishes health_check_status with the exact label sets and encoded values', async () => {
    const { service, registry, hb, restoreEnv: restore } = makeService('off');
    restoreEnv = restore;
    hb.tick('conversation-timeout', 60_000);
    service.providers = [providerRow('prov_llm', 'llm')];
    service.callStats = { prov_llm: { lastSuccessAt: new Date(), lastFailureAt: null, lastCallAt: new Date() } };

    await service.runNow();

    const status = registry.snapshot().gauges.health_check_status;
    expect(status?.['check=db']).to.equal(0); // ok
    expect(status?.['check=process']).to.be.oneOf([0, 1]); // load-dependent, never down/unknown
    expect(status?.['check=service_heartbeat,service=conversation-timeout']).to.equal(0);
    expect(status?.['check=service_heartbeat,service=health-checks']).to.equal(0);
    expect(status?.['check=provider,provider_id=prov_llm,provider_type=llm']).to.equal(0);
    // Label sets come from the check definitions — raw check names never leak into label values.
    expect(Object.keys(status ?? {})).to.not.include('check=service_heartbeat:health-checks');
    expect(Object.keys(status ?? {})).to.not.include('check=provider:prov_llm');
  });

  it('health_check_latency_ms is observed on the db check only — not on heartbeats or inferred providers', async () => {
    const { service, registry, restoreEnv: restore } = makeService('off');
    restoreEnv = restore;
    service.providers = [providerRow('prov_llm', 'llm')];
    service.callStats = { prov_llm: { lastSuccessAt: new Date(), lastFailureAt: null, lastCallAt: new Date() } };

    await service.runNow();

    const latency = registry.snapshot().histograms.health_check_latency_ms;
    const db = latency?.['check=db'];
    expect(db?.count).to.be.gte(1);
    expect(db?.buckets).to.have.length(12); // 11 configured boundaries + +Inf
    expect(latency).to.not.have.property('check=service_heartbeat,service=health-checks');
    expect(latency).to.not.have.property('check=provider,provider_id=prov_llm,provider_type=llm');
  });

  it('unknown status publishes gauge 3 (never-ticked heartbeats and providers without call history)', async () => {
    const { service, registry, hb, restoreEnv: restore } = makeService('off');
    restoreEnv = restore;
    hb.declareInterval('imap-inbound', 60_000); // known service, never ticked
    service.providers = [providerRow('prov_none', 'channel')]; // no call stats

    await service.runNow();

    const status = registry.snapshot().gauges.health_check_status;
    expect(status?.['check=service_heartbeat,service=imap-inbound']).to.equal(3);
    expect(status?.['check=provider,provider_id=prov_none,provider_type=channel']).to.equal(3);
  });

  it('degraded publishes 1 and down publishes 2', async () => {
    const { service, registry, restoreEnv: restore } = makeService();
    restoreEnv = restore;
    service.poolStats = { poolTotal: 5, poolIdle: 0, poolWaiting: 2 };
    await service.runNow();
    expect(registry.snapshot().gauges.health_check_status?.['check=db']).to.equal(1);

    service.pingDbMode = 'error';
    await service.runNow();
    expect(registry.snapshot().gauges.health_check_status?.['check=db']).to.equal(2);
  });

  it('check timeout publishes gauge 2 with no histogram observation', async () => {
    const { service, registry, restoreEnv: restore } = makeService();
    restoreEnv = restore;
    service.setCheckTimeoutMs(300); // seam: production checks time out at 10 s
    service.pingDbMode = 'hang'; // pingDb hangs 10 s ≫ 300 ms

    await service.runNow();

    const rows = byName(service.persisted[0]);
    expect(rows['db']?.status).to.equal('down');
    expect(rows['db']?.detail).to.deep.equal({ error: 'timeout' });
    expect(registry.snapshot().gauges.health_check_status?.['check=db']).to.equal(2);
    expect(registry.snapshot().histograms.health_check_latency_ms).to.equal(undefined); // no observation
  });
});

describe('overallHealthStatus (global status aggregation)', () => {
  const check = (status: HealthCheckStatus): HealthCheckResult => ({ name: 'check', status });

  it('ignores unknown checks — a healthy system with not-yet-known checks reports ok', () => {
    expect(overallHealthStatus([check('ok'), check('ok'), check('unknown')])).to.equal('ok');
  });

  it('down wins over degraded and ok', () => {
    expect(overallHealthStatus([check('ok'), check('degraded'), check('down'), check('unknown')])).to.equal('down');
  });

  it('degraded wins over ok', () => {
    expect(overallHealthStatus([check('ok'), check('degraded'), check('unknown')])).to.equal('degraded');
  });

  it('no checks, or all unknown, → unknown', () => {
    expect(overallHealthStatus([])).to.equal('unknown');
    expect(overallHealthStatus([check('unknown'), check('unknown')])).to.equal('unknown');
  });
});
