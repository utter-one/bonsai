import 'reflect-metadata';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, before, after, beforeEach } from 'mocha';
import { expect } from 'chai';
import { eq } from 'drizzle-orm';
import { authed, resetDatabase } from '../utils';
import { db } from '../../src/db/index';
import { providerCallLogs, fallbackEvents } from '../../src/db/schema';

/**
 * P3-03 e2e — LLM failover against real (local) mock HTTP endpoints.
 *
 * Provider A's mock always answers 401; provider B's mock serves a valid
 * OpenAI Responses SSE stream. A.fallbacks = [B]. The test drives the
 * FailoverLlmWrapper end-to-end: app-world factory creates the providers,
 * the app-world call logger records both attempts, and the app-world
 * FallbackEventService writes the transition row.
 */

let serverA: http.Server;
let serverB: http.Server;
let portA: number;
let portB: number;
let requestsA = 0;
let requestsB = 0;

function sseStream(res: http.ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write('data: {"type":"response.created","response":{"id":"resp_mock","status":"in_progress"}}\n\n');
  res.write('data: {"type":"response.output_text.delta","delta":"Hello"}\n\n');
  res.write('data: {"type":"response.output_text.delta","delta":" from fallback B"}\n\n');
  res.write('data: {"type":"response.completed","response":{"id":"resp_mock","status":"completed","usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}}\n\n');
  res.write('data: [DONE]\n\n');
  res.end();
}

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

describe('LLM failover (P3-03, e2e)', function () {
  before(async () => {
    ({ server: serverA, port: portA } = await startServer((_req, res) => {
      requestsA += 1;
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid API key' } }));
    }));
    ({ server: serverB, port: portB } = await startServer((_req, res) => {
      requestsB += 1;
      sseStream(res);
    }));
  });

  after(async () => {
    await new Promise<void>((resolve) => serverA.close(() => resolve()));
    await new Promise<void>((resolve) => serverB.close(() => resolve()));
  });

  beforeEach(async () => {
    await resetDatabase();
    requestsA = 0;
    requestsB = 0;
  });

  it('fails over from a 401 primary to a healthy fallback and records both calls + the transition event', async function () {
    this.timeout(30000);
    const bRes = await createOpenAiProvider('ff_b', 'Failover B', `http://127.0.0.1:${portB}`);
    expect(bRes.status).to.equal(201);
    const aRes = await createOpenAiProvider('ff_a', 'Failover A', `http://127.0.0.1:${portA}`, [{ providerId: 'ff_b' }]);
    expect(aRes.status).to.equal(201);

    // App-world chain resolution (dual-module-graph seam).
    const chain = await (globalThis as any).__TEST_FALLBACK_RESOLVER__.resolveChain('ff_a');
    expect(chain.map((s: any) => s.provider.id)).to.deep.equal(['ff_a', 'ff_b']);

    // Build the wrapper with the APP-WORLD class (seam) around app-world
    // provider instances — dual-module-graph: a test-world class would fail
    // instanceof/CircuitOpenError identity against app-world instances.
    const factory = (globalThis as any).__TEST_LLM_FACTORY__;
    const settings = { model: 'gpt-4o-mini' };
    const primary = await factory.createProvider(chain[0].provider, settings);
    const wrapper = new (globalThis as any).__TEST_FAILOVER_PROVIDER__('ff_a', primary, chain.slice(1), settings, {
      factory,
      breakerRegistry: (globalThis as any).__TEST_BREAKER_REGISTRY__,
      fallbackEvents: (globalThis as any).__TEST_FALLBACK_EVENTS__,
      metrics: (globalThis as any).__TEST_METRICS_REGISTRY__,
    });

    const chunks: string[] = [];
    const errors: Error[] = [];
    wrapper.setOnChunk(async (chunk: { content: string }) => { chunks.push(chunk.content); });
    wrapper.setOnError(async (error: Error) => { errors.push(error); });

    // No MonitoringContext: the wrapper falls back to operation 'llm.generate'
    // and null project/conversation — exactly what the assertions check.
    await wrapper.generateStream([{ role: 'system', content: 'test' }, { role: 'user', content: 'hi' }]);

    expect(chunks.join('')).to.equal('Hello from fallback B');
    expect(errors).to.be.empty;
    expect(requestsA).to.equal(1);
    expect(requestsB).to.equal(1);

    // Flush the app-world call logger's buffered rows.
    await (globalThis as any).__TEST_CALL_LOGGER__.flushNow();

    const logA = await db.select().from(providerCallLogs).where(eq(providerCallLogs.providerId, 'ff_a'));
    expect(logA).to.have.length(1);
    expect(logA[0].ok).to.equal(false);
    expect(logA[0].errorCode).to.equal('auth');
    expect(logA[0].fallbackProviderId).to.equal(null);
    expect(logA[0].statusHttp).to.equal(401);

    const logB = await db.select().from(providerCallLogs).where(eq(providerCallLogs.providerId, 'ff_b'));
    expect(logB).to.have.length(1);
    expect(logB[0].ok).to.equal(true);
    expect(logB[0].fallbackProviderId).to.equal('ff_a');

    const events = await db.select().from(fallbackEvents).where(eq(fallbackEvents.providerId, 'ff_a'));
    expect(events).to.have.length(1);
    expect(events[0].fallbackProviderId).to.equal('ff_b');
    expect(events[0].providerType).to.equal('llm');
    expect(events[0].operation).to.equal('llm.generate');
    expect(events[0].reason).to.equal('auth');
    expect(events[0].success).to.equal(true);
  });

  it('a healthy primary makes no fallback attempt and no event row', async function () {
    this.timeout(30000);
    const aRes = await createOpenAiProvider('ff_ok', 'Failover healthy', `http://127.0.0.1:${portB}`);
    expect(aRes.status).to.equal(201);

    const factory = (globalThis as any).__TEST_LLM_FACTORY__;
    const settings = { model: 'gpt-4o-mini' };
    const primary = await factory.createProvider(aRes.body, settings);
    // Chain has no fallbacks — the runner would not wrap at all; assert the
    // resolver agrees and the plain provider works.
    const chain = await (globalThis as any).__TEST_FALLBACK_RESOLVER__.resolveChain('ff_ok');
    expect(chain.map((s: any) => s.provider.id)).to.deep.equal(['ff_ok']);

    const chunks: string[] = [];
    primary.setOnChunk(async (chunk: { content: string }) => { chunks.push(chunk.content); });
    await primary.generateStream([{ role: 'system', content: 'test' }, { role: 'user', content: 'hi' }]);
    expect(chunks.join('')).to.equal('Hello from fallback B');
    expect(requestsB).to.equal(1);

    await (globalThis as any).__TEST_CALL_LOGGER__.flushNow();
    const logs = await db.select().from(providerCallLogs).where(eq(providerCallLogs.providerId, 'ff_ok'));
    expect(logs).to.have.length(1);
    expect(logs[0].ok).to.equal(true);
    const events = await db.select().from(fallbackEvents);
    expect(events).to.be.empty;
  });
});
