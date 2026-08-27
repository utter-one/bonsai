import 'reflect-metadata';
import { WebSocketServer, type WebSocket as WsWebSocket } from 'ws';
import { AddressInfo } from 'node:net';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { container } from 'tsyringe';
import { describe, it, before, after, beforeEach } from 'mocha';
import { expect } from 'chai';
import { CallLogger, type ProviderCallEntry, type ProviderCallLogRow } from '../../../src/services/monitoring/CallLogger';
import { MetricsRegistry } from '../../../src/services/monitoring/MetricsRegistry';
import { ProviderCallRecorder, resetMonitoringAccessorsForTests } from '../../../src/services/monitoring/ProviderCallRecorder';
import { ProviderConnectionTester } from '../../../src/services/providers/connectionTest/ProviderConnectionTester';
import { TtsProviderFactory } from '../../../src/services/providers/tts/TtsProviderFactory';
import { ElevenLabsTtsProvider } from '../../../src/services/providers/tts/ElevenLabsTtsProvider';
import type { ITtsProvider } from '../../../src/services/providers/tts/ITtsProvider';
import type { SecretRefUtils } from '../../../src/services/secrets/SecretRefUtils';
import { NotFoundError, ValidationError } from '../../../src/errors';
import type { Provider } from '../../../src/types/models';
import type { RequestContext } from '../../../src/services/RequestContext';

// --- breaker double (P3-01 test seam) ---

class TestBreakerRegistry {
  successes: string[] = [];
  failures: Array<{ providerId: string; errorCode: string | null | undefined }> = [];

  recordSuccess(providerId: string): void {
    this.successes.push(providerId);
  }

  recordFailure(providerId: string, errorCode: string | null | undefined): void {
    this.failures.push({ providerId, errorCode });
  }

  reset(): void {
    this.successes.length = 0;
    this.failures.length = 0;
  }
}

// --- quiet monitoring doubles (p1-03 pattern) ---

const sharedBreakers = new TestBreakerRegistry();

class QuietCallLogger extends CallLogger {
  rows: ProviderCallLogRow[] = [];

  constructor(breakers: TestBreakerRegistry) {
    super(breakers as never);
  }

  get pendingEntries(): ProviderCallEntry[] {
    return this.buffer;
  }

  clearPending(): void {
    this.buffer.length = 0;
  }

  protected async persistRows(rows: ProviderCallLogRow[]): Promise<void> {
    this.rows.push(...rows);
  }

  protected onFlushError(): void {
    /* captured nowhere — flush cannot fail in this double */
  }
}

class QuietMetrics extends MetricsRegistry {
  protected override async persistRows(_rows: unknown[]): Promise<void> {
    /* discard */
  }

  protected override onFlushError(): void {
    /* discard */
  }
}

const sharedCallLogger = new QuietCallLogger(sharedBreakers);
const sharedMetrics = new QuietMetrics();

// --- fake ElevenLabs streaming-TTS WS server (local, no vendor credentials) ---

type WsMode = 'ok' | 'no-audio' | 'hang';

/**
 * Speaks just enough of the ElevenLabs stream-input protocol for the
 * production ElevenLabsTtsProvider to run its full session lifecycle:
 * bos message in (carries xi_api_key), sentence text in, audio frames out
 * (final frame carries the terminal chunk), clean close on end-of-stream.
 */
function createFakeTtsWsServer() {
  let mode: WsMode = 'ok';
  const authKeys: string[] = []; // xi_api_key from bos messages
  const paths: string[] = [];
  const openSockets = new Set<WsWebSocket>();

  let resolveListening: (() => void) | undefined;
  const listening = new Promise<void>((resolve) => {
    resolveListening = resolve;
  });
  const wss = new WebSocketServer({ port: 0 }, () => resolveListening?.());
  wss.on('connection', (socket, req) => {
    openSockets.add(socket);
    socket.on('close', () => openSockets.delete(socket));
    paths.push(req.url ?? '');
    socket.on('message', (data: Buffer) => {
      let msg: { text?: string; xi_api_key?: string };
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (typeof msg.xi_api_key === 'string') authKeys.push(msg.xi_api_key);
      if (mode === 'hang') return; // accept, never answer, never close
      const hasText = typeof msg.text === 'string' && msg.text.trim().length > 0;
      if (hasText && mode === 'ok') {
        // One audio frame carrying isFinal — the provider's final path emits
        // the accumulated audio as the terminal chunk, then closes itself.
        socket.send(JSON.stringify({ audio: Buffer.alloc(100, 0xab).toString('base64'), isFinal: true }));
      } else if (!hasText && mode === 'no-audio') {
        // End-of-stream with zero audio — clean close, nothing produced.
        socket.close(1000, 'done');
      }
    });
  });

  return {
    wss,
    setMode: (m: WsMode): void => {
      mode = m;
    },
    authKeys,
    paths,
    start: (): Promise<void> => listening,
    stop: (): Promise<void> => new Promise((resolve) => {
      // ws 8.x exposes no closeAllConnections on WebSocketServer — terminate
      // the tracked client sockets ourselves so wss.close() always settles.
      for (const socket of openSockets) {
        try {
          socket.terminate();
        } catch {
          /* already dead */
        }
      }
      wss.close(() => resolve());
    }),
  };
}

