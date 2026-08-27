import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { CallLogger, type ProviderCallEntry } from '../../../src/services/monitoring/CallLogger';
import type { ProviderCallLogRow } from '../../../src/services/monitoring/CallLogger';
import { MonitoringContext } from '../../../src/services/monitoring/MonitoringContext';

/** P3-01 test double: records the breaker hooks instead of touching real breakers. */
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

/** Test seam: exposes the private buffer and captures rows instead of hitting the DB. */
class TestCallLogger extends CallLogger {
  rows: any[] = [];
  flushErrors: unknown[] = [];
  failPersists = false;
  private readonly fakeBreakers: FakeBreakerRegistry;

  constructor(breakerRegistry?: FakeBreakerRegistry) {
    const fake = breakerRegistry ?? new FakeBreakerRegistry();
    super(fake as never);
    this.fakeBreakers = fake;
  }

  get breakerRegistryForTests(): FakeBreakerRegistry {
    return this.fakeBreakers;
  }

  get pendingEntries(): ProviderCallEntry[] {
    return this.buffer;
  }

  protected async persistRows(rows: ProviderCallLogRow[]): Promise<void> {
    if (this.failPersists) throw new Error('db down');
    this.rows.push(...rows);
  }

  protected onFlushError(err: unknown): void {
    this.flushErrors.push(err);
  }
}

