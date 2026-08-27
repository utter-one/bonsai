import 'reflect-metadata';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { container } from 'tsyringe';
import { describe, it, before, after, beforeEach } from 'mocha';
import { expect } from 'chai';
import { CallLogger, type ProviderCallEntry, type ProviderCallLogRow } from '../../../src/services/monitoring/CallLogger';
import { MetricsRegistry } from '../../../src/services/monitoring/MetricsRegistry';
import { ProviderCallRecorder, resetMonitoringAccessorsForTests } from '../../../src/services/monitoring/ProviderCallRecorder';
import { ProviderConnectionTester } from '../../../src/services/providers/connectionTest/ProviderConnectionTester';
import { LlmProviderFactory } from '../../../src/services/providers/llm/LlmProviderFactory';
import { ValidationError, NotFoundError } from '../../../src/errors';
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

// --- fake OpenAI-compatible HTTP server (local, no vendor credentials) ---

type FakeMode = 'ok' | 'http-401' | 'http-429' | 'http-500' | 'hang';

interface CapturedRequest {
  method: string;
  path: string;
  auth?: string;
  body?: { model?: string; max_output_tokens?: number; input?: string };
}

function createFakeOpenAiServer() {
  let mode: FakeMode = 'ok';
  const requests: CapturedRequest[] = [];

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: CapturedRequest['body'];
      try {
        body = raw ? (JSON.parse(raw) as CapturedRequest['body']) : undefined;
      } catch {
        body = undefined;
      }
      requests.push({ method: req.method ?? 'GET', path: req.url ?? '', auth: req.headers.authorization, body });

      if (req.method === 'GET' && req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            object: 'list',
            data: [
              { id: 'gpt-test-a', object: 'model' },
              { id: 'gpt-test-b', object: 'model' },
              { id: 'text-embedding-3-small', object: 'model' },
            ],
          }),
        );
        return;
      }

      if (req.method === 'POST' && req.url === '/v1/responses') {
        switch (mode) {
          case 'ok':
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                id: 'resp_test_1',
                object: 'response',
                created_at: 1,
                status: 'completed',
                model: body?.model ?? 'gpt-test-a',
                output: [{ type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Pong', annotations: [] }] }],
                usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
              }),
            );
            return;
          case 'http-401':
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Invalid API key provided', type: 'invalid_request_error', param: null, code: 'invalid_api_key' } }));
            return;
          case 'http-429':
            res.writeHead(429, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Rate limit reached for gpt-test-a', type: 'requests', param: null, code: 'rate_limit_exceeded' } }));
            return;
          case 'http-500':
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Internal server error', type: 'server_error', param: null, code: null } }));
            return;
          case 'hang':
            // 200 headers, then silence — the hard timeout must fire.
            res.writeHead(200, { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' });
            return;
        }
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `Not found: ${req.method} ${req.url}`, type: 'invalid_request_error', param: null, code: null } }));
    });
  });

  return {
    server,
    setMode: (m: FakeMode): void => {
      mode = m;
    },
    requests,
    start: (): Promise<void> => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve())),
    stop: (): Promise<void> => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    }),
  };
}

const fake = createFakeOpenAiServer();

function baseUrl(): string {
  return `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}/v1`;
}

function savedProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'prov_llm_1',
    name: 'OpenAI',
    description: null,
    providerType: 'llm',
    apiType: 'openai',
    config: { apiKey: 'sk-test', baseUrl: 'http://127.0.0.1' } as Provider['config'],
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

