import 'reflect-metadata';
import { describe, it, before, beforeEach, after } from 'mocha';
import { expect } from 'chai';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { authed, unauthed, resetDatabase } from '../utils';
import { db } from '../../src/db/index';
import { alertEvents, auditLogs, monitoringConfig } from '../../src/db/schema';
import { monitoringConfigSchema, type MonitoringConfig } from '../../src/http/contracts/monitoring';
import type { AlertRuleEngine } from '../../src/services/monitoring/AlertRuleEngine';

/**
 * P2-03 e2e — alerts history/acknowledge + monitoring config API against the
 * LIVE app (real DB, real engine at 1 s, real NotifyingPublisher).
 *
 * Order matters: fixture-based alerts tests run first; the config-mutating
 * tests run last because `monitoring_config` is intentionally NOT truncated by
 * resetDatabase (it persists across resets — like operators), so a saved
 * `high-memory` override would otherwise let the 1 s engine interval fire in
 * the background and pollute row-count assertions. `after()` settles the
 * high-memory key and restores the clean default config.
 *
 * Engine state (in-memory) also survives resetDatabase — `settleHighMemory()`
 * drives the key to resolved with a no-op threshold before each hot-pickup test.
 */

const TEST_OPERATOR_ID = 'test@example.com';

function engine(): AlertRuleEngine {
  const eng = (globalThis as any).__TEST_ALERT_ENGINE__ as AlertRuleEngine | undefined;
  expect(eng).to.not.equal(undefined, '__TEST_ALERT_ENGINE__ is not set — tests/setup.ts must expose the app-world alert engine');
  return eng;
}

async function getConfigViaApi(agent: ReturnType<typeof authed>) {
  const res = await agent.get('/api/monitoring/config');
  expect(res.status).to.equal(200);
  return res.body as { config: MonitoringConfig; version: number; updatedAt: string | null };
}

async function putConfigViaApi(agent: ReturnType<typeof authed>, version: number, config: MonitoringConfig) {
  return agent.put('/api/monitoring/config').send({ version, config });
}

/**
 * Drive the high-memory key to resolved regardless of its current in-memory
 * state (firing/pending/ok) so hot-pickup tests start from a known baseline.
 * A 1e15-byte threshold can never be met by real RSS.
 */
async function settleHighMemory(agent: ReturnType<typeof authed>): Promise<void> {
  const current = await getConfigViaApi(agent);
  const config: MonitoringConfig = {
    ...current.config,
    rules: {
      'high-memory': { threshold: 1e15, forMinutes: 0, cooldownMinutes: 0, resolveAfterGoodChecks: 1 },
    },
  };
  const res = await putConfigViaApi(agent, current.version, config);
  expect(res.status).to.equal(200);
  await engine().runNow();
}

