import 'reflect-metadata';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { ZodError } from 'zod';
import { CallLogger, type ProviderCallEntry, type ProviderCallLogRow } from '../../../src/services/monitoring/CallLogger';
import { MetricsRegistry } from '../../../src/services/monitoring/MetricsRegistry';
import { MonitoringContext } from '../../../src/services/monitoring/MonitoringContext';
import { ProviderCallRecorder } from '../../../src/services/monitoring/ProviderCallRecorder';
import { ProviderConnectionTester } from '../../../src/services/providers/connectionTest/ProviderConnectionTester';
import {
  ConnectionTestFailure,
  sanitizeErrorText,
  stableStringify,
  connectionTestDraftKey,
  type ConnectionTestOutcome,
  type ConnectionTestRequest,
  type ConnectionTestStrategy,
  type TestPhase,
  type TestProtocol,
} from '../../../src/services/providers/connectionTest/types';
import { LlmProviderFactory } from '../../../src/services/providers/llm/LlmProviderFactory';
import { OpenAILlmProvider } from '../../../src/services/providers/llm/OpenAILlmProvider';
import type { Provider } from '../../../src/types/models';
import type { RequestContext } from '../../../src/services/RequestContext';
import { NotFoundError, InvalidOperationError, TooManyRequestsError } from '../../../src/errors';

/** Records breaker hooks instead of touching real breakers (P3-01 test double). */
class FakeBreakerRegistry {
  successes: string[] = [];
  failures: Array<{ providerId: string; errorCode: string | null | undefined }> = [];

  recordSuccess(providerId: string): void {
    this.successes.push(providerId);
  }

  recordFailure(providerId: string, errorCode: string | null | undefined): void {
    this.failures.push({ providerId, errorCode });
  }
}

/** Test seam: captures rows instead of hitting the DB. */
class TestCallLogger extends CallLogger {
  rows: ProviderCallLogRow[] = [];
  private readonly breakers: FakeBreakerRegistry;

  constructor(breakers?: FakeBreakerRegistry) {
    const fake = breakers ?? new FakeBreakerRegistry();
    super(fake as never);
    this.breakers = fake;
  }

  get breakerRegistryForTests(): FakeBreakerRegistry {
    return this.breakers;
  }

  get pendingEntries(): ProviderCallEntry[] {
    return this.buffer;
  }

  protected async persistRows(rows: ProviderCallLogRow[]): Promise<void> {
    this.rows.push(...rows);
  }

  protected onFlushError(): void {
    /* captured nowhere — flush cannot fail in this double */
  }
}

/** Tester with the DB row load replaced by an in-memory map (unit: no network, no DB). */
class TestTester extends ProviderConnectionTester {
  providers = new Map<string, Provider>();

  protected override async loadProvider(id: string): Promise<Provider> {
    const row = this.providers.get(id);
    if (!row) throw new NotFoundError(`Provider with id ${id} not found`);
    return row;
  }
}

/** Quiet metrics double — the production wrapper path touches the registry; discard it. */
class QuietMetrics extends MetricsRegistry {
  protected override async persistRows(_rows: unknown[]): Promise<void> {
    /* discard */
  }

  protected override onFlushError(): void {
    /* discard */
  }
}

interface StubInstance {
  cleanup: () => Promise<void>;
}

type StubMode = 'ok' | 'vendor-error' | 'structured-failure' | 'hang' | 'hang-build' | 'guard-error';

/** Configurable strategy standing in for TPC-02..05 (proves the seam + guards). */
class StubStrategy implements ConnectionTestStrategy<StubInstance> {
  readonly providerType: string;
  readonly timeoutMs: number;
  readonly protocol: TestProtocol;
  mode: StubMode = 'ok';
  vendorError: unknown = null;
  failurePhase: TestPhase = 'session';
  outcomeOverrides: Partial<ConnectionTestOutcome> = {};
  buildInstanceCalls = 0;
  cleanupCalls = 0;
  instancesInTest: StubInstance[] = [];
  /**
   * Simulates the instrumented production path (TPC-02 design): the provider
   * base records one row per call — record-then-throw on failure — via the
   * real ProviderCallRecorder. Draft mode simulates the un-stamped instance:
   * the base's recorder early-returns, so nothing is recorded.
   */
  recorder: { record(entry: ProviderCallEntry): void } | null = null;