function validEntry(overrides: Partial<ProviderCallEntry> = {}): ProviderCallEntry {
  return {
    providerId: 'prov_test',
    providerType: 'llm',
    apiType: 'openai',
    operation: 'llm.generate',
    model: 'gpt-x',
    ok: true,
    durationMs: 120,
    ...overrides,
  };
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('CallLogger (P1-02)', () => {
  let logger: TestCallLogger;
  const originalEnv = process.env.MONITORING_CALL_LOG_BUFFER_SIZE;

  beforeEach(() => {
    logger = new TestCallLogger();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.MONITORING_CALL_LOG_BUFFER_SIZE;
    else process.env.MONITORING_CALL_LOG_BUFFER_SIZE = originalEnv;
  });

  describe('record()', () => {
    it('is synchronous and never throws, even on garbage input', () => {
      expect(() => logger.record(null as unknown as ProviderCallEntry)).to.not.throw();
      expect(() => logger.record(undefined as unknown as ProviderCallEntry)).to.not.throw();
      expect(() => logger.record({} as ProviderCallEntry)).to.not.throw();
      expect(() => logger.record(validEntry({ ok: 'yes' as unknown as boolean }))).to.not.throw();
      expect(() => logger.record(validEntry({ durationMs: NaN }))).to.not.throw();
      expect(logger.pendingEntries.length).to.equal(0);
    });

    it('buffers valid entries', () => {
      logger.record(validEntry());
      logger.record(validEntry({ operation: 'llm.classify' }));
      expect(logger.pendingEntries.length).to.equal(2);
    });

    it('fills projectId/conversationId/operation from MonitoringContext', () => {
      MonitoringContext.run(
        { projectId: 'proj_x', conversationId: 'conv_y', operation: 'llm.generate' },
        () => logger.record(validEntry({ operation: undefined })),
      );
      expect(logger.pendingEntries[0].projectId).to.equal('proj_x');
      expect(logger.pendingEntries[0].conversationId).to.equal('conv_y');
      expect(logger.pendingEntries[0].operation).to.equal('llm.generate');
    });

    it('explicit entry fields win over context', () => {
      MonitoringContext.run(
        { projectId: 'proj_ctx', conversationId: 'conv_ctx' },
        () => logger.record(validEntry({ projectId: 'proj_explicit', conversationId: 'conv_explicit' })),
      );
      expect(logger.pendingEntries[0].projectId).to.equal('proj_explicit');
      expect(logger.pendingEntries[0].conversationId).to.equal('conv_explicit');
    });

    it('sanitizes and truncates errorText to 500 chars on flush (TPC-01 write-layer guard)', async () => {
      logger.record(validEntry({ ok: false, errorCode: 'server_error', errorText: `Bearer sk-proj-abc123secret ${'x'.repeat(5000)}` }));
      await logger.flushNow();
      expect(logger.rows[0].errorText.length).to.equal(500);
      expect(logger.rows[0].errorText).to.include('Bearer [REDACTED]');
      expect(logger.rows[0].errorText).to.not.include('sk-proj-abc123secret');
    });

    it('auto-flushes at the 200-row threshold', async () => {
      for (let i = 0; i < 200; i++) logger.record(validEntry({ operation: `op_${i}` }));
      // fire-and-forget flush — let the microtask queue drain
      await nextTick();
      await nextTick();
      expect(logger.rows.length).to.equal(200);
      expect(logger.pendingEntries.length).to.equal(0);
    });
  });

  describe('flushNow()', () => {
    it('drains the buffer and writes rows with generated id/createdAt', async () => {
      logger.record(validEntry({ metrics: { ttftMs: 123, chunksCount: 5, maxChunkGapMs: 80 } }));
      logger.record(
        validEntry({
          ok: false,
          errorCode: 'rate_limited',
          statusHttp: 429,
          errorText: 'Rate limit reached',
          fallbackProviderId: 'prov_fallback',
        }),
      );
      await logger.flushNow();

      expect(logger.rows.length).to.equal(2);
      const [first, second] = logger.rows;
      expect(first.id).to.match(/^clgl_/);
      expect(first.createdAt).to.be.instanceOf(Date);
      expect(first.providerId).to.equal('prov_test');
      expect(first.model).to.equal('gpt-x');
      expect(first.metrics).to.deep.equal({ ttftMs: 123, chunksCount: 5, maxChunkGapMs: 80 });
      expect(first.projectId).to.equal(null);

      expect(second.ok).to.equal(false);
      expect(second.errorCode).to.equal('rate_limited');
      expect(second.statusHttp).to.equal(429);
      expect(second.fallbackProviderId).to.equal('prov_fallback');
      expect(second.metrics).to.equal(null);

      expect(logger.pendingEntries.length).to.equal(0);
    });

    it('empty flush is a no-op', async () => {
      await logger.flushNow();
      expect(logger.rows.length).to.equal(0);
      expect(logger.flushErrors.length).to.equal(0);
    });

    it('persist failure: rows re-queued, exactly one error, retry succeeds', async () => {
      logger.record(validEntry({ operation: 'a' }));
      logger.record(validEntry({ operation: 'b' }));
      logger.record(validEntry({ operation: 'c' }));

      logger.failPersists = true;
      await logger.flushNow(); // must not throw
      expect(logger.flushErrors.length).to.equal(1);
      expect(logger.lastFlushError).to.be.instanceOf(Error);
      expect(logger.pendingEntries.length).to.equal(3); // re-queued

      logger.failPersists = false;
      await logger.flushNow();
      expect(logger.rows.length).to.equal(3);
      expect(logger.rows.map((r) => r.operation)).to.deep.equal(['a', 'b', 'c']); // order preserved
      expect(logger.flushErrors.length).to.equal(1); // still exactly one error total
    });
  });

  describe('buffer overflow', () => {
    it('drops oldest entries beyond MONITORING_CALL_LOG_BUFFER_SIZE', async () => {
      process.env.MONITORING_CALL_LOG_BUFFER_SIZE = '5';
      logger = new TestCallLogger();
      for (let i = 0; i < 8; i++) logger.record(validEntry({ operation: `op_${i}` }));
      expect(logger.pendingEntries.length).to.equal(5);
      // oldest (op_0..op_2) dropped
      expect(logger.pendingEntries.map((e) => e.operation)).to.deep.equal(['op_3', 'op_4', 'op_5', 'op_6', 'op_7']);
    });

    it('falls back to the default of 10000 for an invalid env value', () => {
      process.env.MONITORING_CALL_LOG_BUFFER_SIZE = 'not-a-number';
      logger = new TestCallLogger();
      for (let i = 0; i < 10; i++) logger.record(validEntry());
      expect(logger.pendingEntries.length).to.equal(10);
    });
  });

  describe('circuit breaker wiring (P3-01)', () => {
    it('feeds successes to the registry', () => {
      logger.record(validEntry({ ok: true, providerId: 'prov_ok' }));
      expect(logger.breakerRegistryForTests.successes).to.deep.equal(['prov_ok']);
      expect(logger.breakerRegistryForTests.failures).to.be.empty;
    });

    it('feeds failures with their errorCode to the registry', () => {
      logger.record(validEntry({ ok: false, errorCode: 'timeout', providerId: 'prov_fail' }));
      expect(logger.breakerRegistryForTests.failures).to.deep.equal([{ providerId: 'prov_fail', errorCode: 'timeout' }]);
      expect(logger.breakerRegistryForTests.successes).to.be.empty;
    });

    it('passes null errorCode through (the breaker treats it as unknown)', () => {
      logger.record(validEntry({ ok: false, errorCode: null, providerId: 'prov_unknown' }));
      expect(logger.breakerRegistryForTests.failures).to.deep.equal([{ providerId: 'prov_unknown', errorCode: null }]);
    });

    it('invalid entries are dropped before reaching the breaker', () => {
      logger.record({ providerId: '', providerType: 'llm', apiType: 'openai', ok: false, durationMs: 1 } as never);
      expect(logger.breakerRegistryForTests.failures).to.be.empty;
      expect(logger.breakerRegistryForTests.successes).to.be.empty;
    });
  });
});