/** Poll an async predicate until it returns a value. */
async function waitFor<T>(what: string, fn: () => Promise<T | undefined>, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// ─── Webhook receiver ─────────────────────────────────────────────────────────

type Received = { method: string; body: unknown };

function startReceiver(): Promise<{ url: string; received: Received[]; close: () => Promise<void> }> {
  const received: Received[] = [];
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      received.push({ method: req.method ?? '', body: data ? JSON.parse(data) : null });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}/hook`, received, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

async function insertAlertRow(overrides: Record<string, unknown>): Promise<void> {
  const now = Date.now();
  await db.insert(alertEvents).values({
    id: 'alrt_fx',
    ruleId: 'rule_a',
    scopeKey: 'rule_a:global',
    scope: {},
    severity: 'warning',
    status: 'firing',
    message: 'fixture alert',
    context: {},
    notifications: [],
    firedAt: new Date(now),
    ...overrides,
  });
}

describe('Alerts + monitoring config API (P2-03, e2e)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  after(async () => {
    // Restore a clean default config + resolved engine state so later suites
    // (e.g. P1-06's first-boot assertion on notifiers []) see pristine state.
    const agent = authed();
    await settleHighMemory(agent).catch(() => undefined);
    const current = await getConfigViaApi(agent);
    const res = await putConfigViaApi(agent, current.version, monitoringConfigSchema.parse({}));
    expect(res.status).to.equal(200);
  });

  // ─── GET /api/monitoring/alerts ─────────────────────────────────────────────

  describe('GET /api/monitoring/alerts', () => {
    beforeEach(async () => {
      const base = Date.now();
      await insertAlertRow({
        id: 'alrt_fx1',
        firedAt: new Date(base - 3 * 60_000),
        notifications: [
          { notifierId: 'notf_fx', phase: 'fired', ok: true, at: new Date(base - 3 * 60_000 + 1000).toISOString() },
        ],
      });
      await insertAlertRow({
        id: 'alrt_fx2',
        status: 'resolved',
        resolvedAt: new Date(base - 90_000),
        firedAt: new Date(base - 2 * 60_000),
      });
      await insertAlertRow({
        id: 'alrt_fx3',
        firedAt: new Date(base - 60_000),
      });
    });

    it('returns firing + resolved events, newest fired_at first, with the notifications trail', async () => {
      const res = await authed().get('/api/monitoring/alerts');
      expect(res.status).to.equal(200);
      expect(res.body.total).to.equal(3);
      expect(res.body.items.map((i: any) => i.id)).to.deep.equal(['alrt_fx3', 'alrt_fx2', 'alrt_fx1']);
      expect(res.body.items[2].notifications).to.have.length(1);
      expect(res.body.items[2].notifications[0]).to.include({ notifierId: 'notf_fx', phase: 'fired', ok: true });
      expect(res.body.items[1].status).to.equal('resolved');
      expect(res.body.items[1].resolvedAt).to.not.equal(null);
      expect(res.body.items[0].ackedAt).to.equal(null);
    });

    it('filters by status, severity, ruleId and scopeKey', async () => {
      const agent = authed();

      let res = await agent.get('/api/monitoring/alerts').query({ 'filters[status]': 'firing' });
      expect(res.status).to.equal(200);
      expect(res.body.total).to.equal(2);

      res = await agent.get('/api/monitoring/alerts').query({ 'filters[status]': 'resolved' });
      expect(res.body.total).to.equal(1);
      expect(res.body.items[0].id).to.equal('alrt_fx2');

      res = await agent.get('/api/monitoring/alerts').query({ 'filters[severity]': 'warning' });
      expect(res.body.total).to.equal(3);

      res = await agent.get('/api/monitoring/alerts').query({ 'filters[ruleId]': 'rule_a' });
      expect(res.body.total).to.equal(3);

      res = await agent.get('/api/monitoring/alerts').query({ 'filters[scopeKey]': 'rule_a:global' });
      expect(res.body.total).to.equal(3);
    });

    it('paginates with offset/limit', async () => {
      const res = await authed().get('/api/monitoring/alerts').query({ limit: 2, offset: 1 });
      expect(res.status).to.equal(200);
      expect(res.body.total).to.equal(3);
      expect(res.body.items).to.have.length(2);
      expect(res.body.items.map((i: any) => i.id)).to.deep.equal(['alrt_fx2', 'alrt_fx1']);
      expect(res.body.offset).to.equal(1);
      expect(res.body.limit).to.equal(2);
    });

    it('supports textSearch over message', async () => {
      const res = await authed().get('/api/monitoring/alerts').query({ textSearch: 'fixture' });
      expect(res.status).to.equal(200);
      expect(res.body.total).to.equal(3);
      const none = await authed().get('/api/monitoring/alerts').query({ textSearch: 'zzz-no-match' });
      expect(none.body.total).to.equal(0);
    });
  });

  // ─── GET /api/monitoring/alerts/{id} ────────────────────────────────────────

  describe('GET /api/monitoring/alerts/{id}', () => {
    it('returns a single event', async () => {
      await insertAlertRow({ id: 'alrt_single', message: 'single fixture' });
      const res = await authed().get('/api/monitoring/alerts/alrt_single');
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal('alrt_single');
      expect(res.body.ruleId).to.equal('rule_a');
      expect(res.body.notifications).to.deep.equal([]);
    });

    it('404s for an unknown id', async () => {
      const res = await authed().get('/api/monitoring/alerts/alrt_missing');
      expect(res.status).to.equal(404);
    });
  });

  // ─── POST /api/monitoring/alerts/{id}/acknowledge ───────────────────────────

  describe('POST /api/monitoring/alerts/{id}/acknowledge', () => {
    it('stamps acked_at/acked_by exactly once, writes one audit entry, and is idempotent', async () => {
      await insertAlertRow({ id: 'alrt_ack' });
      const agent = authed();

      const first = await agent.post('/api/monitoring/alerts/alrt_ack/acknowledge');
      expect(first.status).to.equal(200);
      expect(first.body.ackedAt).to.not.equal(null);
      expect(first.body.ackedBy).to.equal(TEST_OPERATOR_ID);

      let audits = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'ACK'));
      expect(audits).to.have.length(1);
      expect(audits[0].entityId).to.equal('alrt_ack');
      expect(audits[0].entityType).to.equal('alert_event');
      expect(audits[0].userId).to.equal(TEST_OPERATOR_ID);

      const second = await agent.post('/api/monitoring/alerts/alrt_ack/acknowledge');
      expect(second.status).to.equal(200);
      // No overwrite — identical stamps.
      expect(second.body.ackedAt).to.equal(first.body.ackedAt);
      expect(second.body.ackedBy).to.equal(TEST_OPERATOR_ID);

      audits = await db.select().from(auditLogs).where(eq(auditLogs.action, 'ACK'));
      expect(audits).to.have.length(1);
    });

    it('404s for an unknown id', async () => {
      const res = await authed().post('/api/monitoring/alerts/alrt_missing/acknowledge');
      expect(res.status).to.equal(404);
      const audits = await db.select().from(auditLogs).where(eq(auditLogs.action, 'ACK'));
      expect(audits).to.have.length(0);
    });
  });

  describe('DELETE /api/monitoring/alerts/{id}', () => {
    it('deletes the row, returns the deleted event, and writes one audit entry', async () => {
      await insertAlertRow({ id: 'alrt_del' });
      const agent = authed();

      const res = await agent.delete('/api/monitoring/alerts/alrt_del');
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal('alrt_del');

      const rows = await db.select().from(alertEvents).where(eq(alertEvents.id, 'alrt_del'));
      expect(rows).to.have.length(0);

      const audits = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'DELETE'), eq(auditLogs.entityType, 'alert_event')));
      expect(audits).to.have.length(1);
      expect(audits[0].entityId).to.equal('alrt_del');
      expect(audits[0].userId).to.equal(TEST_OPERATOR_ID);

      // A second delete is a 404 and writes no further audit entry.
      const second = await agent.delete('/api/monitoring/alerts/alrt_del');
      expect(second.status).to.equal(404);
      const auditsAfter = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'DELETE'), eq(auditLogs.entityType, 'alert_event')));
      expect(auditsAfter).to.have.length(1);
    });

    it('404s for an unknown id (no audit entry)', async () => {
      const res = await authed().delete('/api/monitoring/alerts/alrt_missing');
      expect(res.status).to.equal(404);
      const audits = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'DELETE'), eq(auditLogs.entityType, 'alert_event')));
      expect(audits).to.have.length(0);
    });
  });

  // ─── GET + PUT /api/monitoring/config ───────────────────────────────────────

  describe('GET /api/monitoring/config', () => {
    it('returns the validated config + optimistic-lock version', async () => {
      const res = await authed().get('/api/monitoring/config');
      expect(res.status).to.equal(200);
      expect(res.body.version).to.be.a('number').and.gte(1);
      expect(res.body.config).to.have.property('notifiers').that.is.an('array');
      expect(res.body.config).to.have.property('rules').that.is.an('object');
      expect(res.body.config.retentionDays).to.be.gte(7);
      expect(res.body.updatedAt).to.not.equal(null);
    });
  });

  describe('GET /api/monitoring/rules', () => {
    const EXPECTED_RULE_IDS = [
      'api-429-spike',
      'api-5xx-spike',
      'asr-final-latency',
      'auth-429-spike',
      'db-down',
      'db-pool-saturated',
      'event-loop-lag',
      'fallback-active',
      'high-memory',
      'imap-poll-failing',
      'oauth-refresh-failing',
      'provider-auth-failed',
      'provider-chain-exhausted',
      'provider-degraded',
      'provider-down',
      'provider-rate-limited',
      'service-stalled',
      'stream-abort-rate',
      'stream-slow-ttft',
      'stream-stalls',
      'tts-rtf-degraded',
    ];

    it('returns the full static catalog (21 rules, exact id set)', async () => {
      const res = await authed().get('/api/monitoring/rules');
      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('rules').that.is.an('array');
      const ids = res.body.rules.map((rule: { id: string }) => rule.id).sort();
      // Exact-set pin: adding/removing a built-in rule must update this test on purpose.
      expect(ids).to.deep.equal(EXPECTED_RULE_IDS);
    });

    it('serves id, scope, severity, summary, and the 7 default params per rule', async () => {
      const res = await authed().get('/api/monitoring/rules');
      expect(res.status).to.equal(200);
      for (const rule of res.body.rules) {
        expect(rule.id).to.be.a('string').and.not.empty;
        expect(rule.scope).to.be.oneOf(['global', 'per_provider']);
        expect(rule.severity).to.be.oneOf(['info', 'warning', 'critical']);
        expect(rule.summary).to.be.a('string').and.not.empty;
        for (const field of ['threshold', 'windowMinutes', 'minSamples', 'forMinutes', 'resolveAfterGoodChecks', 'cooldownMinutes', 'maxUnresolvedHours']) {
          expect(rule.defaultParams[field], `defaultParams.${field} of ${rule.id}`).to.be.a('number');
        }
      }
      // No evaluate closures or engine internals leak through.
      for (const rule of res.body.rules) {
        expect(Object.keys(rule)).to.deep.equal(['id', 'scope', 'severity', 'summary', 'defaultParams']);
      }
    });

    it('matches the engine defaults for sampled rules', async () => {
      const res = await authed().get('/api/monitoring/rules');
      expect(res.status).to.equal(200);
      const byId = new Map(res.body.rules.map((rule: { id: string }) => [rule.id, rule]));

      const providerDown = byId.get('provider-down');
      expect(providerDown.scope).to.equal('per_provider');
      expect(providerDown.severity).to.equal('critical');
      expect(providerDown.defaultParams).to.include({ threshold: 3, windowMinutes: 10, minSamples: 5, forMinutes: 2 });

      const highMemory = byId.get('high-memory');
      expect(highMemory.scope).to.equal('global');
      // 1536 MB in bytes (mirrors the health-check default).
      expect(highMemory.defaultParams.threshold).to.equal(1536 * 1024 * 1024);

      const fallbackActive = byId.get('fallback-active');
      expect(fallbackActive.severity).to.equal('info');
      expect(fallbackActive.scope).to.equal('per_provider');

      const scopeCounts = res.body.rules.reduce(
        (acc: Record<string, number>, rule: { scope: string }) => ({ ...acc, [rule.scope]: (acc[rule.scope] ?? 0) + 1 }),
        {},
      );
      expect(scopeCounts).to.deep.equal({ global: 8, per_provider: 13 }); // P3-06: +provider-chain-exhausted
    });
  });

  describe('PUT /api/monitoring/config', () => {
    it('round-trips: validates, bumps version, persists, sanitizes the audit payload', async () => {
      const agent = authed();
      const before = await getConfigViaApi(agent);
      const urlWithToken = 'https://hooks.example.com/services/T0KEN/SECRET123';

      const res = await putConfigViaApi(agent, before.version, {
        ...before.config,
        retentionDays: 30,
        notifiers: [{ id: 'notf_tok', type: 'webhook', url: urlWithToken, enabled: true }],
        rules: { 'high-memory': { threshold: 2048 } },
      });
      expect(res.status).to.equal(200);
      expect(res.body.version).to.equal(before.version + 1);
      expect(res.body.config.retentionDays).to.equal(30);
      expect(res.body.config.notifiers).to.have.length(1);

      // Persisted + version bumped in the row.
      const rows = await db.select().from(monitoringConfig).where(eq(monitoringConfig.id, 'global'));
      expect(rows[0].version).to.equal(before.version + 1);

      // The audit entry carries before/after summaries WITHOUT the tokenized URL.
      const audits = await db.select().from(auditLogs).where(eq(auditLogs.action, 'UPDATE_MONITORING_CONFIG'));
      expect(audits).to.have.length(1);
      expect(audits[0].entityType).to.equal('monitoring_config');
      expect(audits[0].userId).to.equal(TEST_OPERATOR_ID);
      const newEntityJson = JSON.stringify(audits[0].newEntity);
      expect(newEntityJson).to.not.include('SECRET123');
      expect(newEntityJson).to.not.include('hooks.example.com');
      expect(newEntityJson).to.include('hasUrl');
      expect(newEntityJson).to.include('"retentionDays":30');
      const oldEntityJson = JSON.stringify(audits[0].oldEntity);
      expect(oldEntityJson).to.include(`"version":${before.version}`);
    });

    it('returns 409 on a stale version', async () => {
      const agent = authed();
      const before = await getConfigViaApi(agent);
      const first = await putConfigViaApi(agent, before.version, { ...before.config, retentionDays: 60 });
      expect(first.status).to.equal(200);
      expect(first.body.version).to.equal(before.version + 1);

      const stale = await putConfigViaApi(agent, before.version, { ...before.config, retentionDays: 45 });
      expect(stale.status).to.equal(409);

      // The row still reflects the first (valid) write.
      const rows = await db.select().from(monitoringConfig).where(eq(monitoringConfig.id, 'global'));
      expect(rows[0].version).to.equal(before.version + 1);
    });

    it('returns 400 for invalid configs (unknown rule id, retention < 7, webhook without url)', async () => {
      const agent = authed();
      const base = await getConfigViaApi(agent);

      const badRule = await putConfigViaApi(agent, base.version, {
        ...base.config,
        rules: { 'not-a-rule': { threshold: 1 } },
      });
      expect(badRule.status).to.equal(400);

      const badRetention = await putConfigViaApi(agent, base.version, {
        ...base.config,
        retentionDays: 6,
      });
      expect(badRetention.status).to.equal(400);

      const badNotifier = await putConfigViaApi(agent, base.version, {
        ...base.config,
        notifiers: [{ id: 'notf_bad', type: 'webhook', url: 'not-a-url', enabled: true }],
      });
      expect(badNotifier.status).to.equal(400);

      // Failed writes leave the row untouched.
      const rows = await db.select().from(monitoringConfig).where(eq(monitoringConfig.id, 'global'));
      expect(rows[0].version).to.equal(base.version);
    });
  });

  describe('probeSettings asrProbe/ttsProbe (P1-05b)', () => {
    it('GET: defaults are asrProbe free, ttsProbe free', async () => {
      const { config } = await getConfigViaApi(authed());
      expect(config.probeSettings).to.include({ llmProbe: 'models', asrProbe: 'free', ttsProbe: 'free' });
      expect(config.probeSettings.cooldownMinutes).to.be.a('number').that.is.gte(0);
    });

    it('PUT: asrProbe/ttsProbe overrides round-trip and bump the version', async () => {
      const agent = authed();
      const before = await getConfigViaApi(agent);

      const res = await putConfigViaApi(agent, before.version, {
        ...before.config,
        probeSettings: { ...before.config.probeSettings, asrProbe: 'off', ttsProbe: 'off' },
      });
      expect(res.status).to.equal(200);
      expect(res.body.version).to.equal(before.version + 1);

      const after = await getConfigViaApi(agent);
      expect(after.config.probeSettings).to.include({ asrProbe: 'off', ttsProbe: 'off' });

      // Restore defaults for the remaining tests (the row persists across resets).
      const restored = await putConfigViaApi(agent, after.version, {
        ...after.config,
        probeSettings: { ...after.config.probeSettings, asrProbe: 'free', ttsProbe: 'free' },
      });
      expect(restored.status).to.equal(200);
    });

    it('PUT: rejects invalid asrProbe/ttsProbe enums (400, row untouched)', async () => {
      const agent = authed();
      const base = await getConfigViaApi(agent);

      const badAsr = await putConfigViaApi(agent, base.version, {
        ...base.config,
        probeSettings: { ...base.config.probeSettings, asrProbe: 'one_token' },
      });
      expect(badAsr.status).to.equal(400);

      const badTts = await putConfigViaApi(agent, base.version, {
        ...base.config,
        probeSettings: { ...base.config.probeSettings, ttsProbe: 'models' },
      });
      expect(badTts.status).to.equal(400);

      const rows = await db.select().from(monitoringConfig).where(eq(monitoringConfig.id, 'global'));
      expect(rows[0].version).to.equal(base.version);
    });
  });

  // ─── RBAC ───────────────────────────────────────────────────────────────────

  describe('RBAC', () => {
    let viewerAgent: ReturnType<typeof authed>;

    before(async () => {
      // Operators survive resetDatabase — create once, reuse every run.
      const operatorId = 'viewer-monitoring-p203@example.com';
      const created = await authed()
        .post('/api/operators')
        .send({ id: operatorId, name: 'Viewer P203', roles: ['viewer'], password: 'viewerpass123' });
      expect([201, 409]).to.include(created.status);
      const login = await unauthed().post('/api/auth/login').send({ id: operatorId, password: 'viewerpass123' });
      expect(login.status).to.equal(200);
      const app = (globalThis as any).__TEST_APP__;
      viewerAgent = request.agent(app);
      viewerAgent.set('Authorization', `Bearer ${login.body.accessToken}`);
    });

    it('rejects the viewer role with 403 on all six routes', async () => {
      const resList = await viewerAgent.get('/api/monitoring/alerts');
      expect(resList.status).to.equal(403);
      const resGet = await viewerAgent.get('/api/monitoring/alerts/alrt_x');
      expect(resGet.status).to.equal(403);
      const resAck = await viewerAgent.post('/api/monitoring/alerts/alrt_x/acknowledge');
      expect(resAck.status).to.equal(403);
      const resDelete = await viewerAgent.delete('/api/monitoring/alerts/alrt_x');
      expect(resDelete.status).to.equal(403);
      const resConfigGet = await viewerAgent.get('/api/monitoring/config');
      expect(resConfigGet.status).to.equal(403);
      const resConfigPut = await viewerAgent.put('/api/monitoring/config').send({ version: 1, config: monitoringConfigSchema.parse({}) });
      expect(resConfigPut.status).to.equal(403);
    });
  });

  // ─── Hot pickup (config changes observed without restart) ───────────────────

  describe('hot pickup (no restart)', () => {
    it('a PUT changes the webhook delivery target and rule thresholds live', async () => {
      const agent = authed();
      await settleHighMemory(agent);
      const receiverA = await startReceiver();
      const receiverB = await startReceiver();
      try {
        // v1: deliver to A, fire high-memory at a 1-byte threshold.
        const v1 = await getConfigViaApi(agent);
        const res1 = await putConfigViaApi(agent, v1.version, {
          ...v1.config,
          notifiers: [{ id: 'notf_live', type: 'webhook', url: receiverA.url, enabled: true }],
          rules: { 'high-memory': { threshold: 1, forMinutes: 0, cooldownMinutes: 0, resolveAfterGoodChecks: 1 } },
        });
        expect(res1.status).to.equal(200);
        await engine().runNow();
        await waitFor('receiver A fired payload', async () =>
          receiverA.received.find((r) => (r.body as any)?.ruleId === 'high-memory' && (r.body as any)?.event === 'alert_fired'),
        );
        expect(receiverA.received).to.have.length(1);

        // v2: point the SAME notifier at B + unmeetable threshold → the resolve
        // delivery must land on B (the new URL is live without a restart).
        const v2 = await getConfigViaApi(agent);
        const res2 = await putConfigViaApi(agent, v2.version, {
          ...v2.config,
          notifiers: [{ id: 'notf_live', type: 'webhook', url: receiverB.url, enabled: true }],
          rules: { 'high-memory': { threshold: 1e10, forMinutes: 0, cooldownMinutes: 0, resolveAfterGoodChecks: 1 } },
        });
        expect(res2.status).to.equal(200);
        await engine().runNow();
        await waitFor('receiver B resolved payload', async () =>
          receiverB.received.find((r) => (r.body as any)?.ruleId === 'high-memory' && (r.body as any)?.event === 'alert_resolved'),
        );

        // v3: back to a 1-byte threshold → the re-fire must also land on B.
        const v3 = await getConfigViaApi(agent);
        const res3 = await putConfigViaApi(agent, v3.version, {
          ...v3.config,
          rules: { 'high-memory': { threshold: 1, forMinutes: 0, cooldownMinutes: 0, resolveAfterGoodChecks: 1 } },
        });
        expect(res3.status).to.equal(200);
        await engine().runNow();
        await waitFor('receiver B fired payload', async () =>
          receiverB.received.find((r) => (r.body as any)?.ruleId === 'high-memory' && (r.body as any)?.event === 'alert_fired'),
        );

        expect(receiverA.received).to.have.length(1);
        expect(receiverB.received).to.have.length(2);
        const events = receiverB.received.map((r) => (r.body as any).event);
        expect(events).to.deep.equal(['alert_resolved', 'alert_fired']);

        // Two firing rows total for this test (the settle fire from a previous
        // test, if any, was truncated by resetDatabase).
        await waitFor('two high-memory alert rows', async () => {
          const rows = await db.select().from(alertEvents).where(eq(alertEvents.ruleId, 'high-memory'));
          return rows.length === 2 ? rows : undefined;
        });
      } finally {
        await receiverA.close();
        await receiverB.close();
      }
    });

    it('disabling a rule stops new fires; re-enabling fires again', async () => {
      const agent = authed();
      await settleHighMemory(agent);

      // Disabled + would-fire threshold → no fire.
      const v1 = await getConfigViaApi(agent);
      const res1 = await putConfigViaApi(agent, v1.version, {
        ...v1.config,
        rules: { 'high-memory': { enabled: false, threshold: 1, forMinutes: 0, cooldownMinutes: 0 } },
      });
      expect(res1.status).to.equal(200);
      await engine().runNow();
      let rows = await db.select().from(alertEvents).where(eq(alertEvents.ruleId, 'high-memory'));
      expect(rows).to.have.length(0);

      // Re-enabled → fires.
      const v2 = await getConfigViaApi(agent);
      const res2 = await putConfigViaApi(agent, v2.version, {
        ...v2.config,
        rules: { 'high-memory': { enabled: true, threshold: 1, forMinutes: 0, cooldownMinutes: 0 } },
      });
      expect(res2.status).to.equal(200);
      // runNow() is a no-op while an interval pass is in flight (isProcessing)
      // — the 1 s interval picks the fire up within a second either way.
      rows = await waitFor('high-memory fire row after re-enable', async () => {
        const r = await db.select().from(alertEvents).where(eq(alertEvents.ruleId, 'high-memory'));
        return r.length === 1 ? r : undefined;
      });
      expect(rows).to.have.length(1);
      expect(rows[0].status).to.equal('firing');
    });
  });
});