  constructor(opts: { providerType?: string; timeoutMs?: number; protocol?: TestProtocol } = {}) {
    this.providerType = opts.providerType ?? 'llm';
    this.timeoutMs = opts.timeoutMs ?? 1000;
    this.protocol = opts.protocol ?? 'http';
  }

  async buildInstance(): Promise<StubInstance> {
    this.buildInstanceCalls += 1;
    if (this.mode === 'hang-build') return new Promise<never>(() => undefined);
    return { cleanup: async () => void (this.cleanupCalls += 1) };
  }

  async test(request: ConnectionTestRequest, instance: StubInstance): Promise<ConnectionTestOutcome> {
    this.instancesInTest.push(instance);
    switch (this.mode) {
      case 'hang':
        return new Promise<never>(() => undefined);
      case 'vendor-error': {
        const error = this.vendorError ?? new Error('vendor exploded');
        this.recordProductionCall(request, { ok: false, error });
        throw error;
      }
      case 'structured-failure':
        throw new ConnectionTestFailure('session config rejected by vendor', this.failurePhase, undefined, 'client_error');
      case 'guard-error':
        throw new ZodError([]);
      default: {
        this.recordProductionCall(request, { ok: true, model: this.outcomeOverrides.model ?? request.model ?? null });
        return {
          ok: true,
          providerType: request.providerType,
          apiType: request.apiType,
          protocol: this.protocol,
          phase: 'first-data',
          latencyMs: 12,
          errorCode: null,
          ...this.outcomeOverrides,
        };
      }
    }
  }

  private recordProductionCall(request: ConnectionTestRequest, fields: { ok: boolean; error?: unknown; model?: string | null }): void {
    if (request.mode !== 'saved' || !this.recorder) return;
    this.recorder.record({
      providerId: request.provider.id,
      providerType: request.providerType,
      apiType: request.apiType,
      // The production base fills the operation from the monitoring context —
      // under the tester that is '<type>.test' (breaker-excluded).
      operation: MonitoringContext.current()?.operation,
      model: fields.model ?? null,
      durationMs: 12,
      ok: fields.ok,
      ...(fields.error !== undefined ? { error: fields.error } : {}),
    });
  }
}

function savedProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'prov_llm_1',
    name: 'OpenAI',
    description: null,
    providerType: 'llm',
    apiType: 'openai',
    config: { apiKey: 'sk-test' } as Provider['config'],
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

function vendorError(status: number, message: string): Error {
  const err = new Error(message);
  (err as { status?: number }).status = status;
  return err;
}

const JWT_SAMPLE = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