const wsFake = createFakeTtsWsServer();

function wsBaseUrl(): string {
  return `ws://127.0.0.1:${(wsFake.wss.address() as AddressInfo).port}`;
}

// --- factory seam: points the ElevenLabs TTS session path at the local mock ---

class SeamTtsFactory extends TtsProviderFactory {
  constructor(private readonly wsUrl: string, secretRefUtils: SecretRefUtils) {
    super(secretRefUtils);
  }

  override async createForTest(provider: Provider, settings: unknown): Promise<ITtsProvider> {
    const instance = await super.createForTest(provider, settings);
    if (instance instanceof ElevenLabsTtsProvider) {
      (instance as unknown as { wsBaseUrlOverride: string | null }).wsBaseUrlOverride = this.wsUrl;
    }
    return instance;
  }
}

function savedProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'prov_tts_1',
    name: 'ElevenLabs',
    description: null,
    providerType: 'tts',
    apiType: 'elevenlabs',
    config: { apiKey: 'test-key' } as Provider['config'],
    fallbacks: [],
    createdBy: null,
    tags: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const context: RequestContext = {
  operatorId: 'op_unit',
  roles: ['super_admin'],
  ip: '127.0.0.1',
  userAgent: 'unit-test',
  requestId: 'req_unit',
  timestamp: new Date(),
};

/** Tester with the DB row load replaced by an in-memory map (unit: no network, no DB). */
class TestTester extends ProviderConnectionTester {
  providers = new Map<string, Provider>();

  protected override async loadProvider(id: string): Promise<Provider> {
    const row = this.providers.get(id);
    if (!row) throw new NotFoundError(`Provider with id ${id} not found`);
    return row;
  }
}

