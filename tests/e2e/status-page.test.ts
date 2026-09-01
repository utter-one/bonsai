import 'reflect-metadata';
import { describe, it, before, beforeEach } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import { authed, unauthed, resetDatabase } from '../utils';
import { db } from '../../src/db/index';
import { healthChecks, providers } from '../../src/db/schema';
import { worstNonUnknownStatus } from '../../src/services/monitoring/StatusPageService';

/**
 * Status page v1 e2e (specs/SPEC-status-page-v1.md §7).
 *
 * Live-loop hazard: in the test env HealthCheckService ticks every 1 s and writes real
 * db / process / service_heartbeat:* / provider:<id> rows (probes off → provider rows
 * are `unknown` inference rows). Deterministic assertions therefore use fixture check
 * names the live service never writes; assertions that the live loop can interleave
 * use oneOf per the house convention for racy API behavior.
 */

const FIXTURE_HEARTBEAT = 'service_heartbeat:fixture-service';
const FIXTURE_WINDOW_HEARTBEAT = 'service_heartbeat:fixture-window';
const FIXTURE_OLD_HEARTBEAT = 'service_heartbeat:fixture-old';
const FIXTURE_UNKNOWN_HEARTBEAT = 'service_heartbeat:fixture-unknown';

const STATUS_VALUES = ['ok', 'degraded', 'down', 'unknown'] as const;

/** Create a viewer operator and return a token agent (operators survive resetDatabase). */
async function createViewerAgent() {
  const operatorId = 'viewer-status-page@example.com';
  const createRes = await authed()
    .post('/api/operators')
    .send({ id: operatorId, name: 'Viewer Status Page', roles: ['viewer'], password: 'viewerpass123' });
  expect([201, 409]).to.include(createRes.status);

  const loginRes = await unauthed()
    .post('/api/auth/login')
    .send({ id: operatorId, password: 'viewerpass123' });
  expect(loginRes.status).to.equal(200);

  const app = (globalThis as any).__TEST_APP__;
  const agent = request.agent(app);
  agent.set('Authorization', `Bearer ${loginRes.body.accessToken}`);
  return agent;
}

/**
 * GET with retries — after resetDatabase() the health_checks table is empty until the
 * live 1 s loop ticks again, so assertions on live rows must wait for the first row.
 */
async function getWithRetries(
  path: string,
  predicate: (body: any) => boolean,
  attempts = 10,
  delayMs = 500,
): Promise<any> {
  let res = await authed().get(path);
  for (let i = 0; i < attempts && !predicate(res.body); i++) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    res = await authed().get(path);
  }
  return res;
}

/** Seed one health_checks row (createdAt omitted → DB now() default). */
async function seedCheck(
  id: string,
  checkName: string,
  status: string,
  opts: { latencyMs?: number | null; detail?: Record<string, unknown> | null; createdAt?: Date } = {},
): Promise<void> {
  await db.insert(healthChecks).values({
    id,
    checkName,
    status,
    latencyMs: opts.latencyMs ?? null,
    detail: opts.detail ?? null,
    createdAt: opts.createdAt,
  });
}

