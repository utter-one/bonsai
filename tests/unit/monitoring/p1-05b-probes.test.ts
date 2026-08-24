import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { HeartbeatRegistry } from '../../../src/services/monitoring/HeartbeatRegistry';
import { HealthCheckService, type HealthCheckResult } from '../../../src/services/monitoring/HealthCheckService';
import { MetricsRegistry, type MetricSampleRow } from '../../../src/services/monitoring/MetricsRegistry';
import type { ProviderCallRecord } from '../../../src/services/monitoring/ProviderCallRecorder';
import { AsrProviderFactory } from '../../../src/services/providers/asr/AsrProviderFactory';
import { TtsProviderFactory } from '../../../src/services/providers/tts/TtsProviderFactory';
import type { SecretRefUtils } from '../../../src/services/secrets/SecretRefUtils';
import { AzureAsrProvider } from '../../../src/services/providers/asr/AzureAsrProvider';
import type { AssemblyAiAsrProviderConfig, AssemblyAiAsrSettings } from '../../../src/services/providers/asr/AssemblyAiAsrProvider';
import { AssemblyAiAsrProvider } from '../../../src/services/providers/asr/AssemblyAiAsrProvider';
import type { DeepgramAsrProviderConfig, DeepgramAsrSettings } from '../../../src/services/providers/asr/DeepgramAsrProvider';
import { DeepgramAsrProvider } from '../../../src/services/providers/asr/DeepgramAsrProvider';
import type { ElevenLabsAsrProviderConfig, ElevenLabsAsrSettings } from '../../../src/services/providers/asr/ElevenLabsAsrProvider';
import { ElevenLabsAsrProvider } from '../../../src/services/providers/asr/ElevenLabsAsrProvider';
import type { SonioxAsrProviderConfig, SonioxAsrSettings } from '../../../src/services/providers/asr/SonioxAsrProvider';
import { SonioxAsrProvider } from '../../../src/services/providers/asr/SonioxAsrProvider';
import type { SpeechmaticsAsrProviderConfig, SpeechmaticsAsrSettings } from '../../../src/services/providers/asr/SpeechmaticsAsrProvider';
import { SpeechmaticsAsrProvider } from '../../../src/services/providers/asr/SpeechmaticsAsrProvider';
import type { AmazonPollyTtsProviderConfig, AmazonPollyTtsSettings } from '../../../src/services/providers/tts/AmazonPollyTtsProvider';
import { AmazonPollyTtsProvider } from '../../../src/services/providers/tts/AmazonPollyTtsProvider';
import type { DeepgramTtsProviderConfig, DeepgramTtsSettings } from '../../../src/services/providers/tts/DeepgramTtsProvider';
import { DeepgramTtsProvider } from '../../../src/services/providers/tts/DeepgramTtsProvider';
import type { ElevenLabsTtsProviderConfig, ElevenLabsTtsSettings } from '../../../src/services/providers/tts/ElevenLabsTtsProvider';
import { ElevenLabsTtsProvider } from '../../../src/services/providers/tts/ElevenLabsTtsProvider';
import type { OpenAiTtsProviderConfig, OpenAiTtsSettings } from '../../../src/services/providers/tts/OpenAiTtsProvider';
import { OpenAiTtsProvider } from '../../../src/services/providers/tts/OpenAiTtsProvider';
import type { SonioxTtsProviderConfig, SonioxTtsSettings } from '../../../src/services/providers/tts/SonioxTtsProvider';
import { SonioxTtsProvider } from '../../../src/services/providers/tts/SonioxTtsProvider';
import type { Provider } from '../../../src/types/models';

/* ── fetch stub (provider ping shape tests) ─────────────────────────────── */

interface FetchCall { url: string; headers: Record<string, string>; }
let fetchCalls: FetchCall[] = [];
let fetchStatus = 200;
const realFetch = globalThis.fetch;