describe('ProviderConnectionTester LLM strategy (TPC-02)', function () {
  this.timeout(20_000);

  before(async () => {
    await fake.start();
    // Container seams (must precede the first factory/accessor resolution in this file).
    // The factory instance carries an identity SecretRefUtils — plaintext draft configs pass through.
    // The recorder instance matters too: the container's ProviderCallRecorder singleton
    // caches the first CallLogger it is resolved with (p1-03 pitfall), so an earlier
    // suite could hold the real DB-backed logger — pin ours so the production wrapper's
    // rows land in the quiet double.
    container.registerInstance(LlmProviderFactory, new LlmProviderFactory({ resolveObject: async (obj: Record<string, unknown>) => obj } as never));
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
    fake.requests.length = 0;
    sharedCallLogger.rows.length = 0;
    sharedCallLogger.clearPending();
    sharedBreakers.reset();
    resetMonitoringAccessorsForTests();
  });

  it('saved + 200 → ok:true, phase first-data, real 1-token production-shaped request', async () => {
    const tester = new TestTester();
    tester.providers.set('prov_llm_1', savedProvider({ config: { apiKey: 'sk-test', baseUrl: baseUrl() } as Provider['config'] }));

    const result = await tester.testConnection({ providerId: 'prov_llm_1', model: 'gpt-test-a' }, context);

    expect(result.ok).to.equal(true);
    expect(result.providerType).to.equal('llm');
    expect(result.apiType).to.equal('openai');
    expect(result.protocol).to.equal('http');
    expect(result.phase).to.equal('first-data');
    expect(result.errorCode).to.equal(null);
    expect(result.latencyMs).to.be.a('number').and.to.be.at.least(0);
    expect(result.detail).to.deep.equal({ model: 'gpt-test-a' });
    expect(result).to.not.have.property('statusHttp');

    // Production request shape: Responses API, bearer auth, real prompt.
    // max_output_tokens is the connection-test ceiling — above OpenAI's hard
    // floor of 16 (a value of 1 is rejected with a 400); the model still emits
    // a single word for the "ping" prompt.
    const gen = fake.requests.find((r) => r.path === '/v1/responses');
    expect(gen).to.not.equal(undefined);
    expect(gen!.body?.model).to.equal('gpt-test-a');
    expect(gen!.body?.max_output_tokens).to.equal(64);
    expect(gen!.body?.max_output_tokens).to.be.at.least(16);
    expect(String(gen!.body?.input ?? '')).to.include('ping');
    expect(gen!.auth).to.equal('Bearer sk-test');

    // The production wrapper recorded exactly one llm.test row (saved mode).
    await sharedCallLogger.flushNow();
    expect(sharedCallLogger.rows).to.have.length(1);
    expect(sharedCallLogger.rows[0].operation).to.equal('llm.test');
    expect(sharedCallLogger.rows[0].providerId).to.equal('prov_llm_1');
    expect(sharedCallLogger.rows[0].model).to.equal('gpt-test-a');
    expect(sharedCallLogger.rows[0].ok).to.equal(true);
    // TPC-01 guard: the successful test does not feed the breaker either.
    expect(sharedBreakers.successes).to.be.empty;
  });

  it('saved + 401 → ok:false auth failure, phase auth, breaker NOT fed (end-to-end TPC-01 guard)', async () => {
    fake.setMode('http-401');
    const tester = new TestTester();
    tester.providers.set('prov_llm_1', savedProvider({ config: { apiKey: 'sk-bad', baseUrl: baseUrl() } as Provider['config'] }));

    const result = await tester.testConnection({ providerId: 'prov_llm_1', model: 'gpt-test-a' }, context);

    expect(result.ok).to.equal(false);
    expect(result.errorCode).to.equal('auth');
    expect(result.phase).to.equal('auth');
    expect(result.errorText).to.include('Invalid API key provided');

    await sharedCallLogger.flushNow();
    expect(sharedCallLogger.rows).to.have.length(1);
    expect(sharedCallLogger.rows[0].operation).to.equal('llm.test');
    expect(sharedCallLogger.rows[0].ok).to.equal(false);
    expect(sharedCallLogger.rows[0].errorCode).to.equal('auth');
    expect(sharedCallLogger.rows[0].statusHttp).to.equal(401);
    // The failed test must not feed the breaker (no failover for real users).
    expect(sharedBreakers.failures).to.be.empty;
    expect(sharedBreakers.successes).to.be.empty;
  });

  it('saved + 429 → ok:false rate_limited, phase first-data', async () => {
    fake.setMode('http-429');
    const tester = new TestTester();
    tester.providers.set('prov_llm_1', savedProvider({ config: { apiKey: 'sk-test', baseUrl: baseUrl() } as Provider['config'] }));

    const result = await tester.testConnection({ providerId: 'prov_llm_1', model: 'gpt-test-a' }, context);

    expect(result.ok).to.equal(false);
    expect(result.errorCode).to.equal('rate_limited');
    expect(result.phase).to.equal('first-data');
  });

  it('saved + 500 → ok:false server_error, phase first-data', async () => {
    fake.setMode('http-500');
    const tester = new TestTester();
    tester.providers.set('prov_llm_1', savedProvider({ config: { apiKey: 'sk-test', baseUrl: baseUrl() } as Provider['config'] }));

    const result = await tester.testConnection({ providerId: 'prov_llm_1', model: 'gpt-test-a' }, context);

    expect(result.ok).to.equal(false);
    expect(result.errorCode).to.equal('server_error');
    expect(result.phase).to.equal('first-data');
  });

  it('saved + dead endpoint → ok:false network, phase first-data', async () => {
    const tester = new TestTester();
    // Port 59999: unblocked, nothing listening → real ECONNREFUSED (fetch blocks port 1 as 'bad port').
    tester.providers.set('prov_llm_1', savedProvider({ config: { apiKey: 'sk-test', baseUrl: 'http://127.0.0.1:59999/v1' } as Provider['config'] }));

    const result = await tester.testConnection({ providerId: 'prov_llm_1', model: 'gpt-test-a' }, context);

    expect(result.ok).to.equal(false);
    expect(result.errorCode).to.equal('network');
    expect(result.phase).to.equal('first-data');
    // No vendor request was possible — the fake server saw nothing.
    expect(fake.requests).to.be.empty;
  });

  it('draft + hang → ok:false timeout via the shortened-timeout registry seam (un-stamped: no late row)', async function () {
    fake.setMode('hang');
    const tester = new TestTester();
    // Shortened-timeout seam: 150ms instead of the 30s guard.
    tester.setTestTimeout('llm', 150);

    const startedAt = Date.now();
    const result = await tester.testConnection(
      { providerType: 'llm', apiType: 'openai', model: 'gpt-test-a', config: { apiKey: 'sk-draft', baseUrl: baseUrl() } },
      context,
    );
    const elapsed = Date.now() - startedAt;

    expect(result.ok).to.equal(false);
    expect(result.errorCode).to.equal('timeout');
    expect(result.latencyMs).to.be.at.least(100);
    expect(result.latencyMs).to.be.below(5000);
    expect(elapsed).to.be.at.least(100);

    // Draft mode is deliberate: a draft instance is un-stamped, so the
    // abandoned in-flight generate records NO late row. (A saved provider's
    // abandoned SDK promise settles through the race and records a late row
    // whose timing is non-deterministic — the SDK's connection-error reject can
    // lag well past any fixed wait — which would leak into a later suite's
    // recorder. The timeout path itself is identical for saved and draft.)
    fake.server.closeAllConnections?.();
    await new Promise((r) => setTimeout(r, 50));
    await sharedCallLogger.flushNow();
    expect(sharedCallLogger.rows).to.be.empty;
  });

  it('saved without model → defaults to the first model from enumerateModels (existing free call)', async () => {
    const tester = new TestTester();
    tester.providers.set('prov_llm_1', savedProvider({ config: { apiKey: 'sk-test', baseUrl: baseUrl() } as Provider['config'] }));

    const result = await tester.testConnection({ providerId: 'prov_llm_1' }, context);

    expect(result.ok).to.equal(true);
    expect(result.detail).to.deep.equal({ model: 'gpt-test-a' });

    const modelsCalls = fake.requests.filter((r) => r.path === '/v1/models');
    expect(modelsCalls).to.have.length(1);
    const gen = fake.requests.find((r) => r.path === '/v1/responses');
    expect(gen).to.not.equal(undefined);
    expect(gen!.body?.model).to.equal('gpt-test-a');

    // Two rows: the enumeration ('llm.models', explicit op) and the test itself
    // ('llm.test', from the tester's monitoring context). Both are breaker-excluded.
    await sharedCallLogger.flushNow();
    expect(sharedCallLogger.rows).to.have.length(2);
    const operations = sharedCallLogger.rows.map((r) => r.operation).sort();
    expect(operations).to.deep.equal(['llm.models', 'llm.test']);
    expect(sharedBreakers.failures).to.be.empty;
    expect(sharedBreakers.successes).to.be.empty;
  });

  it('draft without model → ValidationError (→ 400), no vendor call', async () => {
    const tester = new TestTester();
    let err: unknown = null;
    try {
      await tester.testConnection({ providerType: 'llm', apiType: 'openai', config: { apiKey: 'sk-draft', baseUrl: baseUrl() } }, context);
    } catch (e) {
      err = e;
    }
    expect(err).to.be.instanceOf(ValidationError);
    expect((err as Error).message).to.include('model');
    expect(fake.requests).to.be.empty;
  });

  it('draft with model → real vendor call, but zero call-log rows (un-stamped) and no breaker feed', async () => {
    const tester = new TestTester();

    const result = await tester.testConnection({ providerType: 'llm', apiType: 'openai', model: 'gpt-test-a', config: { apiKey: 'sk-draft', baseUrl: baseUrl() } }, context);

    expect(result.ok).to.equal(true);
    expect(result.detail).to.deep.equal({ model: 'gpt-test-a' });

    // A real request went out (the point of a draft test: verify before saving).
    const gen = fake.requests.find((r) => r.path === '/v1/responses');
    expect(gen).to.not.equal(undefined);
    expect(gen!.auth).to.equal('Bearer sk-draft');
    expect(gen!.body?.max_output_tokens).to.equal(64);
    expect(gen!.body?.max_output_tokens).to.be.at.least(16);

    // Draft providers are transient — nothing is persisted, nothing feeds the breaker.
    await sharedCallLogger.flushNow();
    expect(sharedCallLogger.rows).to.be.empty;
    expect(sharedCallLogger.pendingEntries).to.be.empty;
    expect(sharedBreakers.successes).to.be.empty;
    expect(sharedBreakers.failures).to.be.empty;
  });
});
