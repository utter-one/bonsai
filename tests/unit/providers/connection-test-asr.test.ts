import 'reflect-metadata';
import { WebSocketServer, type WebSocket as WsWebSocket } from 'ws';
import { AddressInfo } from 'node:net';
import { container } from 'tsyringe';
import { describe, it, before, after, beforeEach } from 'mocha';
import { expect } from 'chai';
import { CallLogger, type ProviderCallEntry, type ProviderCallLogRow } from '../../../src/services/monitoring/CallLogger';
import { MetricsRegistry } from '../../../src/services/monitoring/MetricsRegistry';
import { ProviderCallRecorder, resetMonitoringAccessorsForTests } from '../../../src/services/monitoring/ProviderCallRecorder';
import { ProviderConnectionTester } from '../../../src/services/providers/connectionTest/ProviderConnectionTester';
import { buildConnectionTestStrategies } from '../../../src/services/providers/connectionTest';
import { buildAsrSilence } from '../../../src/services/providers/connectionTest/silence';
import { AsrProviderFactory } from '../../../src/services/providers/asr/AsrProviderFactory';
import { ElevenLabsAsrProvider } from '../../../src/services/providers/asr/ElevenLabsAsrProvider';
import type { IAsrProvider } from '../../../src/services/providers/asr/IAsrProvider';
import type { SecretRefUtils } from '../../../src/services/secrets/SecretRefUtils';
import { NotFoundError } from '../../../src/errors';
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

// --- quiet monitoring doubles (p1-03 pattern: container singleton keeps the first CallLogger it sees) ---

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

// --- fake ElevenLabs realtime WS server (local, no vendor credentials) ---

type FakeMode = 'ok' | 'ok-partial' | 'auth-close' | 'no-response' | 'mid-stream-close';

interface CapturedChunk {
  audio_base_64?: string;
  sample_rate?: number;
  commit?: boolean;
}

/**
 * Speaks just enough of the ElevenLabs realtime protocol for the production
 * ElevenLabsAsrProvider to run its full session lifecycle:
 * session_started on connect, input_audio_chunk in, (optional) partial out,
 * clean close on stop. Modes model vendor outcomes (TPC-03 test table).
 */
