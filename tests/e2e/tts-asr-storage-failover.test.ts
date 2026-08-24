import 'reflect-metadata';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { container } from 'tsyringe';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { authed, resetDatabase } from '../utils';
import { db } from '../../src/db/index';
import { providerCallLogs, fallbackEvents, providers } from '../../src/db/schema';
import { and, eq } from 'drizzle-orm';
import { TtsProviderBase } from '../../src/services/providers/tts/TtsProviderBase';
import { AsrProviderBase } from '../../src/services/providers/asr/AsrProviderBase';
import { CallLogger } from '../../src/services/monitoring/CallLogger';
import { LocalStorageProvider } from '../../src/services/providers/storage/LocalStorageProvider';
import type { AudioFormat } from '../../src/types/audio';
import type { GeneratedAudioChunk } from '../../src/services/providers/tts/ITtsProvider';

/**
 * P3-04: TTS/ASR/storage failover wrappers — e2e.
 *
 * The wrapper CLASSES come from the app's module graph (setup.ts seams) so
 * `instanceof CircuitOpenError` and breaker identity match; the provider
 * instances are test-world base subclasses (real P1-03 instrumentation), so
 * their call-log rows flow through the TEST-world CallLogger — flushed
 * directly via the test-world container.
 */

// --- test-world provider doubles with real base instrumentation ---

class TestTts extends TtsProviderBase<Record<string, unknown>> {
  failStart?: Error;
  failSendText?: Error;
  texts: string[] = [];
  sendAttempts = 0;
  private chunkSeq = 0;

  async init(): Promise<void> {}
  getSupportedFormats(): AudioFormat[] {
    return ['mp3'];
  }
  getOutputFormat(): AudioFormat {
    return 'mp3';
  }
  protected async doStart(): Promise<void> {
    if (this.failStart) throw this.failStart;
  }
  protected async doEnd(): Promise<void> {}
  protected async doSendText(text: string): Promise<void> {
    this.sendAttempts += 1;
    if (this.failSendText) throw this.failSendText;
    this.texts.push(text);
    this.chunkSeq += 1;
    await this.handleSpeechGenerating({
      chunkId: `c${this.chunkSeq}`,
      ordinal: this.chunkSeq - 1,
      audio: Buffer.from('x'),
      audioFormat: 'mp3',
      isFinal: false,
    });
  }
}

class TestAsr extends AsrProviderBase<Record<string, unknown>> {
  failInit?: Error;
  failStart?: Error;
  audioReceived: Buffer[] = [];
  private finalSeq = 0;

  async init(): Promise<void> {
    await super.init();
    if (this.failInit) throw this.failInit;
  }
  getSupportedInputFormats(): AudioFormat[] {
    return ['pcm_16000'];
  }
  protected async doStart(): Promise<void> {
    if (this.failStart) throw this.failStart;
  }
  protected async doStop(): Promise<void> {}
  protected async doSendAudio(audio: Buffer): Promise<void> {
    this.audioReceived.push(audio);
    // Emit a final transcript — the base only marks a session ok when it saw ≥1 final.
    this.finalSeq += 1;
    this.handleRecognized(`f${this.finalSeq}`, 'final');
  }
}

// --- helpers ---

function authError(): Error {
  const e = new Error('invalid api key');
  e.status = 401;
  return e;
}

function serverError(): Error {
  const e = new Error('bad gateway');
  e.status = 502;
  return e;
}

async function createProvider(body: Record<string, unknown>) {
  const res = await authed().post('/api/providers').send(body);
  expect(res.status).to.equal(201);
  return res.body;
}

/** The app-world chain for a provider (dual module graph — seam, not container). */
async function chainOf(providerId: string) {
  return (globalThis as any).__TEST_FALLBACK_RESOLVER__.resolveChain(providerId);
}

/** Flushes the TEST-world call-log buffer (provider doubles record through it). */
async function flushCallLogs(): Promise<void> {
  await container.resolve(CallLogger).flushNow();
}

