import 'reflect-metadata';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, before, after, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { eq } from 'drizzle-orm';
import { authed, unauthed, resetDatabase } from '../utils';
import { db } from '../../src/db/index';
import { alertEvents, fallbackEvents } from '../../src/db/schema';
import type { MonitoringConfig } from '../../src/http/contracts/monitoring';
import type { MonitoringConfigService } from '../../src/services/monitoring/MonitoringConfigService';
import type { AlertRuleEngine } from '../../src/services/monitoring/AlertRuleEngine';

/**
 * P3-06 e2e — fallback events endpoint + the provider-chain-exhausted alert
 * rule against the live app (engine interval 1s via tests/setup.ts).
 *
 * Part A exercises GET /api/monitoring/fallback-events (auth, shape,
 * filters, text search, pagination) against seeded rows. Part B forces a
 * real chain exhaustion through the app-world FailoverLlmProvider (two
 * local mock endpoints both answering 401 — the P3-03 fixture pattern) and
 * asserts the live engine fires provider-chain-exhausted with the chain
 * named in the message.
 */

let serverA: http.Server;
let serverB: http.Server;
let portA: number;
let portB: number;
let requestsA = 0;
let requestsB = 0;

function startServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, port });
    });
  });
}

function createOpenAiProvider(id: string, name: string, baseUrl: string, fallbacks?: Array<{ providerId: string }>) {
  return authed().post('/api/providers').send({
    id,
    name,
    providerType: 'llm',
    apiType: 'openai',
    config: { apiKey: 'sk-mock', baseUrl },
    ...(fallbacks ? { fallbacks } : {}),
  });
}

function engine(): AlertRuleEngine {
  const svc = (globalThis as any).__TEST_ALERT_ENGINE__ as AlertRuleEngine | undefined;
  expect(svc).to.not.equal(undefined, '__TEST_ALERT_ENGINE__ is not set — tests/setup.ts must expose the app-world alert engine');
  return svc;
}

async function useConfig(eng: AlertRuleEngine, ruleId: string, override: Record<string, unknown>): Promise<void> {
  const configService = (globalThis as any).__TEST_MONITORING_CONFIG__ as MonitoringConfigService;
  const base: MonitoringConfig = await configService.get();
  eng.setConfigProviderForTests(async () => ({
    ...base,
    rules: { ...base.rules, [ruleId]: override },
  }));
}

