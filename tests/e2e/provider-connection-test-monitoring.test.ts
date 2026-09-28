import 'reflect-metadata';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { authed, resetDatabase } from '../utils';
import { db } from '../../src/db/index';
import { alertEvents, providerCallLogs } from '../../src/db/schema';
import { CallLogger } from '../../src/services/monitoring/CallLogger';
import type { CircuitBreakerRegistry } from '../../src/services/monitoring/CircuitBreakerRegistry';
import type { MonitoringConfig } from '../../src/http/contracts/monitoring';
import type { MonitoringConfigService } from '../../src/services/monitoring/MonitoringConfigService';
import type { AlertRuleEngine } from '../../src/services/monitoring/AlertRuleEngine';

/**
 * TPC-07 e2e — the connection test is first-class in the shipped monitoring
 * pipeline: saved tests produce ordinary `provider_call_logs` rows (which the
 * `provider-auth-failed` last-signal branch reads), never feed the breaker, and
 * draft tests leave zero rows. Reuses the app-world seams from
 * `tests/e2e/alert-rule-engine.test.ts` (`__TEST_CALL_LOGGER__`,
 * `__TEST_BREAKER_REGISTRY__`, `__TEST_ALERT_ENGINE__`,
 * `__TEST_MONITORING_CONFIG__`).
 *
 * No alert code changes — the interplay is reproduced end-to-end by driving
 * the real `POST /api/providers/test-connection` endpoint and asserting on the
 * alert engine's resulting state.
 */

const app = () => (globalThis as any).__TEST_APP__;

function engine(): AlertRuleEngine {
  const svc = (globalThis as any).__TEST_ALERT_ENGINE__ as AlertRuleEngine | undefined;
  expect(svc).to.not.equal(undefined, '__TEST_ALERT_ENGINE__ is not set — tests/setup.ts must expose the app-world alert engine');
  return svc;
}

function configService(): MonitoringConfigService {
  const svc = (globalThis as any).__TEST_MONITORING_CONFIG__ as MonitoringConfigService | undefined;
  expect(svc).to.not.equal(undefined, '__TEST_MONITORING_CONFIG__ is not set');
  return svc;
}

function breakerRegistry(): CircuitBreakerRegistry {
  const svc = (globalThis as any).__TEST_BREAKER_REGISTRY__ as CircuitBreakerRegistry | undefined;
  expect(svc).to.not.equal(undefined, '__TEST_BREAKER_REGISTRY__ is not set');
  return svc;
}

function appCallLogger(): CallLogger {
  const svc = (globalThis as any).__TEST_CALL_LOGGER__ as CallLogger | undefined;
  expect(svc).to.not.equal(undefined, '__TEST_CALL_LOGGER__ is not set');
  return svc;
}

/** Override the engine's config provider (test seam — never persists). */
async function useConfig(eng: AlertRuleEngine, ruleId: string, override: Record<string, unknown>): Promise<void> {
  const base: MonitoringConfig = await configService().get();
  eng.setConfigProviderForTests(async () => ({ ...base, rules: { ...base.rules, [ruleId]: override } }));
}

/** The engine invokes the publisher fire-and-forget — poll until the expected state appears. */
async function waitForAlerts(ruleId: string, scopeKey: string | undefined, expectStatus: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = scopeKey
      ? await db.select().from(alertEvents).where(and(eq(alertEvents.ruleId, ruleId), eq(alertEvents.scopeKey, scopeKey)))
      : await db.select().from(alertEvents).where(eq(alertEvents.ruleId, ruleId));
    if (rows.length > 0 && rows.every((r) => r.status === expectStatus)) return rows;
    if (Date.now() > deadline) return rows;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function createSavedProvider(body: { name: string; providerType: string; apiType: string; config: Record<string, unknown> }): Promise<string> {
  const res = await authed().post('/api/providers').send(body);
  expect(res.status).to.equal(201);
  return res.body.id as string;
}

async function freshTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'bonsai-conn-test-mon-'));
}