describe('ProviderConnectionTester core (TPC-01)', () => {
  let callLogger: TestCallLogger;
  let quietMetrics: QuietMetrics;
  let recorder: ProviderCallRecorder;
  let tester: TestTester;

  beforeEach(() => {
    callLogger = new TestCallLogger();
    quietMetrics = new QuietMetrics();
    recorder = new ProviderCallRecorder(callLogger, quietMetrics);
    tester = new TestTester();
  });

  describe('dispatch', () => {
    it('runs a registered strategy and returns a uniform result for a saved provider', async () => {
      const strategy = new StubStrategy();
      tester.registerStrategy(strategy);
      tester.providers.set('prov_llm_1', savedProvider());

      const result = await tester.testConnection({ providerId: 'prov_llm_1' }, context);

      expect(result.ok).to.equal(true);
      expect(result.providerType).to.equal('llm');
      expect(result.apiType).to.equal('openai');
      expect(result.protocol).to.equal('http');
      expect(result.phase).to.equal('first-data');
      expect(result.latencyMs).to.be.a('number').and.to.be.at.least(0);
      expect(result.errorCode).to.equal(null);
      expect(result).to.not.have.property('model');
      expect(result).to.not.have.property('statusHttp');
      expect(strategy.buildInstanceCalls).to.equal(1);
      expect(strategy.instancesInTest[0]).to.not.equal(undefined);
    });

    it('throws InvalidOperationError for an unregistered providerType (saved and draft)', async () => {
      tester.providers.set('prov_emb_1', savedProvider({ id: 'prov_emb_1', providerType: 'embeddings' }));

      let savedErr: unknown = null;
      try {
        await tester.testConnection({ providerId: 'prov_emb_1' }, context);
      } catch (err) {
        savedErr = err;
      }
      expect(savedErr).to.be.instanceOf(InvalidOperationError);

      let draftErr: unknown = null;
      try {
        await tester.testConnection({ providerType: 'channel', apiType: 'telegram', config: { botToken: 'x' } }, context);
      } catch (err) {
        draftErr = err;
      }
      expect(draftErr).to.be.instanceOf(InvalidOperationError);
      expect((draftErr as Error).message).to.include('channel');
    });

    it('throws NotFoundError for a missing saved provider', async () => {
      let err: unknown = null;
      try {
        await tester.testConnection({ providerId: 'prov_missing' }, context);
      } catch (e) {
        err = e;
      }
      expect(err).to.be.instanceOf(NotFoundError);
    });

    it('propagates guard errors from buildInstance (invalid draft config → ZodError, not a vendor result)', async () => {
      const strategy = new StubStrategy({ providerType: 'llm' });
      strategy.mode = 'guard-error';
      tester.registerStrategy(strategy);

      let err: unknown = null;
      try {
        await tester.testConnection({ providerType: 'llm', apiType: 'openai', config: { apiKey: 'sk' } }, context);
      } catch (e) {
        err = e;
      }
      expect(err).to.be.instanceOf(ZodError);
      // The test did not run — no call-log row.
      expect(callLogger.pendingEntries).to.be.empty;
    });

    it('builds a fresh instance per test (never a pooled/shared instance)', async () => {
      const strategy = new StubStrategy();
      tester.registerStrategy(strategy);
      tester.providers.set('prov_llm_1', savedProvider());

      await tester.testConnection({ providerId: 'prov_llm_1' }, context);
      (tester as unknown as { lastTestAt: Map<string, number> }).lastTestAt.clear();
      await tester.testConnection({ providerId: 'prov_llm_1' }, context);

      expect(strategy.buildInstanceCalls).to.equal(2);
      expect(strategy.instancesInTest[0]).to.not.equal(strategy.instancesInTest[1]);
    });
  });

  describe('vendor outcome classification (uniform result for every class)', () => {
    async function runVendorCase(error: unknown): Promise<ConnectionTestOutcome> {
      const strategy = new StubStrategy();
      strategy.mode = 'vendor-error';
      strategy.vendorError = error;
      tester.registerStrategy(strategy);
      return tester.testConnection({ providerType: 'llm', apiType: 'openai', config: { apiKey: 'sk' } }, context);
    }

    it('401 → errorCode auth, phase auth', async () => {
      const result = await runVendorCase(vendorError(401, 'Invalid API key provided'));
      expect(result.ok).to.equal(false);
      expect(result.errorCode).to.equal('auth');
      expect(result.phase).to.equal('auth');
    });

    it('429 → errorCode rate_limited, phase first-data', async () => {
      const result = await runVendorCase(vendorError(429, 'Rate limit reached for your organization'));
      expect(result.ok).to.equal(false);
      expect(result.errorCode).to.equal('rate_limited');
      expect(result.phase).to.equal('first-data');
    });

    it('ECONNREFUSED → errorCode network, phase first-data', async () => {
      const err = new Error('connect ECONNREFUSED 127.0.0.1:9999');
      (err as { code?: string }).code = 'ECONNREFUSED';
      const result = await runVendorCase(err);
      expect(result.ok).to.equal(false);
      expect(result.errorCode).to.equal('network');
      expect(result.phase).to.equal('first-data');
    });

    it('500 → errorCode server_error, phase first-data', async () => {
      const result = await runVendorCase(vendorError(500, 'Internal server error'));
      expect(result.ok).to.equal(false);
      expect(result.errorCode).to.equal('server_error');
      expect(result.phase).to.equal('first-data');
    });

    it('structured ConnectionTestFailure carries the phase the test reached (mid-stream close)', async () => {
      const strategy = new StubStrategy();
      strategy.mode = 'structured-failure';
      strategy.failurePhase = 'session';
      tester.registerStrategy(strategy);

      const result = await tester.testConnection({ providerType: 'llm', apiType: 'openai', config: { apiKey: 'sk' } }, context);

      expect(result.ok).to.equal(false);
      expect(result.phase).to.equal('session');
      expect(result.errorCode).to.equal('client_error');
      expect(result.errorText).to.equal('session config rejected by vendor');
    });
  });

  describe('cooldown (5s per saved provider id / draft key)', () => {
    it('second test for the same saved provider within 5s → TooManyRequestsError with Retry-After', async () => {
      tester.registerStrategy(new StubStrategy());
      tester.providers.set('prov_llm_1', savedProvider());
      await tester.testConnection({ providerId: 'prov_llm_1' }, context);

      let err: unknown = null;
      try {
        await tester.testConnection({ providerId: 'prov_llm_1' }, context);
      } catch (e) {
        err = e;
      }
      expect(err).to.be.instanceOf(TooManyRequestsError);
      const tmre = err as TooManyRequestsError;
      expect(tmre.retryAfterSeconds).to.be.a('number');
      expect(tmre.retryAfterSeconds).to.be.within(1, 5);
      expect(tmre.message).to.include('cooldown');
    });

    it('keys are per saved provider id (one provider does not block another)', async () => {
      const strategy = new StubStrategy();
      tester.registerStrategy(strategy);
      tester.providers.set('prov_llm_1', savedProvider());
      tester.providers.set('prov_llm_2', savedProvider({ id: 'prov_llm_2', name: 'Groq' }));

      await tester.testConnection({ providerId: 'prov_llm_1' }, context);
      const result = await tester.testConnection({ providerId: 'prov_llm_2' }, context);

      expect(result.ok).to.equal(true);
      expect(strategy.buildInstanceCalls).to.equal(2);
    });

    it('keys drafts by apiType + stable config hash (key order does not matter)', async () => {
      const strategy = new StubStrategy();
      tester.registerStrategy(strategy);
      const configA = { apiKey: 'sk-1', baseUrl: 'https://api.example.com' };
      const configAReordered = { baseUrl: 'https://api.example.com', apiKey: 'sk-1' };
      const configB = { apiKey: 'sk-2', baseUrl: 'https://api.example.com' };

      const keyA = connectionTestDraftKey('openai', configA);
      const keyA2 = connectionTestDraftKey('openai', configAReordered);
      const keyB = connectionTestDraftKey('openai', configB);
      expect(keyA).to.match(/^draft:openai:[0-9a-f]{12}$/);
      expect(keyA).to.equal(keyA2);
      expect(keyB).to.not.equal(keyA);

      await tester.testConnection({ providerType: 'llm', apiType: 'openai', config: configA }, context);

      // Same config, different key order → same key → blocked.
      let sameErr: unknown = null;
      try {
        await tester.testConnection({ providerType: 'llm', apiType: 'openai', config: configAReordered }, context);
      } catch (err) {
        sameErr = err;
      }
      expect(sameErr).to.be.instanceOf(TooManyRequestsError);

      // Different config (same apiType) → different key → allowed.
      const result = await tester.testConnection({ providerType: 'llm', apiType: 'openai', config: configB }, context);
      expect(result.ok).to.equal(true);
    });

    it('saved and draft keys never collide', async () => {
      const strategy = new StubStrategy();
      tester.registerStrategy(strategy);
      const config = { apiKey: 'sk-1' };
      tester.providers.set('prov_llm_1', savedProvider({ config: config as Provider['config'] }));

      await tester.testConnection({ providerType: 'llm', apiType: 'openai', config }, context);
      const result = await tester.testConnection({ providerId: 'prov_llm_1' }, context);

      expect(result.ok).to.equal(true);
    });

    it('allows a new test once the cooldown has expired', async () => {
      const strategy = new StubStrategy();
      tester.registerStrategy(strategy);
      tester.providers.set('prov_llm_1', savedProvider());
      await tester.testConnection({ providerId: 'prov_llm_1' }, context);

      // Backdate the last test by 6s (5s cooldown + margin).
      const lastTestAt = (tester as unknown as { lastTestAt: Map<string, number> }).lastTestAt;
      const lastAt = lastTestAt.get('prov_llm_1');
      expect(lastAt).to.not.equal(undefined);
      lastTestAt.set('prov_llm_1', lastAt - 6_000);

      const result = await tester.testConnection({ providerId: 'prov_llm_1' }, context);
      expect(result.ok).to.equal(true);
    });
  });

  describe('error-text sanitization', () => {
    it('redacts Bearer tokens', () => {
      expect(sanitizeErrorText('request failed: Bearer sk-proj-abc123secret was rejected')).to.equal('request failed: Bearer [REDACTED] was rejected');
    });

    it('redacts Basic auth blobs', () => {
      expect(sanitizeErrorText('401 for authorization Basic dXNlcjpwYXNzd29yZA==')).to.equal('401 for authorization Basic [REDACTED]');
    });

    it('redacts JWT-shaped tokens', () => {
      expect(sanitizeErrorText(`token ${JWT_SAMPLE} expired`)).to.equal('token [REDACTED] expired');
    });

    it('redacts key/token/secret assignments', () => {
      expect(sanitizeErrorText('failed with api_key=sk-proj-1234567890')).to.equal('failed with api_key=[REDACTED]');
      expect(sanitizeErrorText('invalid access_token "abc123def456"')).to.equal('invalid access_token [REDACTED]');
    });

    it('truncates to 500 chars', () => {
      const out = sanitizeErrorText(`prefix ${'x'.repeat(800)}`);
      expect(out.length).to.equal(500);
    });

    it('leaves ordinary messages untouched', () => {
      expect(sanitizeErrorText('Invalid API key provided')).to.equal('Invalid API key provided');
      expect(sanitizeErrorText('model gpt-test not found')).to.equal('model gpt-test not found');
    });

    it('sanitizes at the tester choke point (response AND the persisted row)', async () => {
      const strategy = new StubStrategy();
      strategy.recorder = recorder;
      strategy.mode = 'vendor-error';
      strategy.vendorError = new Error(`Authorization: Bearer sk-proj-abc123secret plus ${'y'.repeat(700)}`);
      tester.registerStrategy(strategy);
      tester.providers.set('prov_llm_1', savedProvider());

      const result = await tester.testConnection({ providerId: 'prov_llm_1' }, context);

      // Response path (tester).
      expect(result.errorText).to.include('Bearer [REDACTED]');
      expect(result.errorText).to.not.include('sk-proj-abc123secret');
      expect(result.errorText?.length).to.be.at.most(500);

      // Persisted row path (production wrapper → CallLogger write layer).
      await callLogger.flushNow();
      expect(callLogger.rows).to.have.length(1);
      const persisted = callLogger.rows[0].errorText;
      expect(persisted).to.not.equal(null);
      expect(persisted).to.include('Bearer [REDACTED]');
      expect(persisted).to.not.include('sk-proj-abc123secret');
      expect(persisted!.length).to.be.at.most(500);
    });
  });

  describe('call-log attribution (draft vs saved, via the production recording path)', () => {
    it('saved ok test → exactly one row with <type>.test operation, model and status filled', async () => {
      const strategy = new StubStrategy();
      strategy.recorder = recorder;
      tester.registerStrategy(strategy);
      tester.providers.set('prov_llm_1', savedProvider());

      const result = await tester.testConnection({ providerId: 'prov_llm_1', model: 'gpt-test' }, context);
      expect(result.ok).to.equal(true);

      expect(callLogger.pendingEntries).to.have.length(1);
      const row = callLogger.pendingEntries[0];
      expect(row.providerId).to.equal('prov_llm_1');
      expect(row.providerType).to.equal('llm');
      expect(row.apiType).to.equal('openai');
      expect(row.operation).to.equal('llm.test');
      expect(row.model).to.equal('gpt-test');
      expect(row.ok).to.equal(true);
      expect(row.errorCode).to.equal(null);
      expect(row.durationMs).to.equal(12);
    });

    it('saved failed test → exactly one row with errorCode/statusHttp/errorText from the vendor error', async () => {
      const strategy = new StubStrategy();
      strategy.recorder = recorder;
      strategy.mode = 'vendor-error';
      strategy.vendorError = vendorError(401, 'Invalid API key provided');
      tester.registerStrategy(strategy);
      tester.providers.set('prov_llm_1', savedProvider());

      await tester.testConnection({ providerId: 'prov_llm_1', model: 'gpt-test' }, context);

      expect(callLogger.pendingEntries).to.have.length(1);
      const row = callLogger.pendingEntries[0];
      expect(row.operation).to.equal('llm.test');
      expect(row.ok).to.equal(false);
      expect(row.errorCode).to.equal('auth');
      expect(row.statusHttp).to.equal(401);
      expect(row.errorText).to.equal('Invalid API key provided');
    });

    it('draft tests → zero call-log rows (un-stamped instances, nothing to attribute to)', async () => {
      const strategy = new StubStrategy();
      strategy.recorder = recorder;
      tester.registerStrategy(strategy);
      const result = await tester.testConnection({ providerType: 'llm', apiType: 'openai', config: { apiKey: 'sk-draft' } }, context);
      expect(result.ok).to.equal(true);
      expect(callLogger.pendingEntries).to.be.empty;
    });

    it('the row carries the model the production path stamped (strategy-reported, not the request model)', async () => {
      const strategy = new StubStrategy();
      strategy.recorder = recorder;
      strategy.outcomeOverrides = { model: 'gpt-defaulted' };
      tester.registerStrategy(strategy);
      tester.providers.set('prov_llm_1', savedProvider());

      await tester.testConnection({ providerId: 'prov_llm_1' }, context);
      expect(callLogger.pendingEntries[0].model).to.equal('gpt-defaulted');
    });
  });

  describe('timeout wrap (hard timeout per strategy)', () => {
    it('a hanging strategy returns ok:false timeout and its cleanup() was awaited', async function () {
      this.timeout(5_000);
      const strategy = new StubStrategy({ timeoutMs: 60 });
      strategy.mode = 'hang';
      tester.registerStrategy(strategy);
      tester.providers.set('prov_llm_1', savedProvider());

      const startedAt = Date.now();
      const result = await tester.testConnection({ providerId: 'prov_llm_1' }, context);
      const elapsed = Date.now() - startedAt;

      expect(result.ok).to.equal(false);
      expect(result.errorCode).to.equal('timeout');
      expect(result.phase).to.equal('session');
      expect(result.latencyMs).to.be.at.least(55);
      expect(elapsed).to.be.at.least(55);
      expect(strategy.cleanupCalls).to.equal(1);

      // The production path only records on settle; a hard timeout leaves the
      // vendor call in flight, so no row yet (a late settle would land under
      // the test context and stay breaker-excluded).
      expect(callLogger.pendingEntries).to.be.empty;
    });

    it('the timeout also wraps buildInstance (no cleanup possible when the instance never materializes)', async function () {
      this.timeout(5_000);
      const strategy = new StubStrategy({ timeoutMs: 60 });
      strategy.mode = 'hang-build';
      tester.registerStrategy(strategy);
      tester.providers.set('prov_llm_1', savedProvider());

      const result = await tester.testConnection({ providerId: 'prov_llm_1' }, context);

      expect(result.ok).to.equal(false);
      expect(result.errorCode).to.equal('timeout');
      expect(strategy.buildInstanceCalls).to.equal(1);
      expect(strategy.cleanupCalls).to.equal(0);
    });
  });
});

