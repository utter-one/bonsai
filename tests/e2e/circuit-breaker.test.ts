import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';
import { db } from '../../src/db';
import { providers } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { monitoringConfigSchema } from '../../src/http/contracts/monitoring';

/**
 * P3-01 e2e — the real instrumented path: a provider with a bogus URL fails
 * every call with `network`; each failure flows LlmProviderBase →
 * CallLogger.record → CircuitBreakerRegistry → breaker opens after 5.
 *
 * There is no HTTP endpoint that runs an LLM turn in the e2e process (quick
 * prompts are template CRUD, conversation input is WebSocket-only), so the
 * app-world LlmProviderFactory (exposed by tests/setup.ts) drives generate().
 *
 * NOTE: the e2e breaker is process-lifetime in-memory state; this suite uses a
 * unique provider id so earlier suites (or a re-run in the same process) can
 * never leak state into the assertions.
 */
const g = globalThis as any;

describe('P3-01 circuit breaker e2e', function () {
  this.timeout(60_000);

  let bogusProviderId: string;

  before(async () => {
    await resetDatabase();
    const res = await authed()
      .post('/api/providers')
      .send({
        name: 'CB Bogus LLM',
        providerType: 'llm',
        apiType: 'openai',
        config: { apiKey: 'sk-e2e-bogus', baseUrl: 'http://127.0.0.1:9/v1' },
      });
    expect(res.status).to.equal(201);
    bogusProviderId = res.body.id;
  });

  after(async () => {
    await resetDatabase();
  });

  it('opens the breaker after 5 instrumented network failures and exposes it via /api/monitoring/providers', async () => {
    const rows = await db.select().from(providers).where(eq(providers.id, bogusProviderId));
    expect(rows).to.have.length(1);

    const factory = g.__TEST_LLM_FACTORY__;
    expect(factory, '__TEST_LLM_FACTORY__ seam must be set by tests/setup.ts').to.exist;
    const instance = await factory.createProvider(rows[0], { model: 'gpt-4o-mini' });
    await instance.init();

    for (let i = 0; i < 5; i++) {
      let failed = false;
      try {
        await instance.generate([{ role: 'user', content: 'ping' }], { maxTokens: 1 });
      } catch (err) {
        failed = true;
      }
      expect(failed, `generate() #${i + 1} must fail against the bogus URL`).to.equal(true);
    }
    // CallLogger.record() is synchronous → breaker state is immediate.

    const res = await authed().get('/api/monitoring/providers');
    expect(res.status).to.equal(200);
    const row = res.body.providers.find((p: any) => p.id === bogusProviderId);
    expect(row, 'provider must appear in the monitoring overview').to.exist;
    expect(row.circuitBreaker, 'breaker state must be present after recorded calls').to.not.equal(null);
    expect(row.circuitBreaker.state).to.equal('open');
    expect(row.circuitBreaker.failuresInWindow).to.be.at.least(5);
    expect(row.circuitBreaker.opensInLast24h).to.be.at.least(1);
    expect(row.circuitBreaker.lastStateChangeAt).to.be.a('string');
  });

  it('shows circuitBreaker: null for providers without recorded calls', async () => {
    const res = await authed()
      .post('/api/providers')
      .send({
        name: 'CB Untouched LLM',
        providerType: 'llm',
        apiType: 'anthropic',
        config: { apiKey: 'sk-e2e-untouched' },
      });
    expect(res.status).to.equal(201);

    const overview = await authed().get('/api/monitoring/providers');
    expect(overview.status).to.equal(200);
    const row = overview.body.providers.find((p: any) => p.id === res.body.id);
    expect(row).to.exist;
    expect(row.circuitBreaker).to.equal(null);
  });

  it('accepts circuitBreaker settings via PUT /api/monitoring/config and echoes them back', async () => {
    const get = await authed().get('/api/monitoring/config');
    expect(get.status).to.equal(200);
    const version = get.body.version;

    const put = await authed()
      .put('/api/monitoring/config')
      .send({
        version,
        config: { circuitBreaker: { failureThreshold: 3, windowMs: 120_000, cooldownMs: 120_000 } },
      });
    expect(put.status).to.equal(200);
    expect(put.body.config.circuitBreaker).to.deep.equal({ failureThreshold: 3, windowMs: 120_000, cooldownMs: 120_000 });

    const get2 = await authed().get('/api/monitoring/config');
    expect(get2.status).to.equal(200);
    expect(get2.body.config.circuitBreaker).to.deep.equal({ failureThreshold: 3, windowMs: 120_000, cooldownMs: 120_000 });

    // restore defaults for other suites (monitoring_config survives resetDatabase)
    const defaults = monitoringConfigSchema.parse({});
    const restore = await authed()
      .put('/api/monitoring/config')
      .send({ version: put.body.version, config: defaults });
    expect(restore.status).to.equal(200);
    expect(restore.body.config.circuitBreaker).to.deep.equal({ failureThreshold: 5, windowMs: 60_000, cooldownMs: 300_000 });
  });

  it('rejects invalid circuitBreaker settings (below minimums / non-ints)', async () => {
    const get = await authed().get('/api/monitoring/config');
    expect(get.status).to.equal(200);
    const version = get.body.version;

    const bad = await authed()
      .put('/api/monitoring/config')
      .send({
        version,
        config: { circuitBreaker: { failureThreshold: 0, windowMs: 500, cooldownMs: 300_000 } },
      });
    expect(bad.status).to.equal(400);

    const bad2 = await authed()
      .put('/api/monitoring/config')
      .send({
        version,
        config: { circuitBreaker: { failureThreshold: 5.5, windowMs: 60_000, cooldownMs: 300_000 } },
      });
    expect(bad2.status).to.equal(400);
  });
});
