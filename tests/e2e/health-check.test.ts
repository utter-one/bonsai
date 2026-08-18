import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { eq } from 'drizzle-orm';
import { authed, resetDatabase } from '../utils';
import { db } from '../../src/db/index';
import { healthChecks } from '../../src/db/schema';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Health Check Service (P1-05)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('GET /health/ready returns 200 ready while the DB is up', async () => {
    const res = await authed().get('/health/ready');
    expect(res.status).to.equal(200);
    expect(res.body.status).to.equal('ready');
  });

  it('GET /health remains the unauthenticated liveness probe', async () => {
    const res = await authed().get('/health');
    expect(res.status).to.equal(200);
    expect(res.body.status).to.equal('healthy');
  });

  it('persists db, process, and all 7 service_heartbeat rows per cycle', async () => {
    // 1 s health interval in the test env — two cycles after the reset
    await sleep(2500);
    const rows = await db.select().from(healthChecks);
    const names = new Set(rows.map((r) => r.checkName));

    expect(names).to.include('db');
    expect(names).to.include('process');
    for (const service of [
      'conversation-timeout',
      'processing-deferral',
      'scenario-run-executor',
      'benchmark-executor',
      'imap-inbound',
      'oauth2-token-refresh',
      'health-checks',
    ]) {
      expect(names).to.include(`service_heartbeat:${service}`);
    }

    const dbRows = rows.filter((r) => r.checkName === 'db');
    expect(dbRows.length).to.be.gte(2);
    expect(dbRows.every((r) => r.status === 'ok')).to.equal(true);
    expect(dbRows[0].detail).to.include.keys('poolTotal', 'poolIdle', 'poolWaiting');

    const processRows = rows.filter((r) => r.checkName === 'process');
    expect(processRows.length).to.be.gte(2);
    // Unit regression (P1-05 finding 11): monitorEventLoopDelay values are ns —
    // a healthy test machine reports tens of ms, never the ~20,000+ the old
    // /1000 (µs-assumption) conversion produced.
    expect(processRows[0].detail.eventLoopLagP95Ms).to.be.lessThan(1000);
    // max: a single isolated GC stall may exceed p95, so the guard is wider —
    // still 10× below what the unit bug would produce.
    expect(processRows[0].detail.eventLoopLagMaxMs).to.be.lessThan(5000);
    expect(dbRows[0].latencyMs).to.be.a('number');

    // No IMAP providers configured → never ticked → unknown, not down
    const imapRows = rows.filter((r) => r.checkName === 'service_heartbeat:imap-inbound');
    expect(imapRows.length).to.be.gte(1);
    expect(imapRows.every((r) => r.status === 'unknown')).to.equal(true);
  });

  it('persists provider:{id} rows for created providers (inferred — probes off in tests)', async () => {
    const res = await authed().post('/api/providers').send({
      name: 'Health Test LLM',
      providerType: 'llm',
      apiType: 'openai',
      config: { apiKey: 'sk-health-test-key' },
    });
    expect(res.status).to.equal(201);
    const providerId = res.body.id;

    await sleep(2500);
    const rows = await db.select().from(healthChecks).where(eq(healthChecks.checkName, `provider:${providerId}`));
    expect(rows.length).to.be.gte(1);
    // No call logs yet → inference says unknown; MONITORING_HEALTH_PROBES=off → no probe traffic
    expect(rows.every((r) => r.status === 'unknown')).to.equal(true);
    expect(rows[0].detail).to.include({ inferred: true });
  });
});