function createFakeRealtimeServer() {
  let mode: FakeMode = 'ok';
  const connections: string[] = []; // xi-api-key headers
  const chunks: CapturedChunk[] = [];
  const openSockets = new Set<WsWebSocket>();

  // ws auto-listens when `port` is in the options (the constructor callback is
  // the 'listening' event); the http server is reachable via wss.server.
  let resolveListening: (() => void) | undefined;
  const listening = new Promise<void>((resolve) => {
    resolveListening = resolve;
  });
  const wss = new WebSocketServer({ port: 0 }, () => resolveListening?.());
  wss.on('connection', (socket, req) => {
    openSockets.add(socket);
    socket.on('close', () => openSockets.delete(socket));
    connections.push(String(req.headers['xi-api-key'] ?? ''));
    switch (mode) {
      case 'auth-close':
        // Real-world shape: ElevenLabs closes 4401 with a key error (no session).
        socket.close(4401, 'invalid api key');
        return;
      case 'no-response':
        // Accept the socket, send nothing — the hard timeout must fire.
        return;
      default:
        socket.send(JSON.stringify({ message_type: 'session_started', session_id: 'mock-session' }));
    }
    socket.on('message', (data: Buffer) => {
      let msg: CapturedChunk & { message_type?: string };
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.message_type !== 'input_audio_chunk') return;
      chunks.push(msg);
      if (mode === 'ok-partial' && chunks.length === 1) {
        socket.send(JSON.stringify({ message_type: 'partial_transcript', text: 'silence-echo' }));
      }
      if (mode === 'mid-stream-close' && chunks.length === 1) {
        socket.close(1000, 'done');
      }
    });
  });

  return {
    wss,
    setMode: (m: FakeMode): void => {
      mode = m;
    },
    connections,
    chunks,
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

const fake = createFakeRealtimeServer();

function wsUrl(): string {
  return `ws://127.0.0.1:${(fake.wss.address() as AddressInfo).port}/v1/speech-to-text/realtime`;
}

/**
 * Factory seam: the strategy resolves AsrProviderFactory from the container
 * and calls createForTest (the TPC-01 pattern); this subclass points the
 * ElevenLabs session path at the local mock via the provider's
 * `realtimeWsUrl` test seam (defaults to the production endpoint otherwise).
 */
class SeamAsrFactory extends AsrProviderFactory {
  constructor(private readonly wsUrl: string, secretRefUtils: SecretRefUtils) {
    super(secretRefUtils);
  }

  override async createForTest(provider: Provider, settings: unknown): Promise<IAsrProvider> {
    const instance = await super.createForTest(provider, settings);
    if (instance instanceof ElevenLabsAsrProvider) {
      (instance as unknown as { realtimeWsUrl: string }).realtimeWsUrl = this.wsUrl;
    }
    return instance;
  }
}

function savedProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'prov_asr_1',
    name: 'ElevenLabs',
    description: null,
    providerType: 'asr',
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

describe('ProviderConnectionTester ASR strategy (TPC-03)', function () {
  this.timeout(20_000);

  before(async () => {
    await fake.start();
    // Container seams (must precede the first factory/accessor resolution in this file).
    // The factory instance carries an identity SecretRefUtils — plaintext draft configs
    // pass through — and points the ElevenLabs session path at the local mock.
    // The recorder instance matters too: the container's ProviderCallRecorder singleton
    // caches the first CallLogger it is resolved with (p1-03 pitfall), so an earlier
    // suite could hold the real DB-backed logger — pin ours so the production wrapper's
    // rows land in the quiet double.
    container.registerInstance(AsrProviderFactory, new SeamAsrFactory(wsUrl(), { resolveObject: async (obj: Record<string, unknown>) => obj } as never));
    container.registerInstance(CallLogger, sharedCallLogger);
    container.registerInstance(MetricsRegistry, sharedMetrics);
    container.registerInstance(ProviderCallRecorder, new ProviderCallRecorder(sharedCallLogger, sharedMetrics));
    resetMonitoringAccessorsForTests();
  });

  after(async () => {
    await fake.stop();
  });

  beforeEach(() => {
    fake.setMode('ok');
    fake.connections.length = 0;
    fake.chunks.length = 0;
    sharedCallLogger.clearPending();
    sharedCallLogger.rows.length = 0;
    sharedBreakers.reset();
    resetMonitoringAccessorsForTests();
  });

  it('saved + handshake → ok:true, phase first-data, silence chunk on the wire, row recorded, breaker NOT fed', async () => {
    const tester = new TestTester();
    tester.providers.set('prov_asr_1', savedProvider());

    const result = await tester.testConnection({ providerId: 'prov_asr_1' }, context);

    expect(result.ok).to.equal(true);
    expect(result.providerType).to.equal('asr');
    expect(result.apiType).to.equal('elevenlabs');
    expect(result.protocol).to.equal('websocket');
    expect(result.phase).to.equal('first-data');
    expect(result.errorCode).to.equal(null);

    // Auth header carried the saved key; the silence chunk went on the wire,
    // followed by doStop's final commit (empty audio, commit: true).
    expect(fake.connections).to.deep.equal(['test-key']);
    expect(fake.chunks).to.have.length(2);
    const silence = Buffer.from(fake.chunks[0].audio_base_64 ?? '', 'base64');
    expect(silence).to.have.length(16_000); // pcm_16000, 16-bit mono, 500 ms
    expect(silence.every((b) => b === 0)).to.equal(true);
    expect(fake.chunks[0].sample_rate).to.equal(16_000);
    expect(fake.chunks[1].commit).to.equal(true);
    expect(fake.chunks[1].audio_base_64).to.equal('');

    // Saved mode: exactly one asr.session row (silence yields no finals → row ok=false
    // is the production session semantics), stamped, and the breaker was NOT fed.
    await sharedCallLogger.flushNow();
    expect(sharedCallLogger.rows).to.have.length(1);
    expect(sharedCallLogger.rows[0].operation).to.equal('asr.session');
    expect(sharedCallLogger.rows[0].providerId).to.equal('prov_asr_1');
    expect(sharedBreakers.failures).to.have.length(0);
    expect(sharedBreakers.successes).to.have.length(0);
  });

  it('saved + close 4401 "invalid api key" → ok:false, errorCode auth, phase auth', async () => {
    fake.setMode('auth-close');
    const tester = new TestTester();
    tester.providers.set('prov_asr_1', savedProvider());

    const result = await tester.testConnection({ providerId: 'prov_asr_1' }, context);

    expect(result.ok).to.equal(false);
    expect(result.errorCode).to.equal('auth');
    expect(result.phase).to.equal('auth');
    expect(result.errorText).to.contain('invalid api key');

    // The failed start flushes the session row — breaker-excluded via the test context.
    await sharedCallLogger.flushNow();
    expect(sharedCallLogger.rows).to.have.length(1);
    expect(sharedCallLogger.rows[0].ok).to.equal(false);
    expect(sharedBreakers.failures).to.have.length(0);
  });

  it('saved + no response after open → ok:false timeout via the shortened-timeout registry seam', async function () {
    fake.setMode('no-response');
    const tester = new TestTester();
    tester.providers.set('prov_asr_1', savedProvider());
    // Shortened-timeout seam: same strategy body, 150ms instead of the 20s guard.
    const asrStrategy = buildConnectionTestStrategies().get('asr');
    expect(asrStrategy).to.not.equal(undefined);
    tester.registerStrategy({ ...asrStrategy!, timeoutMs: 150 });

    const startedAt = Date.now();
    const result = await tester.testConnection({ providerId: 'prov_asr_1' }, context);
    const elapsed = Date.now() - startedAt;

    expect(result.ok).to.equal(false);
    expect(result.errorCode).to.equal('timeout');
    expect(result.phase).to.equal('session');
    expect(result.latencyMs).to.be.at.least(150);
    expect(elapsed).to.be.at.least(150);

    // Cleanup flushes the abandoned session (still under the test context) —
    // the late breaker feed must not happen.
    await sharedCallLogger.flushNow();
    for (const row of sharedCallLogger.rows) {
      expect(row.operation).to.equal('asr.session');
    }
    expect(sharedBreakers.failures).to.have.length(0);
    expect(sharedBreakers.successes).to.have.length(0);
  });

  it('saved + mid-stream close AFTER session start → still ok:true (session was established)', async () => {
    fake.setMode('mid-stream-close');
    const tester = new TestTester();
    tester.providers.set('prov_asr_1', savedProvider());

    const result = await tester.testConnection({ providerId: 'prov_asr_1' }, context);

    expect(result.ok).to.equal(true);
    expect(result.phase).to.equal('first-data');
    // The silence chunk is first; doStop's final commit may or may not slip in
    // before the inbound close is processed (loopback race — both are fine).
    expect(fake.chunks.length).to.be.oneOf([1, 2]);
    const silence = Buffer.from(fake.chunks[0].audio_base_64 ?? '', 'base64');
    expect(silence).to.have.length(16_000);
  });

  it('saved + unexpected partial transcript → ok:true with detail.transcript bonus signal', async () => {
    fake.setMode('ok-partial');
    const tester = new TestTester();
    tester.providers.set('prov_asr_1', savedProvider());

    const result = await tester.testConnection({ providerId: 'prov_asr_1' }, context);

    expect(result.ok).to.equal(true);
    expect(result.detail).to.deep.equal({ transcript: 'silence-echo' });
  });

  it('draft mode → full lifecycle against the mock, but zero call-log rows and zero breaker feed', async () => {
    const tester = new TestTester();

    const result = await tester.testConnection(
      { providerType: 'asr', apiType: 'elevenlabs', config: { apiKey: 'draft-key' } },
      context,
    );

    expect(result.ok).to.equal(true);
    expect(result.phase).to.equal('first-data');
    expect(fake.connections).to.deep.equal(['draft-key']);

    // Un-stamped draft instance: the production wrapper records nothing.
    await sharedCallLogger.flushNow();
    expect(sharedCallLogger.rows).to.have.length(0);
    expect(sharedCallLogger.pendingEntries).to.have.length(0);
    expect(sharedBreakers.failures).to.have.length(0);
    expect(sharedBreakers.successes).to.have.length(0);
  });
});

describe('buildAsrSilence (TPC-03)', () => {
  it('pcm_16000 → 16 000 zero bytes (16-bit mono, 500 ms)', () => {
    const buf = buildAsrSilence('pcm_16000');
    expect(buf).to.have.length(16_000);
    expect(buf.every((b) => b === 0)).to.equal(true);
  });

  it('pcm_8000 → 8 000 zero bytes', () => {
    const buf = buildAsrSilence('pcm_8000');
    expect(buf).to.have.length(8_000);
    expect(buf.every((b) => b === 0)).to.equal(true);
  });

  it('mulaw → 4 000 bytes of 0xFF (8 kHz µ-law silence)', () => {
    const buf = buildAsrSilence('mulaw');
    expect(buf).to.have.length(4_000);
    expect(buf.every((b) => b === 0xff)).to.equal(true);
  });

  it('alaw → 4 000 bytes of 0x7F (8 kHz A-law silence)', () => {
    const buf = buildAsrSilence('alaw');
    expect(buf).to.have.length(4_000);
    expect(buf.every((b) => b === 0x7f)).to.equal(true);
  });

  it('unsupported format → throws', () => {
    expect(() => buildAsrSilence('mp3' as never)).to.throw(/Unsupported ASR input format/);
  });
});