describe('Status page v1 (specs/SPEC-status-page-v1.md)', () => {
  let viewerAgent: ReturnType<typeof request.agent>;

  before(async () => {
    await resetDatabase();
    viewerAgent = await createViewerAgent();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  describe('RBAC', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await unauthed().get('/api/monitoring/status');
      expect(res.status).to.equal(401);
    });

    it('rejects the viewer role with 403', async () => {
      const res = await viewerAgent.get('/api/monitoring/status');
      expect(res.status).to.equal(403);
    });

    it('allows super_admin with 200', async () => {
      const res = await authed().get('/api/monitoring/status');
      expect(res.status).to.equal(200);
    });
  });

  describe('query validation', () => {
    it('rejects non-numeric, below-min and above-max windowMinutes with 400', async () => {
      for (const value of ['abc', '0', '10000']) {
        const res = await authed().get('/api/monitoring/status').query({ windowMinutes: value });
        expect(res.status, `windowMinutes=${value}`).to.equal(400);
      }
    });

    it('defaults windowMinutes to 60 and echoes the applied value', async () => {
      const res = await authed().get('/api/monitoring/status');
      expect(res.status).to.equal(200);
      expect(res.body.windowMinutes).to.equal(60);

      const custom = await authed().get('/api/monitoring/status').query({ windowMinutes: 90 });
      expect(custom.status).to.equal(200);
      expect(custom.body.windowMinutes).to.equal(90);
    });
  });

  describe('response shape', () => {
    it('returns the page envelope; checks never contain provider:* rows', async () => {
      const res = await authed().get('/api/monitoring/status');
      expect(res.status).to.equal(200);
      expect(res.body.generatedAt).to.be.a('string');
      expect(res.body.overall).to.be.oneOf(STATUS_VALUES);
      expect(res.body.providers).to.be.an('array');
      for (const check of res.body.checks) {
        expect(check.name).to.be.a('string');
        expect(check.label).to.be.a('string');
        expect(check.group).to.be.oneOf(['core', 'service', 'other']);
        expect(check.status).to.be.oneOf(STATUS_VALUES);
        expect(check.name.startsWith('provider:'), 'provider:* rows render via providers[]').to.equal(false);
        expect(check.window.ok + check.window.degraded + check.window.down + check.window.unknown).to.equal(check.window.total);
      }
    });
  });

  describe('current status mapping', () => {
    it('uses the latest row per check (fixture heartbeat the live service never writes)', async () => {
      await seedCheck('stps_1', FIXTURE_HEARTBEAT, 'ok', { latencyMs: 7, createdAt: new Date(Date.now() - 120_000) });
      await seedCheck('stps_2', FIXTURE_HEARTBEAT, 'down', {
        latencyMs: 99,
        detail: { reason: 'fixture-down' },
        createdAt: new Date(Date.now() - 1000),
      });

      const res = await authed().get('/api/monitoring/status');
      expect(res.status).to.equal(200);
      const entry = res.body.checks.find((c: any) => c.name === FIXTURE_HEARTBEAT);
      expect(entry, 'fixture heartbeat present').to.exist;
      expect(entry.status).to.equal('down');
      expect(entry.group).to.equal('service');
      expect(entry.label).to.equal('Fixture Service');
      expect(entry.latencyMs).to.equal(99);
      expect(entry.detail).to.deep.equal({ reason: 'fixture-down' });
      expect(entry.checkedAt).to.be.a('string');
      // Both seeded rows sit inside the default 60-min window — exact counts.
      expect(entry.window).to.include({ total: 2, ok: 1, degraded: 0, down: 1, unknown: 0, worstStatus: 'down' });
    });

    it('labels and groups core checks', async () => {
      // Wait for the live 1 s loop to write its first rows after the reset.
      const res = await getWithRetries(
        '/api/monitoring/status',
        (body) => body.checks.some((c: any) => c.name === 'db'),
      );
      expect(res.status).to.equal(200);
      const byName = new Map(res.body.checks.map((c: any) => [c.name, c]));
      expect(byName.get('db')?.group).to.equal('core');
      expect(byName.get('db')?.label).to.equal('Database');
      expect(byName.get('process')?.group).to.equal('core');
      expect(byName.get('process')?.label).to.equal('Application');
      expect(byName.get('service_heartbeat:scenario-run-executor')?.label).to.equal('Scenario Run Executor');
    });
  });

  describe('window aggregation', () => {
    it('counts in-window rows per status and ignores older rows', async () => {
      const now = Date.now();
      const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000);
      const rows: Array<{ id: string; checkName: string; status: string; createdAt: Date }> = [];
      for (let i = 0; i < 7; i++) rows.push({ id: `stpw_ok_${i}`, checkName: FIXTURE_WINDOW_HEARTBEAT, status: 'ok', createdAt: at(i + 1) });
      for (let i = 0; i < 2; i++) rows.push({ id: `stpw_deg_${i}`, checkName: FIXTURE_WINDOW_HEARTBEAT, status: 'degraded', createdAt: at(i + 1) });
      rows.push({ id: 'stpw_down', checkName: FIXTURE_WINDOW_HEARTBEAT, status: 'down', createdAt: at(1) });
      // Outside the default 60-min window — must not be counted.
      for (let i = 0; i < 5; i++) rows.push({ id: `stpw_old_${i}`, checkName: FIXTURE_WINDOW_HEARTBEAT, status: 'down', createdAt: at(120 + i) });
      await db.insert(healthChecks).values(rows.map((row) => ({ latencyMs: null, detail: null, ...row })));

      const res = await authed().get('/api/monitoring/status');
      expect(res.status).to.equal(200);
      const entry = res.body.checks.find((c: any) => c.name === FIXTURE_WINDOW_HEARTBEAT);
      expect(entry.window).to.include({ total: 10, ok: 7, degraded: 2, down: 1, unknown: 0, worstStatus: 'down' });
    });

    it('reports an all-zero window (worstStatus unknown) when rows predate the window', async () => {
      await seedCheck('stpo_1', FIXTURE_OLD_HEARTBEAT, 'down', { createdAt: new Date(Date.now() - 130 * 60_000) });

      const res = await authed().get('/api/monitoring/status');
      expect(res.status).to.equal(200);
      const entry = res.body.checks.find((c: any) => c.name === FIXTURE_OLD_HEARTBEAT);
      expect(entry.status).to.equal('down'); // current state is independent of the window
      expect(entry.window).to.include({ total: 0, ok: 0, degraded: 0, down: 0, unknown: 0, worstStatus: 'unknown' });
    });
  });

  describe('providers', () => {
    it('lists every configured provider sorted by name (case-insensitive)', async () => {
      await db.insert(providers).values([
        { id: 'stpp_zeta', name: 'Zeta LLM', providerType: 'llm', apiType: 'openai', config: { apiKey: 'sk-test-zeta' } },
        { id: 'stpp_alpha', name: 'alpha tts', providerType: 'tts', apiType: 'elevenlabs', config: { apiKey: 'sk-test-alpha' } },
      ]);

      const res = await authed().get('/api/monitoring/status');
      expect(res.status).to.equal(200);
      expect(res.body.providers.map((p: any) => p.name)).to.deep.equal(['alpha tts', 'Zeta LLM']);
      const [first, second] = res.body.providers;
      expect(first).to.include({ id: 'stpp_alpha', providerType: 'tts', apiType: 'elevenlabs' });
      expect(second).to.include({ id: 'stpp_zeta', providerType: 'llm', apiType: 'openai' });
      for (const provider of res.body.providers) {
        // The live 1 s loop may interleave `unknown` inference rows (probes off in tests).
        expect(provider.status).to.be.oneOf(STATUS_VALUES);
        expect(provider.window.ok + provider.window.degraded + provider.window.down + provider.window.unknown).to.equal(provider.window.total);
      }
    });

    it('renders a never-checked provider as unknown with a zero window', async () => {
      await db.insert(providers).values({
        id: 'stpp_never',
        name: 'Never Probed',
        providerType: 'storage',
        apiType: 'local',
        config: {},
      });

      const res = await authed().get('/api/monitoring/status');
      expect(res.status).to.equal(200);
      const entry = res.body.providers.find((p: any) => p.id === 'stpp_never');
      expect(entry, 'provider present').to.exist;
      // No seeded check rows; the live inference loop (if it ticks first) also writes `unknown`.
      expect(entry.status).to.equal('unknown');
      expect(entry.window).to.include({ worstStatus: 'unknown' });
    });

    it('never renders orphan provider:* check rows', async () => {
      await seedCheck('stpg_ghost', 'provider:ghost_deleted', 'ok', { createdAt: new Date(Date.now() - 1000) });

      const res = await authed().get('/api/monitoring/status');
      expect(res.status).to.equal(200);
      expect(res.body.providers).to.deep.equal([]);
      expect(res.body.checks.some((c: any) => c.name.startsWith('provider:'))).to.equal(false);
    });
  });

  describe('overall', () => {
    it('is down when any check is down (fixture heartbeat; live rows are ok/unknown in the test env)', async () => {
      await seedCheck('stpd_1', FIXTURE_HEARTBEAT, 'down', { createdAt: new Date(Date.now() - 1000) });

      const res = await authed().get('/api/monitoring/status');
      expect(res.status).to.equal(200);
      expect(res.body.overall).to.equal('down');
    });

    it('ignores unknown entries when ok checks are present', async () => {
      await seedCheck('stpk_1', FIXTURE_HEARTBEAT, 'ok', { createdAt: new Date(Date.now() - 1000) });
      await seedCheck('stpk_2', FIXTURE_UNKNOWN_HEARTBEAT, 'unknown', { createdAt: new Date(Date.now() - 1000) });

      const res = await authed().get('/api/monitoring/status');
      expect(res.status).to.equal(200);
      expect(res.body.overall).to.equal('ok');
    });

    it('worstNonUnknownStatus: down > degraded > ok, unknown neutral (all-unknown → unknown)', () => {
      expect(worstNonUnknownStatus([])).to.equal('unknown');
      expect(worstNonUnknownStatus(['unknown', 'unknown'])).to.equal('unknown');
      expect(worstNonUnknownStatus(['ok', 'unknown'])).to.equal('ok');
      expect(worstNonUnknownStatus(['degraded', 'ok', 'unknown'])).to.equal('degraded');
      expect(worstNonUnknownStatus(['down', 'ok', null, undefined])).to.equal('down');
    });
  });

  describe('ordering', () => {
    it('groups core first, then services, sorted by name within groups', async () => {
      await seedCheck('stps_o1', 'service_heartbeat:fixture-zeta', 'ok', { createdAt: new Date(Date.now() - 1000) });
      await seedCheck('stps_o2', 'service_heartbeat:fixture-alpha', 'ok', { createdAt: new Date(Date.now() - 1000) });

      const res = await authed().get('/api/monitoring/status');
      expect(res.status).to.equal(200);
      const rank: Record<string, number> = { core: 0, service: 1, other: 2 };
      const checks = res.body.checks;
      for (let i = 1; i < checks.length; i++) {
        const prev = checks[i - 1];
        const cur = checks[i];
        if (prev.group !== cur.group) {
          expect(rank[cur.group], 'groups ordered core → service → other').to.be.greaterThan(rank[prev.group]);
        } else {
          expect(cur.name.localeCompare(prev.name), 'names sorted within group').to.be.greaterThan(0);
        }
      }
      const names = checks.map((c: any) => c.name);
      expect(names.indexOf('service_heartbeat:fixture-alpha')).to.be.lessThan(names.indexOf('service_heartbeat:fixture-zeta'));
    });
  });

  describe('daily aggregates', () => {
    /**
     * Noon UTC on the day N days before today (app clock == DB clock: testcontainers runs
     * on the same host). Noon is safe against any host timezone offset of ±12 h, so the
     * seeded Date always lands on the intended UTC day.
     */
    function utcNoon(daysBack: number): Date {
      const now = new Date();
      const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      return new Date(midnight - daysBack * 86_400_000 + 12 * 3_600_000);
    }

    it('omits daily when days is not provided', async () => {
      const res = await authed().get('/api/monitoring/status');
      expect(res.status).to.equal(200);
      expect(res.body).to.not.have.property('daily');
    });

    it('rejects out-of-range or invalid days with 400', async () => {
      for (const value of ['0', '91', 'abc']) {
        const res = await authed().get('/api/monitoring/status').query({ days: value });
        expect(res.status, `days=${value}`).to.equal(400);
      }
    });

    it('returns N buckets oldest-first, zero-filled, with the last bucket = today (UTC)', async () => {
      const res = await authed().get('/api/monitoring/status').query({ days: 3 });
      expect(res.status).to.equal(200);
      const daily = res.body.daily;
      expect(daily).to.have.length(3);
      const dates = daily.map((d: any) => d.date);
      expect(dates).to.deep.equal([...dates].sort());
      expect(daily[2].date).to.equal(new Date().toISOString().slice(0, 10));
      // The oldest bucket predates every row the live 1 s loop can have written.
      expect(daily[0]).to.include({ total: 0, ok: 0, degraded: 0, down: 0, unknown: 0, status: 'unknown', uptimePct: null });
    });

    it('aggregates per UTC day: exact counts, worst status, strict uptimePct', async () => {
      const yesterday = utcNoon(1);
      const statuses = ['ok', 'ok', 'ok', 'degraded', 'down'];
      await db.insert(healthChecks).values(
        statuses.map((status, i) => ({
          id: `stdp_y${i}`,
          checkName: FIXTURE_HEARTBEAT,
          status,
          latencyMs: null,
          detail: null,
          createdAt: yesterday,
        })),
      );
      for (let i = 0; i < 4; i++) {
        await seedCheck(`stdp_t${i}`, FIXTURE_HEARTBEAT, 'ok', { createdAt: new Date() });
      }

      const res = await authed().get('/api/monitoring/status').query({ days: 2 });
      expect(res.status).to.equal(200);
      const [oldest, today] = res.body.daily;
      // Only the fixture rows sit on that day (the live loop only writes current rows) — exact.
      expect(oldest).to.include({ total: 5, ok: 3, degraded: 1, down: 1, unknown: 0, status: 'down', uptimePct: 60 });
      // The today bucket also contains live-loop rows — lower bounds only.
      expect(today.total).to.be.at.least(4);
      expect(today.ok).to.be.at.least(4);
    });

    it('returns a single bucket for days=1', async () => {
      const res = await authed().get('/api/monitoring/status').query({ days: 1 });
      expect(res.status).to.equal(200);
      expect(res.body.daily).to.have.length(1);
      expect(res.body.daily[0].date).to.equal(new Date().toISOString().slice(0, 10));
    });
  });
});