function stubFetch(): void {
  fetchCalls = [];
  fetchStatus = 200;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    fetchCalls.push({
      url,
      headers: { ...(init?.headers as Record<string, string> | undefined) },
    });
    // Speechmatics SDK: temp-key minting for the batch JWT (free, short TTL).
    if (url.endsWith('/api_keys?type=batch')) {
      return new Response(JSON.stringify({ key_value: 'temp-key-123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(null, { status: fetchStatus });
  }) as typeof fetch;
}

/**
 * Awaits a promise and returns its rejection reason; throws if it resolved.
 * (chai-as-promised is not loaded in the unit runner context.)
 */
async function expectRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject, but it resolved');
}

/**
 * Stamps probe identity and swaps the call recorder for a recording stub so
 * tests can assert the `asr.ping`/`tts.ping` rows without a CallLogger/DB.
 */
function withRecorder<T extends object>(instance: T, apiType: string): { records: ProviderCallRecord[] } {
  const records: ProviderCallRecord[] = [];
  const anyInstance = instance as unknown as {
    providerId?: string;
    providerApiType?: string;
    resolveCallRecorder: () => { record: (entry: ProviderCallRecord) => void };
  };
  anyInstance.providerId = 'prov_test';
  anyInstance.providerApiType = apiType;
  anyInstance.resolveCallRecorder = () => ({ record: (entry) => records.push(entry) });
  return { records };
}

/* ── HealthCheckService plumbing (probe branch tests) ───────────────────── */

interface CallStats { lastSuccessAt: Date | null; lastFailureAt: Date | null; lastCallAt: Date | null; }

class QuietRegistry extends MetricsRegistry {
  protected async persistRows(rows: MetricSampleRow[]): Promise<void> { /* no DB in unit tests */ }
  protected onFlushError(err: unknown): void { /* swallow */ }
}

class TestHealthCheckService extends HealthCheckService {
  providers: Provider[] = [];
  callStats: Record<string, CallStats> = {};
  persisted: HealthCheckResult[][] = [];
  protected async pingDb(): Promise<number> { return 1; }
  protected getPoolStats() { return { poolTotal: 1, poolIdle: 1, poolWaiting: 0 }; }
  protected async fetchProviders(): Promise<Provider[]> { return this.providers; }
  protected async fetchRecentCallStats(): Promise<Record<string, CallStats>> { return this.callStats; }
  protected async persistResults(results: HealthCheckResult[]): Promise<void> { this.persisted.push(results); }
}

interface ProbeBehavior { calls: number[]; fail?: boolean; withPing?: boolean; }

/** ASR/TTS probe factory stub: instances expose ping() unless withPing is false. */
function makeProbeFactory(behavior: ProbeBehavior) {
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
  };
}

function makeConfigService(options?: { probeSettings?: Record<string, unknown>; fail?: boolean }) {
  return {
    get: async () => {
      if (options?.fail) throw new Error('config unavailable');
      return {
        notifiers: [],
        rules: {},
        retentionDays: 90,
        probeSettings: { llmProbe: 'models', asrProbe: 'free', ttsProbe: 'free', cooldownMinutes: 0, ...options?.probeSettings },
        alerting: { engineIntervalMinutes: 1, defaultCooldownMinutes: 15 },
      };
    },
  };
}

/** probesEnv is set BEFORE construction — probesEnabled is captured in the constructor. */
function makeService(probesEnv: string | undefined, asrBehavior: ProbeBehavior, ttsBehavior: ProbeBehavior, configOptions?: { probeSettings?: Record<string, unknown>; fail?: boolean }) {
  if (probesEnv === undefined) delete process.env.MONITORING_HEALTH_PROBES;
  else process.env.MONITORING_HEALTH_PROBES = probesEnv;
  const registry = new QuietRegistry();
  const hb = new HeartbeatRegistry(registry);
  const service = new TestHealthCheckService(
    hb, registry,
    { createProviderForEnumeration: async () => ({}) },
    { createProvider: async () => ({ list: async () => [] }) },
    makeProbeFactory(asrBehavior),
    makeProbeFactory(ttsBehavior),
    makeConfigService(configOptions),
  );
  return { service, restoreEnv: () => delete process.env.MONITORING_HEALTH_PROBES };
}