describe('CallLogger breaker exclusion for connection tests (TPC-01)', () => {
  let callLogger: TestCallLogger;

  beforeEach(() => {
    callLogger = new TestCallLogger();
  });

  function entry(overrides: Partial<ProviderCallEntry> = {}): ProviderCallEntry {
    return {
      providerId: 'prov_llm_1',
      providerType: 'llm',
      apiType: 'openai',
      operation: 'llm.generate',
      ok: false,
      errorCode: 'server_error',
      durationMs: 10,
      ...overrides,
    };
  }

  it('5 failed *.test rows do NOT feed the breaker (rows still buffered)', () => {
    for (let i = 0; i < 5; i++) {
      callLogger.record(entry({ operation: 'llm.test', errorCode: 'auth', ok: false }));
    }
    expect(callLogger.breakerRegistryForTests.failures).to.be.empty;
    expect(callLogger.breakerRegistryForTests.successes).to.be.empty;
    expect(callLogger.pendingEntries).to.have.length(5);
  });

  it('successful *.test rows do NOT feed the breaker either', () => {
    for (let i = 0; i < 5; i++) {
      callLogger.record(entry({ operation: 'llm.test', ok: true, errorCode: null }));
    }
    expect(callLogger.breakerRegistryForTests.successes).to.be.empty;
    expect(callLogger.breakerRegistryForTests.failures).to.be.empty;
  });

  it('5 failed production rows DO feed the breaker (unchanged behavior)', () => {
    for (let i = 0; i < 5; i++) {
      callLogger.record(entry({ operation: 'llm.generate', ok: false, errorCode: 'server_error' }));
    }
    expect(callLogger.breakerRegistryForTests.failures).to.have.length(5);
    expect(callLogger.breakerRegistryForTests.failures[0]).to.deep.equal({ providerId: 'prov_llm_1', errorCode: 'server_error' });
  });

  it('production and test rows for the same provider: only production ones feed', () => {
    callLogger.record(entry({ operation: 'llm.test', ok: false, errorCode: 'auth' }));
    callLogger.record(entry({ operation: 'llm.generate', ok: false, errorCode: 'auth' }));
    callLogger.record(entry({ operation: 'asr.test', ok: false, errorCode: 'auth', providerType: 'asr' }));
    expect(callLogger.breakerRegistryForTests.failures).to.have.length(1);
    expect(callLogger.pendingEntries).to.have.length(3);
  });

  it('rows made under the tester monitoring context (auxiliary ops, e.g. model enumeration) also skip the breaker', () => {
    MonitoringContext.run({ operation: 'llm.test' }, () => {
      callLogger.record(entry({ operation: 'llm.models', ok: false, errorCode: 'auth' }));
    });
    expect(callLogger.breakerRegistryForTests.failures).to.be.empty;
    expect(callLogger.breakerRegistryForTests.successes).to.be.empty;
    expect(callLogger.pendingEntries).to.have.length(1);
    expect(callLogger.pendingEntries[0].operation).to.equal('llm.models');
  });
});