describe('ProviderConnectionTester TTS strategy (TPC-04)', function () {
  this.timeout(20_000);

  before(async () => {
    await wsFake.start();
    // Container seams — the recorder instance matters too: the container's
    // ProviderCallRecorder singleton caches the first CallLogger it is resolved
    // with (p1-03 pitfall), so pin ours so the production wrapper's rows land
    // in the quiet double.
    container.registerInstance(TtsProviderFactory, new SeamTtsFactory(wsBaseUrl(), { resolveObject: async (obj: Record<string, unknown>) => obj } as never));
    container.registerInstance(CallLogger, sharedCallLogger);
    container.registerInstance(MetricsRegistry, sharedMetrics);
    container.registerInstance(ProviderCallRecorder, new ProviderCallRecorder(sharedCallLogger, sharedMetrics));
    resetMonitoringAccessorsForTests();
  });

  after(async () => {
    await wsFake.stop();
  });

  beforeEach(() => {
    wsFake.setMode('ok');
    wsFake.authKeys.length = 0;
    wsFake.paths.length = 0;
    sharedCallLogger.clearPending();
    sharedCallLogger.rows.length = 0;
    sharedBreakers.reset();
    resetMonitoringAccessorsForTests();
  });

  describe('WS variant (ElevenLabs stream-input against local mock)', () => {
    it('saved ElevenLabs WITHOUT a voice → ValidationError (→ 400), no vendor call (no safe default voice)', async () => {
      const tester = new TestTester();
      tester.providers.set('prov_tts_1', savedProvider());
      let err: unknown = null;
      try {
        await tester.testConnection({ providerId: 'prov_tts_1' }, context);
      } catch (e) {
        err = e;
      }
      expect(err).to.be.instanceOf(ValidationError);
      expect((err as Error).message).to.include('voice');

      // The guard fires before the lifecycle — no WS connection, no row, no breaker feed.
      expect(wsFake.paths).to.be.empty;
      await sharedCallLogger.flushNow();
      expect(sharedCallLogger.rows).to.be.empty;
      expect(sharedBreakers.failures).to.have.length(0);
      expect(sharedBreakers.successes).to.have.length(0);
    });

    it('saved + audio frame → ok:true, detail.bytes > 0, voice in URL + bos key, row recorded, breaker NOT fed, no temp files', async () => {
      const tester = new TestTester();
      tester.providers.set('prov_tts_1', savedProvider());

      const before = new Set(fs.readdirSync(os.tmpdir()));
      const result = await tester.testConnection({ providerId: 'prov_tts_1', voice: 'voice-123' }, context);

      expect(result.ok).to.equal(true);
      expect(result.providerType).to.equal('tts');
      expect(result.apiType).to.equal('elevenlabs');
      expect(result.protocol).to.equal('websocket');
      expect(result.phase).to.equal('first-data');
      expect(result.errorCode).to.equal(null);
      expect(result.detail).to.deep.equal({ voice: 'voice-123', bytes: 100 });

      // Voice on the wire (production URL shape) + auth key in the bos message.
      expect(wsFake.paths).to.have.length(1);
      expect(wsFake.paths[0]).to.contain('/v1/text-to-speech/voice-123/stream-input');
      expect(wsFake.authKeys).to.deep.equal(['test-key']);

      // Saved mode: exactly one tts.session row, stamped, breaker NOT fed.
      await sharedCallLogger.flushNow();
      expect(sharedCallLogger.rows).to.have.length(1);
      expect(sharedCallLogger.rows[0].operation).to.equal('tts.session');
      expect(sharedCallLogger.rows[0].providerId).to.equal('prov_tts_1');
      expect(sharedCallLogger.rows[0].ok).to.equal(true);
      expect(sharedBreakers.failures).to.have.length(0);
      expect(sharedBreakers.successes).to.have.length(0);

      // Audio is counted, never persisted — the test must not leave temp files.
      for (const entry of fs.readdirSync(os.tmpdir())) {
        expect(before.has(entry), `unexpected temp entry left by the test: ${entry}`).to.equal(true);
      }
    });

    it('saved + clean stream end with zero audio → ok:false, errorCode server_error, phase session', async () => {
      wsFake.setMode('no-audio');
      const tester = new TestTester();
      tester.providers.set('prov_tts_1', savedProvider());

      const result = await tester.testConnection({ providerId: 'prov_tts_1', voice: 'voice-123' }, context);

      expect(result.ok).to.equal(false);
      expect(result.errorCode).to.equal('server_error');
      expect(result.phase).to.equal('session');
      expect(result.errorText).to.contain('without producing any audio');

      // The failed session still records (breaker-excluded via the test context).
      await sharedCallLogger.flushNow();
      expect(sharedCallLogger.rows).to.have.length(1);
      expect(sharedBreakers.failures).to.have.length(0);
      expect(sharedBreakers.successes).to.have.length(0);
    });

    it('saved + server silent after open → ok:false timeout via the shortened-timeout registry seam', async function () {
      wsFake.setMode('hang');
      const tester = new TestTester();
      tester.providers.set('prov_tts_1', savedProvider());
      // Shortened-timeout seam: 150ms instead of the 30s guard.
      tester.setTestTimeout('tts', 150);

      const startedAt = Date.now();
      const result = await tester.testConnection({ providerId: 'prov_tts_1', voice: 'voice-123' }, context);
      const elapsed = Date.now() - startedAt;

      expect(result.ok).to.equal(false);
      expect(result.errorCode).to.equal('timeout');
      expect(result.phase).to.equal('session');
      expect(result.latencyMs).to.be.at.least(100);
      expect(result.latencyMs).to.be.below(5000);
      expect(elapsed).to.be.at.least(100);

      // Cleanup flushes the abandoned session (still under the test context) —
      // the late breaker feed must not happen.
      await sharedCallLogger.flushNow();
      for (const row of sharedCallLogger.rows) {
        expect(row.operation).to.equal('tts.session');
      }
      expect(sharedBreakers.failures).to.have.length(0);
      expect(sharedBreakers.successes).to.have.length(0);
    });

    it('draft mode → full lifecycle against the mock, but zero call-log rows and zero breaker feed', async () => {
      const tester = new TestTester();

      const result = await tester.testConnection(
        { providerType: 'tts', apiType: 'elevenlabs', config: { apiKey: 'draft-key' }, voice: 'voice-123' },
        context,
      );

      expect(result.ok).to.equal(true);
      expect(result.protocol).to.equal('websocket');
      expect(result.phase).to.equal('first-data');
      expect(wsFake.authKeys).to.deep.equal(['draft-key']);

      // Un-stamped draft instance: the production wrapper records nothing.
      await sharedCallLogger.flushNow();
      expect(sharedCallLogger.rows).to.have.length(0);
      expect(sharedCallLogger.pendingEntries).to.have.length(0);
      expect(sharedBreakers.failures).to.have.length(0);
      expect(sharedBreakers.successes).to.have.length(0);
    });
  });

  describe('HTTP variant (OpenAI TTS — fetch stubbed, no network)', () => {
    type HttpMode = 'ok' | 'auth-401' | 'empty';
    const http = {
      mode: 'ok' as HttpMode,
      requests: [] as Array<{ url: string; authorization: string; body: Record<string, unknown> }>,
    };
    const originalFetch = globalThis.fetch;

    const fetchStub = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
        headers[key.toLowerCase()] = value;
      }
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(String(init?.body ?? '{}'));
      } catch {
        /* non-JSON body */
      }
      http.requests.push({ url: String(input), authorization: headers['authorization'] ?? '', body });

      switch (http.mode) {
        case 'auth-401':
          return new Response(JSON.stringify({ error: { message: 'Incorrect API key provided' } }), { status: 401, headers: { 'content-type': 'application/json' } });
        case 'empty':
          return new Response(Buffer.alloc(0), { headers: { 'content-type': 'audio/mpeg' } });
        default:
          return new Response(Buffer.alloc(200, 0xcd), { headers: { 'content-type': 'audio/mpeg' } });
      }
    };

    before(() => {
      globalThis.fetch = fetchStub as typeof fetch;
    });

    after(() => {
      globalThis.fetch = originalFetch;
    });

    beforeEach(() => {
      http.mode = 'ok';
      http.requests.length = 0;
    });

    it('saved + 200 body → ok:true, detail.bytes > 0, voice param in the request, Bearer header, row recorded, breaker NOT fed', async () => {
      const tester = new TestTester();
      tester.providers.set('prov_tts_1', savedProvider({ apiType: 'openai' }));

      const result = await tester.testConnection({ providerId: 'prov_tts_1', voice: 'nova' }, context);

      expect(result.ok).to.equal(true);
      expect(result.apiType).to.equal('openai');
      expect(result.protocol).to.equal('http');
      expect(result.phase).to.equal('first-data');
      expect(result.detail).to.deep.equal({ voice: 'nova', bytes: 200 });

      // Production request shape: Bearer auth + the voice param on the wire.
      expect(http.requests).to.have.length(1);
      expect(http.requests[0].url).to.equal('https://api.openai.com/v1/audio/speech');
      expect(http.requests[0].authorization).to.equal('Bearer test-key');
      expect(http.requests[0].body).to.include({ model: 'gpt-4o-mini-tts', voice: 'nova', input: 'Test connection.' });

      await sharedCallLogger.flushNow();
      expect(sharedCallLogger.rows).to.have.length(1);
      expect(sharedCallLogger.rows[0].operation).to.equal('tts.session');
      expect(sharedCallLogger.rows[0].providerId).to.equal('prov_tts_1');
      expect(sharedCallLogger.rows[0].ok).to.equal(true);
      expect(sharedBreakers.failures).to.have.length(0);
      expect(sharedBreakers.successes).to.have.length(0);
    });

    it('saved + 401 → ok:false, errorCode auth, phase auth', async () => {
      http.mode = 'auth-401';
      const tester = new TestTester();
      tester.providers.set('prov_tts_1', savedProvider({ apiType: 'openai' }));

      const result = await tester.testConnection({ providerId: 'prov_tts_1' }, context);

      expect(result.ok).to.equal(false);
      expect(result.errorCode).to.equal('auth');
      expect(result.phase).to.equal('auth');
      expect(result.errorText).to.contain('401');

      // The failed session records (breaker-excluded) — the error path goes
      // through the provider's error callback, then the tester's classifier.
      await sharedCallLogger.flushNow();
      expect(sharedCallLogger.rows).to.have.length(1);
      expect(sharedCallLogger.rows[0].ok).to.equal(false);
      expect(sharedBreakers.failures).to.have.length(0);
    });

    it('saved + 200 with an empty body → ok:false, errorCode server_error, phase session', async () => {
      http.mode = 'empty';
      const tester = new TestTester();
      tester.providers.set('prov_tts_1', savedProvider({ apiType: 'openai' }));

      const result = await tester.testConnection({ providerId: 'prov_tts_1' }, context);

      expect(result.ok).to.equal(false);
      expect(result.errorCode).to.equal('server_error');
      expect(result.phase).to.equal('session');
    });
  });
});
