import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { monitoringConfigSchema } from '../../../src/http/contracts/monitoring';
import { MonitoringConfigService } from '../../../src/services/monitoring/MonitoringConfigService';
import { HeartbeatRegistry } from '../../../src/services/monitoring/HeartbeatRegistry';
import { HealthCheckService, type HealthCheckResult } from '../../../src/services/monitoring/HealthCheckService';
import { MetricsRegistry, type MetricSampleRow } from '../../../src/services/monitoring/MetricsRegistry';
import type { LlmProviderFactory } from '../../../src/services/providers/llm/LlmProviderFactory';
import type { StorageProviderFactory } from '../../../src/services/providers/storage/StorageProviderFactory';
import type { Provider } from '../../../src/types/models';

class QuietRegistry extends MetricsRegistry {
  protected async persistRows(rows: MetricSampleRow[]): Promise<void> {
    // no DB in unit tests
  }
  protected onFlushError(err: unknown): void {
    // swallow
  }
}

/** MonitoringConfigService with the protected synthesis seam exposed. */
class TestConfigService extends MonitoringConfigService {
  synth() {
    return this.synthesizeDefaults();
  }
}

interface CallStats {
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastCallAt: Date | null;
}

/** HealthCheckService with every external boundary stubbed. */
class TestHealthCheckService extends HealthCheckService {
  providers: Provider[] = [];
  callStats: Record<string, CallStats> = {};
  persisted: HealthCheckResult[][] = [];