/** The engine invokes the publisher fire-and-forget — poll until the state lands. */
async function waitForAlerts(scopeKey: string, expectStatus: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await db.select().from(alertEvents).where(eq(alertEvents.scopeKey, scopeKey));
    if (rows.length > 0 && rows.every((r) => r.status === expectStatus)) return rows;
    if (Date.now() > deadline) return rows;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('P3-06 fallback events + rules (e2e)', function () {
  before(async function () {
    this.timeout(10000);
    // Both mocks answer 401 — every attempt in the chain fails.
    ({ server: serverA, port: portA } = await startServer((_req, res) => {
      requestsA += 1;
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid API key' } }));
    }));
    ({ server: serverB, port: portB } = await startServer((_req, res) => {
      requestsB += 1;
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid API key' } }));
    }));
  });

  after(async function () {
    this.timeout(10000);
    await new Promise<void>((resolve) => serverA.close(() => resolve()));
    await new Promise<void>((resolve) => serverB.close(() => resolve()));
  });

  beforeEach(async () => {
    await resetDatabase();
    requestsA = 0;
    requestsB = 0;
  });

  afterEach(async () => {
    engine().setConfigProviderForTests(null);
  });

  describe('GET /api/monitoring/fallback-events', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await unauthed().get('/api/monitoring/fallback-events');
      expect(res.status).to.equal(401);
    });

    it('returns an empty page with the standard list shape', async () => {
      const res = await authed().get('/api/monitoring/fallback-events');
      expect(res.status).to.equal(200);
      expect(res.body).to.deep.equal({ items: [], total: 0, offset: 0, limit: 100 });
    });

    it('lists seeded rows, filters, text search, and pagination', async () => {
      const now = Date.now();
      await db.insert(fallbackEvents).values([
        { id: 'fe_p306_1', providerId: 'prov_p306_a', fallbackProviderId: 'prov_p306_b', providerType: 'llm', operation: 'llm.generate', reason: 'auth', success: true, createdAt: new Date(now - 3000) },
        { id: 'fe_p306_2', providerId: 'prov_p306_a', fallbackProviderId: 'prov_p306_c', providerType: 'llm', operation: 'llm.generate', reason: 'timeout', success: false, createdAt: new Date(now - 2000) },
        { id: 'fe_p306_3', providerId: 'prov_p306_d', fallbackProviderId: 'prov_p306_b', providerType: 'tts', operation: 'tts.session', reason: 'server_error', success: true, createdAt: new Date(now - 1000) },
      ]);

      const all = await authed().get('/api/monitoring/fallback-events');
      expect(all.status).to.equal(200);
      expect(all.body.total).to.equal(3);
      // Default order: newest first.
      expect(all.body.items.map((r: { id: string }) => r.id)).to.deep.equal(['fe_p306_3', 'fe_p306_2', 'fe_p306_1']);
      expect(all.body.items[0]).to.have.property('fallbackProviderId', 'prov_p306_b');
      expect(all.body.items[0]).to.have.property('success', true);

      const byProvider = await authed().get('/api/monitoring/fallback-events').query({ filters: { providerId: 'prov_p306_a' } });
      expect(byProvider.status).to.equal(200);
      expect(byProvider.body.total).to.equal(2);

      const failedOnly = await authed().get('/api/monitoring/fallback-events').query({ filters: { success: false } });
      expect(failedOnly.status).to.equal(200);
      expect(failedOnly.body.total).to.equal(1);
      expect(failedOnly.body.items[0].id).to.equal('fe_p306_2');

      const byReason = await authed().get('/api/monitoring/fallback-events').query({ filters: { reason: { op: 'eq', value: 'server_error' } } });
      expect(byReason.status).to.equal(200);
      expect(byReason.body.total).to.equal(1);
      expect(byReason.body.items[0].providerType).to.equal('tts');

      const bySearch = await authed().get('/api/monitoring/fallback-events').query({ textSearch: 'prov_p306_b' });
      expect(bySearch.status).to.equal(200);
      expect(bySearch.body.total).to.equal(2);

      const page = await authed().get('/api/monitoring/fallback-events').query({ limit: 2, offset: 1 });
      expect(page.status).to.equal(200);
      expect(page.body.total).to.equal(3);
      expect(page.body.items).to.have.length(2);
      expect(page.body.items.map((r: { id: string }) => r.id)).to.deep.equal(['fe_p306_2', 'fe_p306_1']);
    });
  });

  describe('provider-chain-exhausted rule', () => {
    it('fires the live engine on a forced chain exhaustion and names the chain', async function () {
      this.timeout(30000);
      const bRes = await createOpenAiProvider('p306_b', 'Failover P306 B', `http://127.0.0.1:${portB}`);
      expect(bRes.status).to.equal(201);
      const aRes = await createOpenAiProvider('p306_a', 'Failover P306 A', `http://127.0.0.1:${portA}`, [{ providerId: 'p306_b' }]);
      expect(aRes.status).to.equal(201);

      const eng = engine();
      await useConfig(eng, 'provider-chain-exhausted', { forMinutes: 0, resolveAfterGoodChecks: 3, cooldownMinutes: 0 });

      const chain = await (globalThis as any).__TEST_FALLBACK_RESOLVER__.resolveChain('p306_a');
      expect(chain.map((s: { provider: { id: string } }) => s.provider.id)).to.deep.equal(['p306_a', 'p306_b']);

      const factory = (globalThis as any).__TEST_LLM_FACTORY__;
      const settings = { model: 'gpt-4o-mini' };
      const primary = await factory.createProvider(chain[0].provider, settings);
      const wrapper = new (globalThis as any).__TEST_FAILOVER_PROVIDER__('p306_a', primary, chain.slice(1), settings, {
        factory,
        breakerRegistry: (globalThis as any).__TEST_BREAKER_REGISTRY__,
        fallbackEvents: (globalThis as any).__TEST_FALLBACK_EVENTS__,
        metrics: (globalThis as any).__TEST_METRICS_REGISTRY__,
      });
      wrapper.setOnError(() => {});

      let thrown: unknown = null;
      try {
        await wrapper.generateStream([{ role: 'system', content: 'test' }, { role: 'user', content: 'hi' }]);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).to.not.equal(null, 'generateStream must throw when the chain is exhausted');
      expect(requestsA).to.equal(1);
      expect(requestsB).to.equal(1);

      // The transition row (failure, fallback did not serve) is recorded.
      const events = await db.select().from(fallbackEvents).where(eq(fallbackEvents.providerId, 'p306_a'));
      expect(events).to.have.length(1);
      expect(events[0].fallbackProviderId).to.equal('p306_b');
      expect(events[0].reason).to.equal('auth');
      expect(events[0].success).to.equal(false);

      // The endpoint serves the transition row.
      const listed = await authed()
        .get('/api/monitoring/fallback-events')
        .query({ filters: { providerId: 'p306_a' } });
      expect(listed.status).to.equal(200);
      expect(listed.body.total).to.equal(1);
      expect(listed.body.items[0].fallbackProviderId).to.equal('p306_b');
      expect(listed.body.items[0].success).to.equal(false);

      // Drive the live engine: exhaustion counter + fallback event are both
      // app-world state, so the rule must fire for p306_a.
      await eng.runNow();
      const firing = await waitForAlerts('provider-chain-exhausted:p306_a', 'firing');
      expect(firing).to.have.length(1);
      const row = firing[0];
      expect(row.severity).to.equal('critical');
      expect(row.message).to.contain('exhausted its failover chain');
      expect(row.message).to.contain('Failover P306 B (p306_b)');
      expect(row.context.failoverChain).to.deep.equal(['p306_a', 'p306_b']);
    });
  });
});