async function callLogRows(opts: { providerId?: string; operation?: string }) {
  const conditions = [];
  if (opts.providerId) conditions.push(eq(providerCallLogs.providerId, opts.providerId));
  if (opts.operation) conditions.push(eq(providerCallLogs.operation, opts.operation));
  return db.select().from(providerCallLogs).where(conditions.length ? and(...conditions) : undefined);
}

async function fallbackRows(providerId: string) {
  return db.select().from(fallbackEvents).where(eq(fallbackEvents.providerId, providerId));
}

describe('P3-04 TTS/ASR/storage failover (e2e)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('TTS', () => {
    it('fails over on start() rejection: fallback serves, transition row + attributed session rows', async () => {
      const fb = await createProvider({
        id: 'tts_fb_e2e',
        name: 'TTS FB',
        providerType: 'tts',
        apiType: 'openai',
        config: { apiKey: 'sk-e2e-fb' },
      });
      const primary = await createProvider({
        id: 'tts_primary_e2e',
        name: 'TTS P',
        providerType: 'tts',
        apiType: 'openai',
        config: { apiKey: 'sk-e2e-p' },
        fallbacks: [{ providerId: fb.id }],
      });

      const chain = await chainOf(primary.id);
      expect(chain.map((s: { provider: { id: string } }) => s.provider.id)).to.deep.equal([primary.id, fb.id]);

      const primaryInstance = new TestTts({ apiKey: 'sk-e2e-p' });
      primaryInstance.providerId = primary.id;
      primaryInstance.providerApiType = 'openai';
      primaryInstance.failStart = authError();
      const fbInstance = new TestTts({ apiKey: 'sk-e2e-fb' });
      fbInstance.providerId = fb.id;
      fbInstance.providerApiType = 'openai';

      const wrapper = new (globalThis as any).__TEST_FAILOVER_TTS__(
        primary.id,
        primaryInstance,
        chain.slice(1),
        { provider: 'openai', model: 'tts-1' },
        {
          factory: { createProvider: async () => fbInstance },
          breakerRegistry: (globalThis as any).__TEST_BREAKER_REGISTRY__,
          fallbackEvents: (globalThis as any).__TEST_FALLBACK_EVENTS__,
          metrics: (globalThis as any).__TEST_METRICS_REGISTRY__,
          precreatedInstances: new Map([[fb.id, fbInstance]]),
        },
      );

      const chunks: GeneratedAudioChunk[] = [];
      wrapper.setOnSpeechGenerating(async (c: GeneratedAudioChunk) => chunks.push(c));

      await wrapper.init();
      await wrapper.start(); // primary fails -> fb
      await wrapper.sendText('hello');
      await wrapper.end();

      expect(chunks).to.have.length(1);
      expect(primaryInstance.texts).to.have.length(0);
      expect(fbInstance.texts).to.deep.equal(['hello']);

      // Transition event — recorded + marked succeeded by the wrapper.
      const rows = await fallbackRows(primary.id);
      expect(rows).to.have.length(1);
      expect(rows[0]).to.include({
        fallbackProviderId: fb.id,
        providerType: 'tts',
        operation: 'tts.session',
        reason: 'auth',
        success: true,
      });

      // Call-log attribution: primary's failed attempt + fallback's session row
      // stamped with fallback_provider_id.
      await flushCallLogs();
      const primaryLogs = await callLogRows({ providerId: primary.id, operation: 'tts.session' });
      expect(primaryLogs).to.have.length(1);
      expect(primaryLogs[0].ok).to.equal(false);
      expect(primaryLogs[0].errorCode).to.equal('auth');
      const fbLogs = await callLogRows({ providerId: fb.id, operation: 'tts.session' });
      expect(fbLogs).to.have.length(1);
      expect(fbLogs[0].ok).to.equal(true);
      expect(fbLogs[0].fallbackProviderId).to.equal(primary.id); /* call-log column = the primary this fallback served */
    });

    it('fails over on a pre-audio sendText rejection and re-sends on the fallback', async () => {
      const fb = await createProvider({
        id: 'tts_fb2_e2e',
        name: 'TTS FB2',
        providerType: 'tts',
        apiType: 'openai',
        config: { apiKey: 'sk-e2e-fb2' },
      });
      const primary = await createProvider({
        id: 'tts_primary2_e2e',
        name: 'TTS P2',
        providerType: 'tts',
        apiType: 'openai',
        config: { apiKey: 'sk-e2e-p2' },
        fallbacks: [{ providerId: fb.id }],
      });

      const chain = await chainOf(primary.id);
      const primaryInstance = new TestTts({});
      primaryInstance.providerId = primary.id;
      primaryInstance.providerApiType = 'openai';
      primaryInstance.failSendText = serverError();
      const fbInstance = new TestTts({});
      fbInstance.providerId = fb.id;
      fbInstance.providerApiType = 'openai';

      const wrapper = new (globalThis as any).__TEST_FAILOVER_TTS__(
        primary.id,
        primaryInstance,
        chain.slice(1),
        { provider: 'openai', model: 'tts-1' },
        {
          factory: { createProvider: async () => fbInstance },
          breakerRegistry: (globalThis as any).__TEST_BREAKER_REGISTRY__,
          fallbackEvents: (globalThis as any).__TEST_FALLBACK_EVENTS__,
          metrics: (globalThis as any).__TEST_METRICS_REGISTRY__,
          precreatedInstances: new Map([[fb.id, fbInstance]]),
        },
      );

      const chunks: GeneratedAudioChunk[] = [];
      wrapper.setOnSpeechGenerating(async (c: GeneratedAudioChunk) => chunks.push(c));

      await wrapper.init();
      await wrapper.start(); // primary starts fine
      await wrapper.sendText('hi there'); // primary fails (502, one retry) -> fb
      await wrapper.end();

      expect(chunks).to.have.length(1);
      expect(fbInstance.texts).to.deep.equal(['hi there']);
      expect(primaryInstance.sendAttempts).to.equal(1); // the direct sendText attempt is not retried — retries apply to chain-walk steps

      const rows = await fallbackRows(primary.id);
      expect(rows).to.have.length(1);
      expect(rows[0]).to.include({ fallbackProviderId: fb.id, providerType: 'tts', reason: 'server_error', success: true });

      await flushCallLogs();
      const fbLogs = await callLogRows({ providerId: fb.id, operation: 'tts.session' });
      expect(fbLogs).to.have.length(1);
      expect(fbLogs[0].fallbackProviderId).to.equal(primary.id); /* call-log column = the primary this fallback served */
    });
  });

  describe('ASR', () => {
    it('fails over on init() rejection: the fallback is initialised and takes sessions', async () => {
      const fb = await createProvider({
        id: 'asr_fb_e2e',
        name: 'ASR FB',
        providerType: 'asr',
        apiType: 'elevenlabs',
        config: { apiKey: 'sk-e2e-asr-fb' },
      });
      const primary = await createProvider({
        id: 'asr_primary_e2e',
        name: 'ASR P',
        providerType: 'asr',
        apiType: 'elevenlabs',
        config: { apiKey: 'sk-e2e-asr-p' },
        fallbacks: [{ providerId: fb.id }],
      });

      const chain = await chainOf(primary.id);
      const primaryInstance = new TestAsr({});
      primaryInstance.providerId = primary.id;
      primaryInstance.providerApiType = 'elevenlabs';
      primaryInstance.failInit = authError();
      const fbInstance = new TestAsr({});
      fbInstance.providerId = fb.id;
      fbInstance.providerApiType = 'elevenlabs';

      const wrapper = new (globalThis as any).__TEST_FAILOVER_ASR__(
        primary.id,
        primaryInstance,
        chain.slice(1),
        {},
        {
          factory: { createProvider: async (row: { id: string }) => (row.id === fb.id ? fbInstance : primaryInstance) },
          breakerRegistry: (globalThis as any).__TEST_BREAKER_REGISTRY__,
          fallbackEvents: (globalThis as any).__TEST_FALLBACK_EVENTS__,
          metrics: (globalThis as any).__TEST_METRICS_REGISTRY__,
        },
      );

      await wrapper.init(); // primary init fails -> fb
      await wrapper.start(); // primary start re-attempted (chain walk) -> fb takes the session
      await wrapper.sendAudio(Buffer.from('pcm-bytes'));
      await wrapper.stop();
      await wrapper.cleanup(); // base flushes the session row on cleanup (stop does not)

      expect(fbInstance.audioReceived).to.have.length(1);
      expect(fbInstance.audioReceived[0].toString()).to.equal('pcm-bytes');
      expect(primaryInstance.audioReceived).to.have.length(0);

      const rows = await fallbackRows(primary.id);
      // init() walk + start() walk each record the primary->fb transition (per-turn chain walk).
      expect(rows).to.have.length(2);
      for (const row of rows) {
        expect(row).to.include({ fallbackProviderId: fb.id, providerType: 'asr', operation: 'asr.session', reason: 'auth', success: true });
      }

      await flushCallLogs();
      const fbLogs = await callLogRows({ providerId: fb.id, operation: 'asr.session' });
      expect(fbLogs).to.have.length(1);
      expect(fbLogs[0].ok).to.equal(true);
      expect(fbLogs[0].fallbackProviderId).to.equal(primary.id); /* call-log column = the primary this fallback served */
    });

    it('fails over on start() rejection when init succeeded: the fallback is init()-ed lazily', async () => {
      const fb = await createProvider({
        id: 'asr_fb2_e2e',
        name: 'ASR FB2',
        providerType: 'asr',
        apiType: 'elevenlabs',
        config: { apiKey: 'sk-e2e-asr-fb2' },
      });
      const primary = await createProvider({
        id: 'asr_primary2_e2e',
        name: 'ASR P2',
        providerType: 'asr',
        apiType: 'elevenlabs',
        config: { apiKey: 'sk-e2e-asr-p2' },
        fallbacks: [{ providerId: fb.id }],
      });

      const chain = await chainOf(primary.id);
      const primaryInstance = new TestAsr({});
      primaryInstance.providerId = primary.id;
      primaryInstance.providerApiType = 'elevenlabs';
      primaryInstance.failStart = authError();
      const fbInstance = new TestAsr({});
      fbInstance.providerId = fb.id;
      fbInstance.providerApiType = 'elevenlabs';

      const wrapper = new (globalThis as any).__TEST_FAILOVER_ASR__(
        primary.id,
        primaryInstance,
        chain.slice(1),
        {},
        {
          factory: { createProvider: async (row: { id: string }) => (row.id === fb.id ? fbInstance : primaryInstance) },
          breakerRegistry: (globalThis as any).__TEST_BREAKER_REGISTRY__,
          fallbackEvents: (globalThis as any).__TEST_FALLBACK_EVENTS__,
          metrics: (globalThis as any).__TEST_METRICS_REGISTRY__,
        },
      );

      await wrapper.init(); // primary inits fine
      await wrapper.start(); // primary start fails -> fb (lazy init + start)
      await wrapper.stop();
      await wrapper.cleanup(); // base flushes the session row on cleanup (stop does not)

      const rows = await fallbackRows(primary.id);
      expect(rows).to.have.length(1);
      expect(rows[0]).to.include({ fallbackProviderId: fb.id, providerType: 'asr', reason: 'auth', success: true });

      await flushCallLogs();
      const fbLogs = await callLogRows({ providerId: fb.id, operation: 'asr.session' });
      expect(fbLogs).to.have.length(1);
      expect(fbLogs[0].fallbackProviderId).to.equal(primary.id); /* call-log column = the primary this fallback served */
    });
  });

  describe('storage', () => {
    function makeBasePaths(): { primary: string; fb: string } {
      const blockerFile = path.join(os.tmpdir(), `bonsai-e2e-storage-block-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      fs.writeFileSync(blockerFile, 'x');
      const primaryBase = path.join(blockerFile, 'sub'); // ENOTDIR on mkdir
      const fbBase = fs.mkdtempSync(path.join(os.tmpdir(), 'bonsai-e2e-storage-fb-'));
      return { primary: primaryBase, fb: fbBase };
    }

    it('fails over when the primary instance creation fails (init on a broken path); download follows; delete is primary-only', async () => {
      const { primary: primaryBase, fb: fbBase } = makeBasePaths();
      const fb = await createProvider({
        id: 'stg_fb_e2e',
        name: 'STG FB',
        providerType: 'storage',
        apiType: 'local',
        config: { basePath: fbBase },
      });
      const primary = await createProvider({
        id: 'stg_primary_e2e',
        name: 'STG P',
        providerType: 'storage',
        apiType: 'local',
        config: { basePath: primaryBase },
        fallbacks: [{ providerId: fb.id }],
      });

      const chain = await chainOf(primary.id);
      const [primaryRow] = await db.select().from(providers).where(eq(providers.id, primary.id));

      // Stub factory mirroring the real one (init + identity stamp) — but with
      // direct construction: the real factory's `await import()` loads the
      // provider in a second module graph under e2e, which breaks the
      // `instanceof StorageProviderBase` stamp check (call-log rows would be
      // silently unattributed). Direct construction stays in the test graph.
      const factory = {
        createProvider: async (row: { id: string; apiType: string; config: Record<string, unknown> }) => {
          const instance = new LocalStorageProvider(row.config as ConstructorParameters<typeof LocalStorageProvider>[0]);
          await instance.init();
          instance.providerId = row.id;
          instance.providerApiType = row.apiType;
          return instance;
        },
      };

      const wrapper = new (globalThis as any).__TEST_FAILOVER_STORAGE__(
        primaryRow,
        chain.slice(1),
        {},
        {
          factory,
          breakerRegistry: (globalThis as any).__TEST_BREAKER_REGISTRY__,
          fallbackEvents: (globalThis as any).__TEST_FALLBACK_EVENTS__,
          metrics: (globalThis as any).__TEST_METRICS_REGISTRY__,
        },
      );

      // upload: primary instance creation rejects (ENOTDIR) -> fallback serves
      const payload = Buffer.from('e2e-storage-failover');
      const url = await wrapper.upload('conv/k1.bin', payload);
      expect(typeof url).to.equal('string');
      expect(fs.readFileSync(path.join(fbBase, 'conv/k1.bin')).toString()).to.equal('e2e-storage-failover');

      // download: primary still broken -> fallback serves
      const data = await wrapper.download('conv/k1.bin');
      expect(data.toString()).to.equal('e2e-storage-failover');

      // delete: primary only — rejects (no failover for non-transfer ops)
      let deleted: unknown = null;
      try {
        await wrapper.delete('conv/k1.bin');
      } catch (error) {
        deleted = error;
      }
      expect(deleted).to.not.equal(null);

      const rows = await fallbackRows(primary.id);
      // upload + download each recorded one transition; delete failed at instance creation (no row)
      expect(rows).to.have.length(2);
      for (const row of rows) {
        expect(row).to.include({ fallbackProviderId: fb.id, providerType: 'storage', success: true });
      }
      expect(rows.map((r) => r.operation).sort()).to.deep.equal(['storage.download', 'storage.upload']);

      await flushCallLogs();
      const fbLogs = await callLogRows({ providerId: fb.id, operation: 'storage.upload' });
      expect(fbLogs).to.have.length(1);
      expect(fbLogs[0].ok).to.equal(true);
      expect(fbLogs[0].fallbackProviderId).to.equal(primary.id); /* call-log column = the primary this fallback served */
      // The broken primary never reached an operation — no call-log rows for it.
      const primaryLogs = await callLogRows({ providerId: primary.id });
      expect(primaryLogs).to.have.length(0);
    });
  });
});