const PROVIDER_CONFIGS: Record<string, Record<string, unknown>> = {
  deepgram: { apiKey: 'k-dg' },
  speechmatics: { apiKey: 'k-sm' },
  azure: { region: 'eastus', subscriptionKey: 'sk-azure' },
  'amazon-polly': { region: 'us-east-1', accessKeyId: 'ak', secretAccessKey: 'sk' },
  cartesia: { apiKey: 'k-cartesia' },
  soniox: { apiKey: 'k-soniox' },
};

function providerRow(id: string, providerType: string, apiType: string): Provider {
  return {
    id,
    name: id,
    description: null,
    providerType,
    apiType,
    config: PROVIDER_CONFIGS[apiType] ?? {},
    fallbacks: [],
    createdBy: null,
    tags: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Provider;
}

function byName(rows: HealthCheckResult[]): Record<string, HealthCheckResult> {
  return Object.fromEntries(rows.map((row) => [row.name, row]));
}

/* ── suites ─────────────────────────────────────────────────────────────── */

describe('P1-05b provider ping() shape (zero-cost liveness endpoints)', () => {
  beforeEach(stubFetch);
  afterEach(() => { globalThis.fetch = realFetch; });

  it('AssemblyAI (us): GET /v2/transcripts?page_size=1 with the raw key (no Bearer prefix)', async () => {
    const provider = new AssemblyAiAsrProvider({ apiKey: 'k-assembly' } as AssemblyAiAsrProviderConfig, {} as AssemblyAiAsrSettings);
    const { records } = withRecorder(provider, 'assemblyai');
    await provider.ping();
    expect(fetchCalls).to.deep.equal([{ url: 'https://api.assemblyai.com/v2/transcripts?page_size=1', headers: { Authorization: 'k-assembly' } }]);
    expect(records).to.have.length(1);
    expect(records[0]).to.include({ operation: 'asr.ping', ok: true, providerId: 'prov_test', providerType: 'asr', apiType: 'assemblyai' });
    expect(records[0].durationMs).to.be.a('number').that.is.gte(0);
  });

  it('AssemblyAI (eu): eu base URL', async () => {
    const provider = new AssemblyAiAsrProvider({ apiKey: 'k-assembly', region: 'eu' } as AssemblyAiAsrProviderConfig, {} as AssemblyAiAsrSettings);
    withRecorder(provider, 'assemblyai');
    await provider.ping();
    expect(fetchCalls[0].url).to.equal('https://api.eu.assemblyai.com/v2/transcripts?page_size=1');
  });

  it('Deepgram ASR: GET /v1/projects?limit=1 with Token auth', async () => {
    const provider = new DeepgramAsrProvider({ apiKey: 'k-dg' } as DeepgramAsrProviderConfig, {} as DeepgramAsrSettings);
    withRecorder(provider, 'deepgram');
    await provider.ping();
    expect(fetchCalls).to.deep.equal([{ url: 'https://api.deepgram.com/v1/projects?limit=1', headers: { Authorization: 'Token k-dg' } }]);
  });

  it('ElevenLabs ASR: GET /v1/models with xi-api-key', async () => {
    const provider = new ElevenLabsAsrProvider({ apiKey: 'k-11' } as ElevenLabsAsrProviderConfig, {} as ElevenLabsAsrSettings);
    withRecorder(provider, 'elevenlabs');
    await provider.ping();
    expect(fetchCalls).to.deep.equal([{ url: 'https://api.elevenlabs.io/v1/models', headers: { 'xi-api-key': 'k-11' } }]);
  });

  it('Soniox ASR: GET /v1/models (global management base) with Bearer', async () => {
    const provider = new SonioxAsrProvider({ apiKey: 'k-soniox', region: 'eu' } as SonioxAsrProviderConfig, {} as SonioxAsrSettings);
    withRecorder(provider, 'soniox');
    await provider.ping();
    expect(fetchCalls).to.deep.equal([{ url: 'https://api.soniox.com/v1/models', headers: { Authorization: 'Bearer k-soniox' } }]);
  });

  it('Speechmatics ASR: temp batch key (clientRef required by SDK) + region-mapped Jobs API (us)', async () => {
    const provider = new SpeechmaticsAsrProvider({ apiKey: 'k-sm' } as SpeechmaticsAsrProviderConfig, {} as SpeechmaticsAsrSettings);
    withRecorder(provider, 'speechmatics');
    await provider.ping();
    expect(fetchCalls).to.have.length(2);
    // 1) temp-key mint against the management platform with the stored key
    expect(fetchCalls[0].url).to.match(/\/api_keys\?type=batch$/);
    expect(fetchCalls[0].headers.Authorization).to.equal('Bearer k-sm');
    // 2) liveness GET on the Jobs API with the minted temp key
    const jobsCall = fetchCalls.find((call) => call.url === 'https://usa.asr.api.speechmatics.com/v2/jobs');
    expect(jobsCall).to.not.be.undefined;
    expect(jobsCall?.headers.Authorization).to.equal('Bearer temp-key-123');
  });

  it('Speechmatics ASR: apac region maps to the au1 batch base', async () => {
    const provider = new SpeechmaticsAsrProvider({ apiKey: 'k-sm', region: 'apac' } as SpeechmaticsAsrProviderConfig, {} as SpeechmaticsAsrSettings);
    withRecorder(provider, 'speechmatics');
    await provider.ping();
    const jobsCall = fetchCalls.find((call) => call.url === 'https://au1.asr.api.speechmatics.com/v2/jobs');
    expect(jobsCall).to.not.be.undefined;
  });

  it('Deepgram TTS: REST projects call, no WebSocket (init never runs)', async () => {
    const provider = new DeepgramTtsProvider({ apiKey: 'k-dg-tts' } as DeepgramTtsProviderConfig, { provider: 'deepgram' } as DeepgramTtsSettings);
    const { records } = withRecorder(provider, 'deepgram');
    await provider.ping();
    expect(fetchCalls).to.deep.equal([{ url: 'https://api.deepgram.com/v1/projects?limit=1', headers: { Authorization: 'Token k-dg-tts' } }]);
    expect(records).to.have.length(1);
  });

  it('ElevenLabs TTS: GET /v1/models with xi-api-key', async () => {
    const provider = new ElevenLabsTtsProvider({ apiKey: 'k-11-tts' } as ElevenLabsTtsProviderConfig, { provider: 'elevenlabs' } as ElevenLabsTtsSettings);
    withRecorder(provider, 'elevenlabs');
    await provider.ping();
    expect(fetchCalls).to.deep.equal([{ url: 'https://api.elevenlabs.io/v1/models', headers: { 'xi-api-key': 'k-11-tts' } }]);
  });

  it('OpenAI TTS: GET /v1/models with Bearer', async () => {
    const provider = new OpenAiTtsProvider({ apiKey: 'k-oai' } as OpenAiTtsProviderConfig, { provider: 'openai' } as OpenAiTtsSettings);
    withRecorder(provider, 'openai');
    await provider.ping();
    expect(fetchCalls).to.deep.equal([{ url: 'https://api.openai.com/v1/models', headers: { Authorization: 'Bearer k-oai' } }]);
  });

  it('Soniox TTS: GET /v1/models (global management base) with Bearer', async () => {
    const provider = new SonioxTtsProvider({ apiKey: 'k-soniox-tts' } as SonioxTtsProviderConfig, { provider: 'soniox' } as SonioxTtsSettings);
    withRecorder(provider, 'soniox');
    await provider.ping();
    expect(fetchCalls).to.deep.equal([{ url: 'https://api.soniox.com/v1/models', headers: { Authorization: 'Bearer k-soniox-tts' } }]);
  });

  it('Polly TTS: DescribeVoices via the (lazily built) client, no synthesis', async () => {
    const provider = new AmazonPollyTtsProvider(
      { region: 'us-east-1', accessKeyId: 'ak', secretAccessKey: 'sk' } as AmazonPollyTtsProviderConfig,
      { provider: 'amazon-polly' } as AmazonPollyTtsSettings,
    );
    const { records } = withRecorder(provider, 'amazon-polly');
    const sent: unknown[] = [];
    (provider as unknown as { pollyClient: { send: (cmd: unknown) => Promise<unknown> } }).pollyClient = {
      send: async (cmd: unknown) => { sent.push(cmd); return {}; },
    };
    await provider.ping();
    expect(sent).to.have.length(1);
    expect((sent[0] as { input: Record<string, unknown>; constructor: { name: string } }).input).to.deep.equal({});
    expect((sent[0] as { constructor: { name: string } }).constructor.name).to.equal('DescribeVoicesCommand');
    expect(records).to.have.length(1);
    expect(records[0]).to.include({ operation: 'tts.ping', ok: true, providerType: 'tts', apiType: 'amazon-polly' });
  });

  it('non-2xx rejects and records a failed asr.ping row with the status in the error', async () => {
    fetchStatus = 401;
    const provider = new DeepgramAsrProvider({ apiKey: 'k-bad' } as DeepgramAsrProviderConfig, {} as DeepgramAsrSettings);
    const { records } = withRecorder(provider, 'deepgram');
    const error = await expectRejection(provider.ping());
    expect(records).to.have.length(1);
    expect(records[0]).to.include({ operation: 'asr.ping', ok: false, providerId: 'prov_test', providerType: 'asr', apiType: 'deepgram' });
    expect((error as Error).message).to.match(/401/);
    expect(records[0].error).to.match(/401/);
  });

  it('network failure rejects and records a failed tts.ping row', async () => {
    globalThis.fetch = (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch;
    const provider = new ElevenLabsTtsProvider({ apiKey: 'k-11-tts' } as ElevenLabsTtsProviderConfig, { provider: 'elevenlabs' } as ElevenLabsTtsSettings);
    const { records } = withRecorder(provider, 'elevenlabs');
    const error = await expectRejection(provider.ping());
    expect(records).to.have.length(1);
    expect(records[0]).to.include({ operation: 'tts.ping', ok: false });
    expect((error as Error).message).to.match(/ECONNREFUSED/);
    expect(records[0].error).to.match(/ECONNREFUSED/);
  });

  it('unattributed instances (no providerId) ping but do not record', async () => {
    const provider = new OpenAiTtsProvider({ apiKey: 'k-oai' } as OpenAiTtsProviderConfig, { provider: 'openai' } as OpenAiTtsSettings);
    // recorder swapped but no providerId stamp → recordPingCall's guard skips
    const records: ProviderCallRecord[] = [];
    (provider as unknown as { resolveCallRecorder: () => { record: (entry: ProviderCallRecord) => void } }).resolveCallRecorder =
      () => ({ record: (entry) => records.push(entry) });
    await provider.ping();
    expect(fetchCalls).to.have.length(1);
    expect(records).to.have.length(0);
  });
});

describe('P1-05b createProviderForProbing (factories)', () => {
  const asrFactory = new AsrProviderFactory({ resolveObject: async (obj: Record<string, unknown>) => obj } as unknown as SecretRefUtils);
  const ttsFactory = new TtsProviderFactory({ resolveObject: async (obj: Record<string, unknown>) => obj } as unknown as SecretRefUtils);

  it('ASR factory: builds a probeable Deepgram instance and stamps identity', async () => {
    const instance = await asrFactory.createProviderForProbing(providerRow('prov_1', 'asr', 'deepgram'));
    expect(instance).to.be.instanceOf(DeepgramAsrProvider);
    const stamped = instance as unknown as { providerId?: string; providerApiType?: string; ping?: unknown };
    expect(stamped.providerId).to.equal('prov_1');
    expect(stamped.providerApiType).to.equal('deepgram');
    expect(stamped.ping).to.be.a('function');
  });

  it('ASR factory: Speechmatics instance is probeable', async () => {
    const instance = await asrFactory.createProviderForProbing(providerRow('prov_2', 'asr', 'speechmatics'));
    expect(instance).to.be.instanceOf(SpeechmaticsAsrProvider);
    expect((instance as unknown as { ping?: unknown }).ping).to.be.a('function');
  });

  it('ASR factory: Azure instance has NO ping (call-log inference fallback)', async () => {
    const instance = await asrFactory.createProviderForProbing(providerRow('prov_3', 'asr', 'azure'));
    expect(instance).to.be.instanceOf(AzureAsrProvider);
    expect((instance as unknown as { ping?: unknown }).ping).to.not.be.a('function');
  });

  it('TTS factory: builds a probeable Deepgram instance (settings defaults filled)', async () => {
    const instance = await ttsFactory.createProviderForProbing(providerRow('prov_4', 'tts', 'deepgram'));
    expect(instance).to.be.instanceOf(DeepgramTtsProvider);
    expect((instance as unknown as { ping?: unknown }).ping).to.be.a('function');
  });

  it('TTS factory: Polly instance is probeable', async () => {
    const instance = await ttsFactory.createProviderForProbing(providerRow('prov_5', 'tts', 'amazon-polly'));
    expect(instance).to.be.instanceOf(AmazonPollyTtsProvider);
    expect((instance as unknown as { ping?: unknown }).ping).to.be.a('function');
  });

  it('TTS factory: Cartesia and Azure instances have NO ping (inference fallback)', async () => {
    const cartesia = await ttsFactory.createProviderForProbing(providerRow('prov_6', 'tts', 'cartesia'));
    expect((cartesia as unknown as { ping?: unknown }).ping).to.not.be.a('function');
    const azure = await ttsFactory.createProviderForProbing(providerRow('prov_7', 'tts', 'azure'));
    expect((azure as unknown as { ping?: unknown }).ping).to.not.be.a('function');
  });

  it('TTS factory: wrong provider type is rejected', async () => {
    const error = await expectRejection(ttsFactory.createProviderForProbing(providerRow('prov_8', 'asr', 'deepgram')));
    expect((error as Error).message).to.match(/not a TTS provider/);
  });

  it('ASR factory: wrong provider type is rejected', async () => {
    const error = await expectRejection(asrFactory.createProviderForProbing(providerRow('prov_9', 'tts', 'deepgram')));
    expect((error as Error).message).to.match(/not an ASR provider/);
  });
});

describe('P1-05b HealthCheckService ASR/TTS probe branches', () => {
  afterEach(() => { delete process.env.MONITORING_HEALTH_PROBES; });

  it('asr + tts probes: one ping each, ok with probed detail', async () => {
    const asrCalls: number[] = [];
    const ttsCalls: number[] = [];
    const { service, restoreEnv } = makeService('on', { calls: asrCalls }, { calls: ttsCalls });
    service.providers = [providerRow('prov_asr', 'asr', 'deepgram'), providerRow('prov_tts', 'tts', 'soniox')];

    await service.runNow();

    const rows = byName(service.persisted[0]);
    expect(rows['provider:prov_asr']?.status).to.equal('ok');
    expect(rows['provider:prov_asr']?.detail).to.deep.equal({ probed: true, circuitBreaker: 'closed' }); // P3-01: no registry in this test → 'closed'
    expect(rows['provider:prov_tts']?.status).to.equal('ok');
    expect(rows['provider:prov_tts']?.detail).to.deep.equal({ probed: true, circuitBreaker: 'closed' }); // P3-01: no registry in this test → 'closed'
    expect(asrCalls).to.have.length(1);
    expect(ttsCalls).to.have.length(1);
    restoreEnv();
  });

  it('probe failures map to degraded with consecutive count, reset on success (cooldown 0)', async () => {
    let fail = true;
    const asrCalls: number[] = [];
    const { service, restoreEnv } = makeService('on', { calls: asrCalls, get fail() { return fail; } }, { calls: [] });
    service.providers = [providerRow('prov_asr', 'asr', 'deepgram')];

    await service.runNow();
    let row = byName(service.persisted[0])['provider:prov_asr'];
    expect(row?.status).to.equal('degraded');
    expect(row?.detail).to.include({ probed: true, probeError: 'probe failed', consecutiveProbeFailures: 1 });
    expect(service.getProbeFailures('prov_asr')).to.equal(1);

    await service.runNow(); // cooldown 0 → probes again
    row = byName(service.persisted[1])['provider:prov_asr'];
    expect(row?.detail).to.include({ consecutiveProbeFailures: 2 });

    fail = false;
    await service.runNow();
    row = byName(service.persisted[2])['provider:prov_asr'];
    expect(row?.status).to.equal('ok');
    expect(service.getProbeFailures('prov_asr')).to.equal(0);
    expect(asrCalls).to.have.length(3);
    restoreEnv();
  });

  it('asrProbe/ttsProbe "off": call-log inference only, no pings', async () => {
    const asrCalls: number[] = [];
    const ttsCalls: number[] = [];
    const { service, restoreEnv } = makeService('on', { calls: asrCalls }, { calls: ttsCalls },
      { probeSettings: { asrProbe: 'off', ttsProbe: 'off' } });
    service.providers = [providerRow('prov_asr', 'asr', 'deepgram'), providerRow('prov_tts', 'tts', 'soniox')];
    const now = Date.now();
    service.callStats = {
      prov_asr: { lastSuccessAt: new Date(now - 60_000), lastFailureAt: null, lastCallAt: new Date(now - 60_000) },
      prov_tts: { lastSuccessAt: null, lastFailureAt: new Date(now - 60_000), lastCallAt: new Date(now - 60_000) },
    };

    await service.runNow();

    const rows = byName(service.persisted[0]);
    expect(rows['provider:prov_asr']?.status).to.equal('ok');
    expect(rows['provider:prov_asr']?.detail).to.include({ inferred: true });
    expect(rows['provider:prov_tts']?.status).to.equal('degraded');
    expect(asrCalls).to.have.length(0);
    expect(ttsCalls).to.have.length(0);
    restoreEnv();
  });

  it('instance without ping() (Azure/Cartesia path): falls back to inference', async () => {
    const asrCalls: number[] = [];
    const ttsCalls: number[] = [];
    const { service, restoreEnv } = makeService('on', { calls: asrCalls, withPing: false }, { calls: ttsCalls, withPing: false });
    service.providers = [providerRow('prov_asr', 'asr', 'azure'), providerRow('prov_tts', 'tts', 'cartesia')];
    const now = Date.now();
    service.callStats = {
      prov_asr: { lastSuccessAt: new Date(now - 60_000), lastFailureAt: null, lastCallAt: new Date(now - 60_000) },
    };

    await service.runNow();

    const rows = byName(service.persisted[0]);
    expect(rows['provider:prov_asr']?.status).to.equal('ok');
    expect(rows['provider:prov_asr']?.detail).to.include({ inferred: true });
    expect(rows['provider:prov_tts']?.status).to.equal('unknown'); // no recent calls
    expect(rows['provider:prov_tts']?.detail).to.include({ reason: 'no calls in the last 24 h' });
    restoreEnv();
  });

  it('recent success in the last 10 min skips the asr probe (inferred ok)', async () => {
    const asrCalls: number[] = [];
    const { service, restoreEnv } = makeService('on', { calls: asrCalls }, { calls: [] });
    service.providers = [providerRow('prov_asr', 'asr', 'deepgram')];
    service.callStats = { prov_asr: { lastSuccessAt: new Date(), lastFailureAt: null, lastCallAt: new Date() } };

    await service.runNow();

    const row = byName(service.persisted[0])['provider:prov_asr'];
    expect(row?.status).to.equal('ok');
    expect(row?.detail).to.include({ inferred: true });
    expect(asrCalls).to.have.length(0);
    restoreEnv();
  });

  it('MONITORING_HEALTH_PROBES=off disables asr/tts probes even when config says free', async () => {
    const asrCalls: number[] = [];
    const ttsCalls: number[] = [];
    const { service, restoreEnv } = makeService('off', { calls: asrCalls }, { calls: ttsCalls });
    service.providers = [providerRow('prov_asr', 'asr', 'deepgram'), providerRow('prov_tts', 'tts', 'soniox')];

    await service.runNow();

    const rows = byName(service.persisted[0]);
    expect(rows['provider:prov_asr']?.status).to.equal('unknown'); // no call stats, no probe
    expect(rows['provider:prov_tts']?.status).to.equal('unknown');
    expect(asrCalls).to.have.length(0);
    expect(ttsCalls).to.have.length(0);
    restoreEnv();
  });
});
