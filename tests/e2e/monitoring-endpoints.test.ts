import { describe, it, before, beforeEach } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import { authed, unauthed, resetDatabase } from '../utils';
import { db } from '../../src/db/index';
import { healthChecks, metricSamples, providerCallLogs, providers } from '../../src/db/schema';

const MONITORING_ENDPOINTS: Array<{ path: string; query?: Record<string, string> }> = [
  { path: '/api/monitoring/health' },
  { path: '/api/monitoring/health/history' },
  { path: '/api/monitoring/providers' },
  { path: '/api/monitoring/provider-calls' },
  { path: '/api/monitoring/provider-stats', query: { from: '2026-08-17T00:00:00.000Z', to: '2026-08-17T03:00:00.000Z' } },
  { path: '/api/monitoring/metrics', query: { name: 'provider_calls_total', from: '2026-08-17T00:00:00.000Z', to: '2026-08-17T01:00:00.000Z' } },
  { path: '/api/monitoring/metric-catalog' },
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Create a viewer operator and return a token agent (operators survive resetDatabase). */
async function createViewerAgent() {
  const operatorId = 'viewer-monitoring@example.com';
  const createRes = await authed()
    .post('/api/operators')
    .send({ id: operatorId, name: 'Viewer Monitoring', roles: ['viewer'], password: 'viewerpass123' });
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

/** Insert a provider + rolling-window call logs and return the provider id. */
async function insertProviderWithRecentCalls(providerId: string) {
  await db.insert(providers).values({
    id: providerId,
    name: `Monitoring ${providerId}`,
    providerType: 'llm',
    apiType: 'openai',
    config: { apiKey: 'sk-monitoring-test' },
  });
  const now = new Date();
  const at = (secondsAgo: number) => new Date(now.getTime() - secondsAgo * 1000);
  await db.insert(providerCallLogs).values([
    { id: `${providerId}-c1`, providerId, providerType: 'llm', apiType: 'openai', operation: 'llm.generate', ok: true, durationMs: 100, createdAt: at(10) },
    { id: `${providerId}-c2`, providerId, providerType: 'llm', apiType: 'openai', operation: 'llm.generate', ok: true, durationMs: 200, createdAt: at(20) },
    { id: `${providerId}-c3`, providerId, providerType: 'llm', apiType: 'openai', operation: 'llm.generate', ok: true, durationMs: 300, createdAt: at(30) },
    { id: `${providerId}-c4`, providerId, providerType: 'llm', apiType: 'openai', operation: 'llm.generate', ok: true, durationMs: 400, createdAt: at(40) },
    { id: `${providerId}-c5`, providerId, providerType: 'llm', apiType: 'openai', operation: 'llm.generate', ok: false, errorCode: 'rate_limited', statusHttp: 429, durationMs: 800, createdAt: at(50) },
    { id: `${providerId}-c6`, providerId, providerType: 'llm', apiType: 'openai', operation: 'llm.generate', ok: false, errorCode: 'rate_limited', statusHttp: 429, durationMs: 900, createdAt: at(60) },
    { id: `${providerId}-c7`, providerId, providerType: 'llm', apiType: 'openai', operation: 'llm.generate', ok: false, errorCode: 'timeout', durationMs: 1000, createdAt: at(70) },
  ]);
}

describe('Monitoring endpoints (P1-08)', () => {
  let viewerAgent: ReturnType<typeof request.agent>;

  before(async () => {
    await resetDatabase();
    viewerAgent = await createViewerAgent();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  describe('RBAC', () => {
    it('rejects unauthenticated requests with 401 on all read-only endpoints', async () => {
      for (const { path, query } of MONITORING_ENDPOINTS) {
        const res = await unauthed().get(path).query(query ?? {});
        expect(res.status, `GET ${path} unauthenticated`).to.equal(401);
      }
    });

    it('rejects viewer role with 403 on all read-only endpoints', async () => {
      for (const { path, query } of MONITORING_ENDPOINTS) {
        const res = await viewerAgent.get(path).query(query ?? {});
        expect(res.status, `GET ${path} viewer`).to.equal(403);
      }
    });

    it('allows super_admin on all read-only endpoints', async () => {
      for (const { path, query } of MONITORING_ENDPOINTS) {
        const res = await authed().get(path).query(query ?? {});
        expect(res.status, `GET ${path} super_admin`).to.equal(200);
      }
    });
  });

  describe('GET /api/monitoring/health', () => {
    it('returns the in-memory snapshot with the persisted check names', async () => {
      // Two 1-second health cycles after the reset guarantee a fresh snapshot.
      await sleep(2500);
      const res = await authed().get('/api/monitoring/health');
      expect(res.status).to.equal(200);
      expect(res.body.checkedAt).to.be.a('string');
      expect(res.body.checks).to.be.an('array').that.is.not.empty;
      expect(res.body.overall).to.be.oneOf(['ok', 'degraded', 'down', 'unknown']);

      const names = res.body.checks.map((c: any) => c.name);
      expect(names).to.include('db');
      expect(names).to.include('process');
      expect(names).to.include('service_heartbeat:conversation-timeout');
      for (const check of res.body.checks) {
        expect(['ok', 'degraded', 'down', 'unknown']).to.include(check.status);
      }
    });
  });

  describe('GET /api/monitoring/health/history', () => {
    it('lists persisted rows newest first with pagination', async () => {
      const base = new Date('2026-08-17T05:00:00Z');
      // The live HealthCheckService (1 s cycle in the test env) interleaves real rows named
      // db/process/provider:* — filter on a fixture-only name for a deterministic set
      // (flake fix, 2026-08-18).
      await db.insert(healthChecks).values([
        { id: 'hmon_1', checkName: 'fixture_probe', status: 'ok', latencyMs: 1, detail: {}, createdAt: base },
        { id: 'hmon_2', checkName: 'fixture_probe', status: 'degraded', latencyMs: 500, detail: {}, createdAt: new Date(base.getTime() + 60_000) },
        { id: 'hmon_3', checkName: 'fixture_probe', status: 'ok', latencyMs: null, detail: {}, createdAt: new Date(base.getTime() + 120_000) },
      ]);

      const res = await authed().get('/api/monitoring/health/history').query({ 'filters[checkName]': 'fixture_probe', limit: 2 });
      expect(res.status).to.equal(200);
      expect(res.body.total).to.equal(3);
      expect(res.body.offset).to.equal(0);
      expect(res.body.limit).to.equal(2);
      expect(res.body.items).to.have.length(2);
      // Newest first.
      expect(res.body.items[0].id).to.equal('hmon_3');
      expect(res.body.items[1].id).to.equal('hmon_2');

      const page2 = await authed().get('/api/monitoring/health/history').query({ 'filters[checkName]': 'fixture_probe', limit: 2, offset: 2 });
      expect(page2.body.items).to.have.length(1);
      expect(page2.body.items[0].id).to.equal('hmon_1');

      // Unfiltered pages are also newest first (real rows interleave — check monotonicity).
      const all = await authed().get('/api/monitoring/health/history').query({ limit: 50 });
      const times = all.body.items.map((i: any) => new Date(i.createdAt).getTime());
      for (let k = 1; k < times.length; k++) {
        expect(times[k]).to.be.at.most(times[k - 1]);
      }
    });

    it('filters by status and check name (both aliases)', async () => {
      const base = new Date('2026-08-17T06:00:00Z');
      // Fixture-only check name — the live health service never writes it (flake fix, 2026-08-18).
      await db.insert(healthChecks).values([
        { id: 'hmon_f1', checkName: 'fixture_probe', status: 'ok', latencyMs: 1, detail: {}, createdAt: base },
        { id: 'hmon_f2', checkName: 'fixture_probe', status: 'down', latencyMs: null, detail: {}, createdAt: base },
        { id: 'hmon_f3', checkName: 'fixture_probe', status: 'down', latencyMs: null, detail: {}, createdAt: base },
      ]);

      const byStatus = await authed()
        .get('/api/monitoring/health/history')
        .query({ 'filters[status]': 'down', 'filters[checkName]': 'fixture_probe' });
      expect(byStatus.body.total).to.equal(2);

      const byCheck = await authed().get('/api/monitoring/health/history').query({ 'filters[check]': 'fixture_probe' });
      expect(byCheck.body.total).to.equal(3);

      const byCheckName = await authed().get('/api/monitoring/health/history').query({ 'filters[checkName]': 'fixture_probe' });
      expect(byCheckName.body.total).to.equal(3);

      // Fixture timestamps are yesterday; live rows are "now" — the window is deterministic.
      const byBetween = await authed()
        .get('/api/monitoring/health/history')
        .query({
          'filters[createdAt][op]': 'between',
          'filters[createdAt][value][0]': '2026-08-17T06:00:00Z',
          'filters[createdAt][value][1]': '2026-08-17T06:01:00Z',
        });
      expect(byBetween.body.total).to.equal(3);
    });
  });

  describe('GET /api/monitoring/providers', () => {
    it('returns per-provider rolling 15-minute stats and inferred probe status', async () => {
      await insertProviderWithRecentCalls('prov_mon_ep');
      // Let a 1-second health cycle pick up the provider and infer from the logs.
      await sleep(2500);

      const res = await authed().get('/api/monitoring/providers');
      expect(res.status).to.equal(200);
      const provider = res.body.providers.find((p: any) => p.id === 'prov_mon_ep');
      expect(provider).to.not.equal(undefined);
      expect(provider.name).to.equal('Monitoring prov_mon_ep');
      expect(provider.providerType).to.equal('llm');
      expect(provider.apiType).to.equal('openai');

      // Inferred from the recent successful calls (probes off in the test env).
      expect(provider.probeStatus).to.equal('ok');

      const rolling = provider.rolling;
      expect(rolling.windowMinutes).to.equal(15);
      expect(rolling.calls).to.equal(7);
      expect(rolling.okRate).to.be.closeTo(4 / 7, 0.0001);
      // p95 over [100,200,300,400,800,900,1000]: rank 0.95*6=5.7 → 900 + 0.7*(1000-900) = 970
      // (percentile_cont is float arithmetic — allow 1e-9 error)
      expect(rolling.p95DurationMs).to.be.closeTo(970, 1e-6);
      expect(rolling.topErrorCodes).to.deep.equal([
        ['rate_limited', 2],
        ['timeout', 1],
      ]);
    });

    it('returns empty rolling stats for a provider without recent calls', async () => {
      await db.insert(providers).values({
        id: 'prov_mon_idle',
        name: 'Idle Provider',
        providerType: 'tts',
        apiType: 'elevenlabs',
        config: { apiKey: 'sk-monitoring-test' },
      });
      const res = await authed().get('/api/monitoring/providers');
      const provider = res.body.providers.find((p: any) => p.id === 'prov_mon_idle');
      expect(provider).to.not.equal(undefined);
      expect(provider.rolling.calls).to.equal(0);
      expect(provider.rolling.okRate).to.equal(null);
      expect(provider.rolling.p95DurationMs).to.equal(null);
      expect(provider.rolling.topErrorCodes).to.deep.equal([]);
    });
  });

  describe('GET /api/monitoring/provider-calls', () => {
    beforeEach(async () => {
      await db.insert(providerCallLogs).values([
        { id: 'pcl_1', providerId: 'prov_a', providerType: 'llm', apiType: 'openai', operation: 'llm.generate', model: 'gpt-4o', ok: true, durationMs: 120, metrics: { ttftMs: 800 }, createdAt: new Date('2026-08-17T08:00:00Z') },
        { id: 'pcl_2', providerId: 'prov_a', providerType: 'llm', apiType: 'openai', operation: 'llm.generate', model: 'gpt-4o-mini', ok: false, errorCode: 'rate_limited', statusHttp: 429, durationMs: 30, errorText: 'slow down', createdAt: new Date('2026-08-17T08:01:00Z') },
        { id: 'pcl_3', providerId: 'prov_b', providerType: 'asr', apiType: 'openai', operation: 'asr.transcribe', ok: true, durationMs: 900, conversationId: 'conv_1', createdAt: new Date('2026-08-17T08:02:00Z') },
      ]);
    });

    it('lists all rows newest first with pagination', async () => {
      const res = await authed().get('/api/monitoring/provider-calls').query({ limit: 2 });
      expect(res.status).to.equal(200);
      expect(res.body.total).to.equal(3);
      expect(res.body.items).to.have.length(2);
      expect(res.body.items[0].id).to.equal('pcl_3');
      expect(res.body.items[0].providerId).to.equal('prov_b');
      expect(res.body.items[0].errorCode).to.equal(null);

      const page2 = await authed().get('/api/monitoring/provider-calls').query({ limit: 2, offset: 2 });
      expect(page2.body.items).to.have.length(1);
      expect(page2.body.items[0].id).to.equal('pcl_1');
    });

    it('filters by providerId, ok and errorCode', async () => {
      const byProvider = await authed().get('/api/monitoring/provider-calls').query({ 'filters[providerId]': 'prov_a' });
      expect(byProvider.body.total).to.equal(2);

      const byFailed = await authed().get('/api/monitoring/provider-calls').query({ 'filters[ok]': 'false' });
      expect(byFailed.body.total).to.equal(1);
      expect(byFailed.body.items[0].id).to.equal('pcl_2');

      const byCode = await authed().get('/api/monitoring/provider-calls').query({ 'filters[errorCode]': 'rate_limited' });
      expect(byCode.body.total).to.equal(1);
      expect(byCode.body.items[0].statusHttp).to.equal(429);
    });

    it('supports text search over operation, model, providerId and conversationId', async () => {
      const byModel = await authed().get('/api/monitoring/provider-calls').query({ textSearch: 'gpt-4o-mini' });
      expect(byModel.body.total).to.equal(1);
      expect(byModel.body.items[0].id).to.equal('pcl_2');

      const byConversation = await authed().get('/api/monitoring/provider-calls').query({ textSearch: 'conv_1' });
      expect(byConversation.body.total).to.equal(1);
      expect(byConversation.body.items[0].id).to.equal('pcl_3');

      const byOperation = await authed().get('/api/monitoring/provider-calls').query({ textSearch: 'transcribe' });
      expect(byOperation.body.total).to.equal(1);
    });

    it('exposes the metrics jsonb variant fields on rows', async () => {
      const res = await authed().get('/api/monitoring/provider-calls').query({ 'filters[id]': 'pcl_1' });
      expect(res.body.items[0].metrics).to.deep.equal({ ttftMs: 800 });
    });
  });

  describe('GET /api/monitoring/provider-stats', () => {
    beforeEach(async () => {
      // Hour 0 (00:00–01:00): 4 llm rows, ttft 1000..4000, durations 100..400.
      await db.insert(providerCallLogs).values([
        { id: 'ps_1', providerId: 'prov_stats', providerType: 'llm', apiType: 'openai', operation: 'llm.generate', ok: true, durationMs: 100, metrics: { ttftMs: 1000 }, createdAt: new Date('2026-08-17T00:10:00Z') },
        { id: 'ps_2', providerId: 'prov_stats', providerType: 'llm', apiType: 'openai', operation: 'llm.generate', ok: true, durationMs: 200, metrics: { ttftMs: 2000 }, createdAt: new Date('2026-08-17T00:20:00Z') },
        { id: 'ps_3', providerId: 'prov_stats', providerType: 'llm', apiType: 'openai', operation: 'llm.generate', ok: false, errorCode: 'server_error', durationMs: 300, metrics: { ttftMs: 3000 }, createdAt: new Date('2026-08-17T00:30:00Z') },
        { id: 'ps_4', providerId: 'prov_stats', providerType: 'llm', apiType: 'openai', operation: 'llm.generate', ok: true, durationMs: 400, metrics: { ttftMs: 4000 }, createdAt: new Date('2026-08-17T00:40:00Z') },
        // Hour 1 (01:00–02:00): 2 tts rows — one slower than real time, one stalled.
        { id: 'ps_5', providerId: 'prov_stats', providerType: 'tts', apiType: 'elevenlabs', operation: 'tts.synthesize', ok: true, durationMs: 8000, metrics: { audioDurationMs: 4000 }, createdAt: new Date('2026-08-17T01:10:00Z') },
        { id: 'ps_6', providerId: 'prov_stats', providerType: 'tts', apiType: 'elevenlabs', operation: 'tts.synthesize', ok: true, durationMs: 3000, metrics: { audioDurationMs: 6000, maxChunkGapMs: 15000 }, createdAt: new Date('2026-08-17T01:20:00Z') },
      ]);
    });

    it('aggregates per (bucket, providerId, operation) with TTFT percentiles (groupBy=hour)', async () => {
      const res = await authed()
        .get('/api/monitoring/provider-stats')
        .query({ from: '2026-08-17T00:00:00.000Z', to: '2026-08-17T03:00:00.000Z' });
      expect(res.status).to.equal(200);
      expect(res.body.groupBy).to.equal('hour');
      expect(res.body.buckets).to.have.length(2);

      const hour0 = res.body.buckets[0];
      expect(hour0.bucket).to.equal('2026-08-17T00:00:00.000Z');
      expect(hour0.providerId).to.equal('prov_stats');
      expect(hour0.operation).to.equal('llm.generate');
      expect(hour0.count).to.equal(4);
      expect(hour0.sumDurationMs).to.equal(1000);
      expect(hour0.minDurationMs).to.equal(100);
      expect(hour0.maxDurationMs).to.equal(400);
      // percentile_cont(0.5) over [1000,2000,3000,4000] = 2500; (0.95) = 3850; (0.99) = 3970
      // (percentile_cont is float arithmetic — allow 1e-6 error)
      expect(hour0.p50TtftMs).to.be.closeTo(2500, 1e-6);
      expect(hour0.p95TtftMs).to.be.closeTo(3850, 1e-6);
      expect(hour0.p99TtftMs).to.be.closeTo(3970, 1e-6);
      expect(hour0.p95MaxChunkGapMs).to.equal(null);
      expect(hour0.stalledCount).to.equal(0);
      expect(hour0.rtfOver1Count).to.equal(0);

      const hour1 = res.body.buckets[1];
      expect(hour1.bucket).to.equal('2026-08-17T01:00:00.000Z');
      expect(hour1.operation).to.equal('tts.synthesize');
      expect(hour1.count).to.equal(2);
      expect(hour1.sumDurationMs).to.equal(11000);
      expect(hour1.p50TtftMs).to.equal(null);
      expect(hour1.p95MaxChunkGapMs).to.equal(15000);
      expect(hour1.stalledCount).to.equal(1);
      expect(hour1.rtfOver1Count).to.equal(1);
    });

    it('merges hours into days with groupBy=day', async () => {
      const res = await authed()
        .get('/api/monitoring/provider-stats')
        .query({ from: '2026-08-17T00:00:00.000Z', to: '2026-08-17T03:00:00.000Z', groupBy: 'day' });
      expect(res.status).to.equal(200);
      expect(res.body.buckets).to.have.length(2); // one per operation (llm.generate, tts.synthesize)

      const llm = res.body.buckets.find((b: any) => b.operation === 'llm.generate');
      expect(llm.bucket).to.equal('2026-08-17T00:00:00.000Z');
      expect(llm.count).to.equal(4);

      const tts = res.body.buckets.find((b: any) => b.operation === 'tts.synthesize');
      expect(tts.count).to.equal(2);
      expect(tts.rtfOver1Count).to.equal(1);
    });

    it('honours providerId and operation filters', async () => {
      const byOp = await authed()
        .get('/api/monitoring/provider-stats')
        .query({ from: '2026-08-17T00:00:00.000Z', to: '2026-08-17T03:00:00.000Z', operation: 'tts.synthesize' });
      expect(byOp.body.buckets).to.have.length(1);
      expect(byOp.body.buckets[0].operation).to.equal('tts.synthesize');

      const byProvider = await authed()
        .get('/api/monitoring/provider-stats')
        .query({ from: '2026-08-17T00:00:00.000Z', to: '2026-08-17T03:00:00.000Z', providerId: 'prov_stats' });
      expect(byProvider.body.buckets).to.have.length(2);

      const byOtherProvider = await authed()
        .get('/api/monitoring/provider-stats')
        .query({ from: '2026-08-17T00:00:00.000Z', to: '2026-08-17T03:00:00.000Z', providerId: 'prov_nope' });
      expect(byOtherProvider.body.buckets).to.have.length(0);
    });

    it('rejects invalid windows with 400', async () => {
      // Missing required params.
      const missing = await authed().get('/api/monitoring/provider-stats').query({ from: '2026-08-17T00:00:00.000Z' });
      expect(missing.status).to.equal(400);

      // Inverted window.
      const inverted = await authed()
        .get('/api/monitoring/provider-stats')
        .query({ from: '2026-08-17T03:00:00.000Z', to: '2026-08-17T00:00:00.000Z' });
      expect(inverted.status).to.equal(400);
      expect(inverted.body.error).to.match(/after from/);

      // Span beyond 14 days.
      const tooWide = await authed()
        .get('/api/monitoring/provider-stats')
        .query({ from: '2026-08-01T00:00:00.000Z', to: '2026-08-20T00:00:00.000Z' });
      expect(tooWide.status).to.equal(400);
      expect(tooWide.body.error).to.match(/14 days/);

      // Invalid groupBy.
      const badGroupBy = await authed()
        .get('/api/monitoring/provider-stats')
        .query({ from: '2026-08-17T00:00:00.000Z', to: '2026-08-17T03:00:00.000Z', groupBy: 'week' });
      expect(badGroupBy.status).to.equal(400);
    });
  });

  describe('GET /api/monitoring/metrics', () => {
    beforeEach(async () => {
      const at = (iso: string) => new Date(iso);
      await db.insert(metricSamples).values([
        // Series A: labels {ok:true, provider_id:prov_a}, buckets 10:00–10:02 + 10:15.
        { id: 'msmp_a1', bucket: at('2026-08-17T10:00:00Z'), name: 'provider_calls_total', labels: { provider_id: 'prov_a', ok: 'true' }, count: 1, sum: 10, min: 10, max: 10, createdAt: at('2026-08-17T10:00:05Z') },
        { id: 'msmp_a2', bucket: at('2026-08-17T10:01:00Z'), name: 'provider_calls_total', labels: { provider_id: 'prov_a', ok: 'true' }, count: 2, sum: 20, min: 5, max: 10, createdAt: at('2026-08-17T10:01:05Z') },
        { id: 'msmp_a3', bucket: at('2026-08-17T10:02:00Z'), name: 'provider_calls_total', labels: { provider_id: 'prov_a', ok: 'true' }, count: 3, sum: 30, min: 5, max: 15, createdAt: at('2026-08-17T10:02:05Z') },
        { id: 'msmp_a4', bucket: at('2026-08-17T10:15:00Z'), name: 'provider_calls_total', labels: { provider_id: 'prov_a', ok: 'true' }, count: 5, sum: 50, min: 1, max: 20, createdAt: at('2026-08-17T10:15:05Z') },
        // Series B: different label set, same bucket as A's first point.
        { id: 'msmp_b1', bucket: at('2026-08-17T10:00:00Z'), name: 'provider_calls_total', labels: { provider_id: 'prov_b', ok: 'false' }, count: 7, sum: null, min: null, max: null, createdAt: at('2026-08-17T10:00:05Z') },
        // Unrelated metric name in the same window.
        { id: 'msmp_x1', bucket: at('2026-08-17T10:00:00Z'), name: 'db_pool_waiting', labels: {}, count: 9, sum: 9, min: 9, max: 9, createdAt: at('2026-08-17T10:00:05Z') },
      ]);
    });

    it('returns one series per label set with per-step points, oldest first', async () => {
      const res = await authed()
        .get('/api/monitoring/metrics')
        .query({ name: 'provider_calls_total', from: '2026-08-17T10:00:00.000Z', to: '2026-08-17T11:00:00.000Z', step: '1m' });
      expect(res.status).to.equal(200);
      expect(res.body.name).to.equal('provider_calls_total');
      expect(res.body.step).to.equal('1m');
      expect(res.body.series).to.have.length(2);

      // Series are ordered by labels::text — {"ok":"false","provider_id":"prov_b"} sorts first.
      const seriesA = res.body.series.find((s: any) => s.labels.provider_id === 'prov_a');
      const seriesB = res.body.series.find((s: any) => s.labels.provider_id === 'prov_b');
      expect(seriesA).to.not.equal(undefined);
      expect(seriesB).to.not.equal(undefined);

      expect(seriesA.points).to.have.length(4);
      expect(seriesA.points[0]).to.deep.equal({ bucket: '2026-08-17T10:00:00.000Z', count: 1, sum: 10, min: 10, max: 10 });
      expect(seriesA.points[3]).to.deep.equal({ bucket: '2026-08-17T10:15:00.000Z', count: 5, sum: 50, min: 1, max: 20 });
      expect(seriesB.points).to.deep.equal([{ bucket: '2026-08-17T10:00:00.000Z', count: 7, sum: null, min: null, max: null }]);
    });

    it('buckets at the requested step (15m aggregates the 10:00–10:02 points)', async () => {
      // Exact label-set match: the stored series A labels have two keys — both must be given.
      const res = await authed()
        .get('/api/monitoring/metrics')
        .query({
          name: 'provider_calls_total',
          from: '2026-08-17T10:00:00.000Z',
          to: '2026-08-17T11:00:00.000Z',
          step: '15m',
          'labels[provider_id]': 'prov_a',
          'labels[ok]': 'true',
        });
      expect(res.status).to.equal(200);
      expect(res.body.series).to.have.length(1);
      const points = res.body.series[0].points;
      expect(points).to.have.length(2);
      // 10:00 bucket = 1+2+3 counts, 10+20+30 sums; min = 5, max = 15.
      expect(points[0]).to.deep.equal({ bucket: '2026-08-17T10:00:00.000Z', count: 6, sum: 60, min: 5, max: 15 });
      expect(points[1]).to.deep.equal({ bucket: '2026-08-17T10:15:00.000Z', count: 5, sum: 50, min: 1, max: 20 });
    });

    it('matches labels exactly (partial label sets are not returned)', async () => {
      // Exact match on the full series-A label set.
      const exact = await authed()
        .get('/api/monitoring/metrics')
        .query({ name: 'provider_calls_total', from: '2026-08-17T10:00:00.000Z', to: '2026-08-17T11:00:00.000Z', 'labels[provider_id]': 'prov_a', 'labels[ok]': 'true' });
      expect(exact.body.series).to.have.length(1);
      expect(exact.body.series[0].labels).to.deep.equal({ provider_id: 'prov_a', ok: 'true' });

      // A label set that never occurred → empty series list.
      const absent = await authed()
        .get('/api/monitoring/metrics')
        .query({ name: 'provider_calls_total', from: '2026-08-17T10:00:00.000Z', to: '2026-08-17T11:00:00.000Z', 'labels[provider_id]': 'prov_zzz' });
      expect(absent.body.series).to.have.length(0);
    });

    it('validates required params and the 14-day window with 400', async () => {
      const missingName = await authed()
        .get('/api/monitoring/metrics')
        .query({ from: '2026-08-17T10:00:00.000Z', to: '2026-08-17T11:00:00.000Z' });
      expect(missingName.status).to.equal(400);

      const badStep = await authed()
        .get('/api/monitoring/metrics')
        .query({ name: 'provider_calls_total', from: '2026-08-17T10:00:00.000Z', to: '2026-08-17T11:00:00.000Z', step: '5m' });
      expect(badStep.status).to.equal(400);

      const tooWide = await authed()
        .get('/api/monitoring/metrics')
        .query({ name: 'provider_calls_total', from: '2026-08-01T00:00:00.000Z', to: '2026-08-20T00:00:00.000Z' });
      expect(tooWide.status).to.equal(400);
      expect(tooWide.body.error).to.match(/14 days/);
    });
  });

  describe('GET /api/monitoring/metric-catalog', () => {
    const EXPECTED_METRIC_NAMES = [
      'active_conversations',
      'active_voice_media_streams',
      'active_websocket_connections',
      'ai_turn_ttft_ms',
      'api_request_duration_ms',
      'api_requests_total',
      'asr_eos_to_final_ms',
      'asr_setup_ms',
      'background_service_last_run_ts',
      'circuit_breaker_state',
      'circuit_open_skips_total',
      'circuit_opens_total',
      'db_pool_idle',
      'db_pool_total',
      'db_pool_waiting',
      'event_loop_lag_max_ms',
      'event_loop_lag_p95_ms',
      'fallback_attempts_total',
      'fallback_incompatible_total',
      'fallbacks_executed_total',
      'health_check_latency_ms',
      'health_check_status',
      'imap_poll_total',
      'llm_stream_duration_ms',
      'llm_ttft_ms',
      'oauth_refresh_total',
      'provider_call_duration_ms',
      'provider_calls_total',
      'provider_chain_exhausted_total',
      'rate_limit_rejections_total',
      'rss_bytes',
      'tts_synthesis_ms',
      'tts_ttfa_ms',
      'voice_media_bytes_total',
      'voice_media_max_frame_gap_ms',
    ];

    it('returns the full static catalog (35 metrics, exact name set)', async () => {
      const res = await authed().get('/api/monitoring/metric-catalog');
      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('metrics').that.is.an('array');
      // Exact-set pin: adding/removing a registered metric must update this test deliberately
      expect(res.body.metrics.map((m: { name: string }) => m.name)).to.deep.equal(EXPECTED_METRIC_NAMES);
    });

    it('serves name, kind, description and the effective maxSeries per metric — buckets for histograms only', async () => {
      const res = await authed().get('/api/monitoring/metric-catalog');
      expect(res.status).to.equal(200);
      const metrics: Array<Record<string, unknown>> = res.body.metrics;
      for (let i = 1; i < metrics.length; i++) {
        expect(metrics[i].name > metrics[i - 1].name, `sorted by name at ${metrics[i].name}`).to.equal(true);
      }
      for (const metric of metrics) {
        expect(metric.name).to.be.a('string').and.not.empty;
        expect(metric.kind).to.be.oneOf(['counter', 'gauge', 'histogram']);
        expect(metric.description).to.be.a('string').and.not.empty;
        expect(metric.maxSeries).to.be.a('number').and.above(0);
        if (metric.kind === 'histogram') {
          expect(metric.buckets, `buckets of ${metric.name}`).to.be.an('array').that.is.not.empty;
          for (let i = 1; i < metric.buckets.length; i++) {
            expect(metric.buckets[i], `bucket order of ${metric.name}`).to.be.greaterThan(metric.buckets[i - 1]);
          }
        } else {
          expect(metric.buckets, `buckets of non-histogram ${metric.name}`).to.be.undefined;
        }
        // no registry internals leak through the projection
        expect(Object.keys(metric).sort()).to.deep.equal(
          metric.kind === 'histogram'
            ? ['buckets', 'description', 'kind', 'maxSeries', 'name']
            : ['description', 'kind', 'maxSeries', 'name']
        );
      }
    });

    it('matches the registry config for sampled metrics', async () => {
      const res = await authed().get('/api/monitoring/metric-catalog');
      const byName = new Map(res.body.metrics.map((m: { name: string }) => [m.name, m]));
      expect(byName.get('health_check_latency_ms')?.buckets).to.deep.equal([5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]);
      expect(byName.get('health_check_latency_ms')?.maxSeries).to.equal(500);
      expect(byName.get('health_check_status')?.kind).to.equal('gauge');
      expect(byName.get('circuit_breaker_state')?.maxSeries).to.equal(500);
      expect(byName.get('api_requests_total')?.maxSeries).to.equal(4000);
      expect(byName.get('provider_call_duration_ms')?.buckets).to.deep.equal([5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000]);
      expect(byName.get('rate_limit_rejections_total')?.maxSeries).to.equal(50); // effective default
    });
  });
});