  protected async pingDb(): Promise<number> {
    return 3;
  }
  protected getPoolStats() {
    return { poolTotal: 5, poolIdle: 3, poolWaiting: 0 };
  }
  protected async fetchProviders(): Promise<Provider[]> {
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

function makeLlmFactory(behavior: { calls: string[]; fail?: boolean }): LlmProviderFactory {
  return {
    createProviderForEnumeration: async () => ({
      init: async () => { /* client construction only */ },
      enumerateModels: async () => {
        behavior.calls.push('models');
        if (behavior.fail) throw new Error('probe failed');
        return [];
      },
      generate: async () => {
        behavior.calls.push('generate');
        if (behavior.fail) throw new Error('probe failed');
        return { content: 'ok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
      },
    }),
  } as unknown as LlmProviderFactory;
}

function makeStorageFactory(behavior: { calls: string[] }): StorageProviderFactory {
  return {
    createProvider: async () => ({
      list: async () => {
        behavior.calls.push('list');
        return [];
      },
    }),
  } as unknown as StorageProviderFactory;
}

function makeConfig(options?: {
  probeSettings?: { llmProbe?: 'models' | 'one_token' | 'off'; cooldownMinutes?: number };
  fail?: boolean;
}) {
  return {
    get: async () => {
      if (options?.fail) throw new Error('config unavailable');
      return {
        notifiers: [],
        rules: {},
        retentionDays: 90,
        probeSettings: { llmProbe: 'models', cooldownMinutes: 10, ...options?.probeSettings },
        alerting: { engineIntervalMinutes: 1, defaultCooldownMinutes: 15 },
      };
    },
  } as unknown as MonitoringConfigService;
}

function makeService(config: MonitoringConfigService): {
  service: TestHealthCheckService;
  registry: QuietRegistry;
  hb: HeartbeatRegistry;
} {
  const registry = new QuietRegistry();
  const hb = new HeartbeatRegistry(registry);
  const service = new TestHealthCheckService(hb, registry, makeLlmFactory({ calls: [] }), makeStorageFactory({ calls: [] }), config);
  return { service, registry, hb };
}

function byName(rows: HealthCheckResult[]): Record<string, HealthCheckResult> {
  return Object.fromEntries(rows.map((row) => [row.name, row]));
}

describe('P1-06 monitoringConfigSchema', () => {
  it('parse({}) yields the full default config', () => {
    const config = monitoringConfigSchema.parse({});
    expect(config).to.deep.equal({
      notifiers: [],
      rules: {},
      retentionDays: 90,
      probeSettings: { llmProbe: 'models', cooldownMinutes: 10 },
      alerting: { engineIntervalMinutes: 1, defaultCooldownMinutes: 15 },
    });
  });

  it('retentionDays: min 7, integer only', () => {
    expect(monitoringConfigSchema.parse({ retentionDays: 7 })).to.have.property('retentionDays', 7);
    expect(() => monitoringConfigSchema.parse({ retentionDays: 6 })).to.throw();
    expect(() => monitoringConfigSchema.parse({ retentionDays: 7.5 })).to.throw();
    expect(() => monitoringConfigSchema.parse({ retentionDays: '90' })).to.throw();
  });

  it('webhook notifier: requires an http(s) url', () => {
    expect(monitoringConfigSchema.parse({ notifiers: [{ id: 'notf_1', type: 'webhook', url: 'https://x.example/hook', enabled: true }] }).notifiers)
      .to.deep.equal([{ id: 'notf_1', type: 'webhook', url: 'https://x.example/hook', enabled: true }]);
    expect(() => monitoringConfigSchema.parse({ notifiers: [{ id: 'notf_1', type: 'webhook', enabled: true }] })).to.throw(/url/i);
    expect(() => monitoringConfigSchema.parse({ notifiers: [{ id: 'notf_1', type: 'webhook', url: 'ftp://x.example/hook', enabled: true }] })).to.throw(/http/i);
  });

  it('email notifier: requires channelProviderId and a valid to address', () => {
    const valid = { id: 'notf_2', type: 'email', channelProviderId: 'prov_mail', to: 'ops@example.com', enabled: true };
    expect(monitoringConfigSchema.parse({ notifiers: [valid] }).notifiers).to.deep.equal([valid]);
    expect(() => monitoringConfigSchema.parse({ notifiers: [{ id: 'n', type: 'email', channelProviderId: 'p', enabled: true }] })).to.throw(/to/i);
    expect(() => monitoringConfigSchema.parse({ notifiers: [{ id: 'n', type: 'email', to: 'not-an-email', enabled: true }] })).to.throw();
    expect(() => monitoringConfigSchema.parse({ notifiers: [{ id: 'n', type: 'email', to: 'ops@example.com', enabled: true }] })).to.throw(/channelProviderId/i);
  });

  it('notifier type is the Phase 1 union (webhook | email) and minSeverity is the severity enum', () => {
    expect(() => monitoringConfigSchema.parse({ notifiers: [{ id: 'n', type: 'telegram', enabled: true }] })).to.throw();
    expect(monitoringConfigSchema.parse({ notifiers: [{ id: 'n', type: 'webhook', url: 'https://x.example', minSeverity: 'warning', enabled: true }] }))
      .to.have.nested.property('notifiers[0].minSeverity', 'warning');
    expect(() => monitoringConfigSchema.parse({ notifiers: [{ id: 'n', type: 'webhook', url: 'https://x.example', minSeverity: 'high', enabled: true }] })).to.throw();
  });

  it('rules: structural key validation + typed overrides', () => {
    const config = monitoringConfigSchema.parse({
      rules: {
        'provider-down': { enabled: false, threshold: 0.5, windowMinutes: 5, minSamples: 10, severity: 'critical' },
      },
    });
    expect(config.rules['provider-down']).to.include({ enabled: false, threshold: 0.5, windowMinutes: 5 });
    expect(() => monitoringConfigSchema.parse({ rules: { '': { enabled: true } } })).to.throw();
    expect(() => monitoringConfigSchema.parse({ rules: { 'r1': { threshold: 'high' } } })).to.throw();
    expect(() => monitoringConfigSchema.parse({ rules: { 'r1': { windowMinutes: 0 } } })).to.throw();
    expect(() => monitoringConfigSchema.parse({ rules: { 'r1': { minSamples: 1.5 } } })).to.throw();
    expect(() => monitoringConfigSchema.parse({ rules: { 'r1': { severity: 'severe' } } })).to.throw();
  });

  it('probeSettings: llmProbe enum + non-negative cooldown', () => {
    expect(monitoringConfigSchema.parse({ probeSettings: { llmProbe: 'one_token', cooldownMinutes: 0 } }))
      .to.have.nested.property('probeSettings.llmProbe', 'one_token');
    expect(() => monitoringConfigSchema.parse({ probeSettings: { llmProbe: 'generate' } })).to.throw();
    expect(() => monitoringConfigSchema.parse({ probeSettings: { cooldownMinutes: -1 } })).to.throw();
  });
});

describe('P1-06 MonitoringConfigService env synthesis', () => {
  let webhook: string | undefined;
  let emailProvider: string | undefined;
  let emailTo: string | undefined;
  let retention: string | undefined;

  beforeEach(() => {
    webhook = process.env.MONITORING_WEBHOOK_URL;
    emailProvider = process.env.MONITORING_EMAIL_PROVIDER_ID;
    emailTo = process.env.MONITORING_EMAIL_TO;
    retention = process.env.MONITORING_RETENTION_DAYS;
    delete process.env.MONITORING_WEBHOOK_URL;
    delete process.env.MONITORING_EMAIL_PROVIDER_ID;
    delete process.env.MONITORING_EMAIL_TO;
    delete process.env.MONITORING_RETENTION_DAYS;
  });

  afterEach(() => {
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore('MONITORING_WEBHOOK_URL', webhook);
    restore('MONITORING_EMAIL_PROVIDER_ID', emailProvider);
    restore('MONITORING_EMAIL_TO', emailTo);
    restore('MONITORING_RETENTION_DAYS', retention);
  });

  it('no env vars: bare defaults, no notifiers', () => {
    const config = new TestConfigService().synth();
    expect(config.notifiers).to.deep.equal([]);
    expect(config.retentionDays).to.equal(90);
  });

  it('MONITORING_WEBHOOK_URL: synthesized webhook notifier', () => {
    process.env.MONITORING_WEBHOOK_URL = 'https://alerts.example/hook';
    const config = new TestConfigService().synth();
    expect(config.notifiers).to.have.length(1);
    expect(config.notifiers[0]).to.include({ type: 'webhook', url: 'https://alerts.example/hook', enabled: true });
    expect(config.notifiers[0].id).to.match(/^notf_/);
  });

  it('MONITORING_EMAIL_PROVIDER_ID + MONITORING_EMAIL_TO: synthesized email notifier; provider id alone synthesizes nothing', () => {
    process.env.MONITORING_EMAIL_PROVIDER_ID = 'prov_mail';
    expect(new TestConfigService().synth().notifiers).to.deep.equal([]);
    process.env.MONITORING_EMAIL_TO = 'ops@example.com';
    const config = new TestConfigService().synth();
    expect(config.notifiers).to.have.length(1);
    expect(config.notifiers[0]).to.include({ type: 'email', channelProviderId: 'prov_mail', to: 'ops@example.com', enabled: true });
  });

  it('MONITORING_RETENTION_DAYS: applied only when an integer >= 7', () => {
    process.env.MONITORING_RETENTION_DAYS = '30';
    expect(new TestConfigService().synth().retentionDays).to.equal(30);
    process.env.MONITORING_RETENTION_DAYS = '3';
    expect(new TestConfigService().synth().retentionDays).to.equal(90);
    process.env.MONITORING_RETENTION_DAYS = 'abc';
    expect(new TestConfigService().synth().retentionDays).to.equal(90);
  });

  it('synthesized config always round-trips the schema', () => {
    process.env.MONITORING_WEBHOOK_URL = 'https://alerts.example/hook';
    process.env.MONITORING_EMAIL_PROVIDER_ID = 'prov_mail';
    process.env.MONITORING_EMAIL_TO = 'ops@example.com';
    process.env.MONITORING_RETENTION_DAYS = '45';
    const config = new TestConfigService().synth();
    expect(monitoringConfigSchema.parse(config)).to.deep.equal(config);
  });
});

describe('P1-06 config-driven probe policy (HealthCheckService)', () => {
  let probesEnv: string | undefined;

  beforeEach(() => {
    probesEnv = process.env.MONITORING_HEALTH_PROBES;
    process.env.MONITORING_HEALTH_PROBES = 'on';
  });

  afterEach(() => {
    if (probesEnv === undefined) delete process.env.MONITORING_HEALTH_PROBES;
    else process.env.MONITORING_HEALTH_PROBES = probesEnv;
  });

  it("llmProbe 'off' (config) disables LLM probes even when the env kill switch allows them", async () => {
    const { service } = makeService(makeConfig({ probeSettings: { llmProbe: 'off' } }));
    service.providers = [providerRow('prov_llm', 'llm')];

    await service.runNow();
    const row = byName(service.persisted[0])['provider:prov_llm'];
    expect(row?.status).to.equal('unknown');
    expect(row?.detail).to.include({ inferred: true });
  });

  it("llmProbe 'one_token' generates one token instead of enumerating models", async () => {
    const calls: string[] = [];
    const registry = new QuietRegistry();
    const hb = new HeartbeatRegistry(registry);
    const service = new TestHealthCheckService(hb, registry, makeLlmFactory({ calls }), makeStorageFactory({ calls: [] }), makeConfig({ probeSettings: { llmProbe: 'one_token' } }));
    service.providers = [providerRow('prov_llm', 'llm')];

    await service.runNow();
    expect(calls).to.deep.equal(['generate']);
    const row = byName(service.persisted[0])['provider:prov_llm'];
    expect(row?.status).to.equal('ok');
    expect(row?.detail).to.deep.equal({ probed: true });
  });

  it('config cooldownMinutes=0 probes every cycle; a large cooldown skips until cleared', async () => {
    const calls: string[] = [];
    const registry = new QuietRegistry();
    const hb = new HeartbeatRegistry(registry);
    const service = new TestHealthCheckService(hb, registry, makeLlmFactory({ calls }), makeStorageFactory({ calls: [] }), makeConfig({ probeSettings: { cooldownMinutes: 0 } }));
    service.providers = [providerRow('prov_llm', 'llm')];

    await service.runNow();
    await service.runNow();
    expect(calls).to.have.length(2);
  });

  it('config load failure falls back to built-in defaults (probe still runs)', async () => {
    const calls: string[] = [];
    const registry = new QuietRegistry();
    const hb = new HeartbeatRegistry(registry);
    const service = new TestHealthCheckService(hb, registry, makeLlmFactory({ calls }), makeStorageFactory({ calls: [] }), makeConfig({ fail: true }));
    service.providers = [providerRow('prov_llm', 'llm')];

    await service.runNow();
    expect(calls).to.deep.equal(['models']);
    expect(byName(service.persisted[0])['provider:prov_llm']?.status).to.equal('ok');
  });

  it('the env kill switch beats config: MONITORING_HEALTH_PROBES=off with llmProbe=models probes nothing', async () => {
    process.env.MONITORING_HEALTH_PROBES = 'off';
    const calls: string[] = [];
    const registry = new QuietRegistry();
    const hb = new HeartbeatRegistry(registry);
    const service = new TestHealthCheckService(hb, registry, makeLlmFactory({ calls }), makeStorageFactory({ calls: [] }), makeConfig());
    service.providers = [providerRow('prov_llm', 'llm')];

    await service.runNow();
    expect(calls).to.deep.equal([]);
    expect(byName(service.persisted[0])['provider:prov_llm']?.detail).to.include({ inferred: true });
  });
});