describe('Provider connection test — monitoring interplay (TPC-07)', () => {
  // Flush any rows other suites buffered, then truncate — so row-count
  // assertions below are not polluted by the shared in-memory CallLogger buffer.
  beforeEach(async () => {
    await appCallLogger().flushNow();
    await resetDatabase();
  });

  it('saved LLM auth-failure test fires provider-auth-failed via the last-signal branch; a successful test auto-resolves', async () => {
    const eng = engine();
    const callLogger = appCallLogger();

    // Stateful local server: 401 in 'auth' mode, a valid chat completion in 'ok'
    // mode — the ollama provider (OpenAI-compatible /v1) hits /v1/chat/completions.
    let mode: 'auth' | 'ok' = 'auth';
    const server = createServer((req, res) => {
      const url = req.url ?? '';
      if (req.method === 'POST' && (url === '/v1/chat/completions' || url === '/chat/completions')) {
        if (mode === 'auth') {
          res.statusCode = 401;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: { message: 'Invalid API key provided', type: 'invalid_request_error', code: 'invalid_api_key' } }));
          return;
        }
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          id: 'chatcmpl-tpc07', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: 'llama3',
          choices: [{ index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }));
        return;
      }
      res.statusCode = 404;
      res.setHeader('content-type', 'application/json');
      res.end('{}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const providerId = await createSavedProvider({ name: 'Ollama Auth', providerType: 'llm', apiType: 'ollama', config: { baseUrl } });

      // 1. A saved test that fails with 401 → 200 ok:false errorCode auth; records
      //    an ordinary `llm.test` row attributed to the provider (breaker-excluded).
      const failRes = await authed().post('/api/providers/test-connection').send({ providerId, model: 'llama3' });
      expect(failRes.status).to.equal(200);
      expect(failRes.body.ok).to.equal(false);
      expect(failRes.body.errorCode).to.equal('auth');
      await callLogger.flushNow();
      const testRows = await db.select().from(providerCallLogs).where(eq(providerCallLogs.providerId, providerId));
      expect(testRows.map((r) => r.operation)).to.include('llm.test');

      // 2. Age the row 30 min — outside the 5-min rule window, so the windowed
      //    auth count is 0. Only the last-signal branch can keep the alert met.
      await db.update(providerCallLogs).set({ createdAt: sql`created_at - interval '30 minutes'` }).where(eq(providerCallLogs.providerId, providerId));

      await useConfig(eng, 'provider-auth-failed', { threshold: 1, windowMinutes: 5, forMinutes: 0, resolveAfterGoodChecks: 1, cooldownMinutes: 0 });
      await eng.runNow();
      let rows = await waitForAlerts('provider-auth-failed', `provider-auth-failed:${providerId}`, 'firing');
      expect(rows.length).to.equal(1);
      expect(rows[0].message).to.contain('last observed signal');
      expect(rows[0].context.lastSignalErrorCode).to.equal('auth');

      // 3. A successful test → a newer ok row becomes the last signal → auto-resolve.
      mode = 'ok';
      await new Promise((resolve) => setTimeout(resolve, 5200)); // clear the 5 s per-provider cooldown
      const okRes = await authed().post('/api/providers/test-connection').send({ providerId, model: 'llama3' });
      expect(okRes.status).to.equal(200);
      expect(okRes.body.ok).to.equal(true);
      await callLogger.flushNow();
      await eng.runNow();

      rows = await waitForAlerts('provider-auth-failed', `provider-auth-failed:${providerId}`, 'resolved');
      expect(rows.length).to.equal(1);
      expect(rows[0].status).to.equal('resolved');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('5 failed *.test rows never open the breaker (control: non-test failures do)', async () => {
    const callLogger = appCallLogger();
    const registry = breakerRegistry();
    const testProvider = 'prov_tpc07_test_breaker';
    const controlProvider = 'prov_tpc07_control_breaker';
    // 5 failed *.test rows — the CallLogger's inConnectionTest guard must skip the
    // breaker, so the provider never opens.
    for (let i = 0; i < 5; i++) {
      callLogger.record({ providerId: testProvider, providerType: 'llm', apiType: 'openai', operation: 'llm.test', ok: false, errorCode: 'auth', statusHttp: 401, durationMs: 50, errorText: 'HTTP 401' });
    }
    // Control: 5 failed NON-test rows on a different provider — the breaker opens.
    for (let i = 0; i < 5; i++) {
      callLogger.record({ providerId: controlProvider, providerType: 'llm', apiType: 'openai', operation: 'llm.generate', ok: false, errorCode: 'server_error', statusHttp: 500, durationMs: 50, errorText: 'HTTP 500' });
    }
    await callLogger.flushNow();
    expect(registry.getState(testProvider), '5 failed *.test rows must NOT open the breaker').to.not.equal('open');
    expect(registry.getState(controlProvider), 'control: 5 non-test failures DO open the breaker').to.equal('open');
  });

  it('draft test → zero rows in provider_call_logs (un-stamped instances record nothing)', async () => {
    const callLogger = appCallLogger();
    const basePath = await freshTempDir();
    try {
      const res = await authed().post('/api/providers/test-connection').send({ providerType: 'storage', apiType: 'local', config: { basePath } });
      expect(res.status).to.equal(200);
      expect(res.body.ok).to.equal(true);
      await callLogger.flushNow();
      const rows = await db.select().from(providerCallLogs);
      expect(rows, 'a draft test must leave zero provider_call_logs rows').to.have.length(0);
    } finally {
      await rm(basePath, { recursive: true, force: true });
    }
  });
});