describe('LlmProviderFactory.createForTest (TPC-01 seam)', () => {
  it('builds a fresh, initialized instance with secrets resolved', async () => {
    const resolvedConfigs: unknown[] = [];
    const secretRefStub = {
      resolveObject: async (obj: Record<string, unknown>) => {
        resolvedConfigs.push(obj);
        return obj;
      },
    };
    const factory = new LlmProviderFactory(secretRefStub as never);
    const provider = savedProvider();

    const instance = await factory.createForTest(provider, { model: 'gpt-test' });

    expect(instance).to.be.instanceOf(OpenAILlmProvider);
    expect(resolvedConfigs).to.have.length(1);
    // Stamp for call-log attribution (P1-03 pattern).
    expect((instance as unknown as { providerId?: string }).providerId).to.equal('prov_llm_1');

    const second = await factory.createForTest(provider, { model: 'gpt-test' });
    expect(second).to.not.equal(instance);
  });

  it('rejects non-llm provider types', async () => {
    const factory = new LlmProviderFactory({ resolveObject: async (obj: Record<string, unknown>) => obj } as never);
    let err: unknown = null;
    try {
      await factory.createForTest(savedProvider({ providerType: 'asr' }), { model: 'gpt-test' });
    } catch (e) {
      err = e;
    }
    expect(err).to.be.instanceOf(Error);
    expect((err as Error).message).to.include('not an LLM provider');
  });

  it('rejects missing model', async () => {
    const factory = new LlmProviderFactory({ resolveObject: async (obj: Record<string, unknown>) => obj } as never);
    let err: unknown = null;
    try {
      await factory.createForTest(savedProvider(), {} as never);
    } catch (e) {
      err = e;
    }
    expect(err).to.be.instanceOf(Error);
    expect((err as Error).message).to.include('model');
  });

  it('works with the synthetic draft provider (id draft, plaintext config, never persisted)', async () => {
    const factory = new LlmProviderFactory({ resolveObject: async (obj: Record<string, unknown>) => obj } as never);
    const instance = await factory.createForTest(
      {
        id: 'draft',
        name: 'draft',
        description: null,
        providerType: 'llm',
        apiType: 'openai',
        config: { apiKey: 'sk-plaintext' } as Provider['config'],
        fallbacks: [],
        createdBy: null,
        tags: null,
        version: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      { model: 'gpt-test' },
    );
    expect(instance).to.be.instanceOf(OpenAILlmProvider);
    // Un-stamped on purpose: the production wrapper's recorder early-returns,
    // so draft tests persist no call-log rows (TPC-01 contract).
    expect((instance as unknown as { providerId?: string | null }).providerId ?? null).to.equal(null);
  });
});

describe('stableStringify + draft key helpers (TPC-01)', () => {
  it('stableStringify is key-order invariant and recursive', () => {
    expect(stableStringify({ a: 1, b: { c: 2, d: [1, 2] } })).to.equal(stableStringify({ b: { d: [1, 2], c: 2 }, a: 1 }));
    expect(stableStringify({ a: 1 })).to.not.equal(stableStringify({ a: 2 }));
  });

  it('draft keys are apiType-scoped', () => {
    expect(connectionTestDraftKey('openai', { apiKey: 'x' })).to.not.equal(connectionTestDraftKey('groq', { apiKey: 'x' }));
  });
});
