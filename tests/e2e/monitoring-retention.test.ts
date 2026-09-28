import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { and, eq, sql } from 'drizzle-orm';
import { resetDatabase } from '../utils';
import { db } from '../../src/db/index';
import {
  alertEvents,
  healthChecks,
  metricSamples,
  monitoringConfig,
  providerCallLogs,
  providerCallStatsHourly,
} from '../../src/db/schema';
import { monitoringConfigSchema } from '../../src/http/contracts/monitoring';
import type { MonitoringConfigService } from '../../src/services/monitoring/MonitoringConfigService';
import type { RetentionService } from '../../src/services/monitoring/RetentionService';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

// Fixed past window for rollup fixtures — live background traffic (health
// cycles, other suites) only writes rows near now() and can never land here.
const ROLLUP_HOUR_START = new Date('2026-08-15T10:00:00Z');

function configService(): MonitoringConfigService {
  const svc = (globalThis as any).__TEST_MONITORING_CONFIG__ as MonitoringConfigService | undefined;
  expect(svc).to.not.equal(undefined, '__TEST_MONITORING_CONFIG__ is not set — tests/setup.ts must expose the app-world config service');
  return svc;
}

function retention(): RetentionService {
  const svc = (globalThis as any).__TEST_RETENTION_SERVICE__ as RetentionService | undefined;
  expect(svc).to.not.equal(undefined, '__TEST_RETENTION_SERVICE__ is not set — tests/setup.ts must expose the app-world retention service');
  return svc;
}

describe('Monitoring config + retention (P1-06)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('first boot creates the monitoring_config row with a valid config (env overrides off in test env)', async () => {
    const rows = await db.select().from(monitoringConfig).where(eq(monitoringConfig.id, 'global'));
    expect(rows.length).to.equal(1);
    expect(rows[0].version).to.be.gte(1);
    const config = monitoringConfigSchema.parse(rows[0].config);
    expect(config.retentionDays).to.be.gte(7);
    expect(config.probeSettings.llmProbe).to.be.oneOf(['models', 'one_token', 'off']);
    // No MONITORING_* env vars in the test env → no synthesized notifiers
    expect(config.notifiers).to.deep.equal([]);
  });

  it('reload() picks up user-modified rows (no clobber) and save() restores a clean config', async () => {
    const svc = configService();
    const before = await svc.get();

    // Simulate a user edit (P2-03's PUT will do this via save()): new config + version bump.
    const row = (await db.select().from(monitoringConfig).where(eq(monitoringConfig.id, 'global')))[0];
    await db
      .update(monitoringConfig)
      .set({ config: { ...before, retentionDays: 30 }, version: row.version + 1, updatedAt: new Date() })
      .where(and(eq(monitoringConfig.id, 'global'), eq(monitoringConfig.version, row.version)));

    await svc.reload();
    expect((await svc.get()).retentionDays).to.equal(30);

    // Restore a clean default config for later suites (validates + bumps version).
    await svc.save(monitoringConfigSchema.parse({}), row.version + 1);
    expect((await svc.get()).retentionDays).to.equal(90);
  });

  it('save() validates input and enforces optimistic locking', async () => {
    const svc = configService();
    const current = await svc.get();
    const currentRow = (await db.select().from(monitoringConfig).where(eq(monitoringConfig.id, 'global')))[0];
    const version = currentRow.version;

    // Valid update with the right version succeeds and bumps the version.
    await svc.save({ ...current, retentionDays: 45 }, version);
    const after = await svc.get();
    expect(after.retentionDays).to.equal(45);
    const afterRow = (await db.select().from(monitoringConfig).where(eq(monitoringConfig.id, 'global')))[0];
    expect(afterRow.version).to.equal(version + 1);

    // Stale version → OptimisticLockError.
    // NOTE: class-identity check via name — the e2e test loads src/errors in a
    // different module graph than the app, so instanceof would be false.
    let lockError: unknown = null;
    try {
      await svc.save({ ...current, retentionDays: 60 }, version);
    } catch (error) {
      lockError = error;
    }
    expect(lockError).to.be.instanceOf(Error);
    expect((lockError as Error).name).to.equal('OptimisticLockError');

    // Invalid config → ZodError (P2-03 maps this to 400).
    let invalidError: unknown = null;
    try {
      await svc.save({ ...current, retentionDays: 1 }, afterRow.version);
    } catch (error) {
      invalidError = error;
    }
    expect(invalidError).to.be.an.instanceOf(Error);
    expect((invalidError as { name: string }).name).to.equal('ZodError');

    // Restore defaults for later suites.
    await svc.save(monitoringConfigSchema.parse({}), afterRow.version);
  });

  it('hourly rollup aggregates the window into provider_call_stats_hourly (hand-computed values)', async () => {
    const at = (offsetMs: number) => new Date(ROLLUP_HOUR_START.getTime() + offsetMs);
    await db.insert(providerCallLogs).values([
      // llm.generate / ok group — 5 rows, durations 100..500
      { id: 'clgl_r1', providerId: 'prov_rollup', providerType: 'llm', apiType: 'openai', operation: 'llm.generate', ok: true, durationMs: 100, metrics: { ttftMs: 1000, maxChunkGapMs: 100 }, createdAt: at(0) },
      { id: 'clgl_r2', providerId: 'prov_rollup', providerType: 'llm', apiType: 'openai', operation: 'llm.generate', ok: true, durationMs: 200, metrics: { ttftMs: 2000 }, createdAt: at(1) },
      { id: 'clgl_r3', providerId: 'prov_rollup', providerType: 'llm', apiType: 'openai', operation: 'llm.generate', ok: true, durationMs: 300, metrics: { ttftMs: 3000 }, createdAt: at(2) },
      { id: 'clgl_r4', providerId: 'prov_rollup', providerType: 'llm', apiType: 'openai', operation: 'llm.generate', ok: true, durationMs: 400, metrics: null, createdAt: at(3) },
      { id: 'clgl_r5', providerId: 'prov_rollup', providerType: 'llm', apiType: 'openai', operation: 'llm.generate', ok: true, durationMs: 500, metrics: { ttftMs: 5000, maxChunkGapMs: 15000 }, createdAt: at(4) },
      // tts.synthesize / ok group — rtf_over_1: one row slower than its audio
      { id: 'clgl_r6', providerId: 'prov_rollup', providerType: 'tts', apiType: 'elevenlabs', operation: 'tts.synthesize', ok: true, durationMs: 8000, metrics: { audioDurationMs: 4000 }, createdAt: at(5) },
      { id: 'clgl_r7', providerId: 'prov_rollup', providerType: 'tts', apiType: 'elevenlabs', operation: 'tts.synthesize', ok: true, durationMs: 3000, metrics: { audioDurationMs: 6000 }, createdAt: at(6) },
      // tts.synthesize / failure group — error_code null -> 'none'? no: explicit timeout
      { id: 'clgl_r8', providerId: 'prov_rollup', providerType: 'tts', apiType: 'elevenlabs', operation: 'tts.synthesize', ok: false, errorCode: 'timeout', durationMs: 5000, metrics: { audioDurationMs: 2000 }, createdAt: at(7) },
    ]);

    await retention().runRollupForHour(ROLLUP_HOUR_START);

    const rows = await db.select().from(providerCallStatsHourly).where(eq(providerCallStatsHourly.providerId, 'prov_rollup'));
    expect(rows.length).to.equal(3);
    const by = (op: string, ok: boolean, code: string) =>
      rows.find((r) => r.operation === op && r.ok === ok && r.errorCode === code);

    const llm = by('llm.generate', true, 'none');
    expect(llm).to.not.equal(undefined);
    expect(llm).to.include({ count: 5, sumDurationMs: 1500, minDurationMs: 100, maxDurationMs: 500 });
    // percentile_cont(0.95) over [100..500]: position 3.8 → 480.
    // closeTo (not equal): percentile interpolation is double-precision and
    // 0.95/0.97/0.99 are not exactly representable — expect ±0.01 ms.
    expect(llm?.p95DurationMs).to.be.closeTo(480, 0.01);
    // TTFT percentiles over the 4 non-NULL values [1000,2000,3000,5000]
    expect(llm?.p50TtftMs).to.be.closeTo(2500, 0.01); // position 1.5
    expect(llm?.p95TtftMs).to.be.closeTo(4700, 0.01); // position 2.85
    expect(llm?.p99TtftMs).to.be.closeTo(4940, 0.01); // position 2.97
    // Chunk-gap percentiles over [100, 15000]; stalled = gap > 10000
    expect(llm?.p95MaxChunkGapMs).to.be.closeTo(14255, 0.01); // position 0.95
    expect(llm?.stalledCount).to.equal(1);
    expect(llm?.rtfOver1Count).to.equal(0);

    const tts = by('tts.synthesize', true, 'none');
    expect(tts).to.include({ count: 2, rtfOver1Count: 1 }); // 8000 > 4000 only
    expect(tts?.p50TtftMs).to.equal(null);

    const ttsFail = by('tts.synthesize', false, 'timeout');
    expect(ttsFail).to.include({ count: 1, rtfOver1Count: 1 });

    // Idempotent: re-running the same bucket changes nothing.
    await retention().runRollupForHour(ROLLUP_HOUR_START);
    const after = await db.select().from(providerCallStatsHourly).where(eq(providerCallStatsHourly.providerId, 'prov_rollup'));
    expect(after.length).to.equal(3);
    expect(after.find((r) => r.operation === 'llm.generate')?.count).to.equal(5);
  });

  it('rollupPreviousHour() (cron path) aggregates the previous complete hour end-to-end', async () => {
    // Regression: the cron entry used to fetch the boundary as timestamptz
    // ::text ('2026-09-01 12:00:00+00') and append a literal 'Z', producing
    // an invalid date (RangeError: Invalid time value) on every hourly tick.
    // This test exercises the full cron path, not just runRollupForHour().
    const windowRes = await db.execute(sql`
      SELECT date_trunc('hour', now()) - interval '1 hour' AS start
    `);
    const windowStart = new Date((windowRes.rows[0] as { start: Date }).start);
    // Fixture inside the window: window start + 60 s.
    await db.insert(providerCallLogs).values({
      id: 'clgl_cron',
      providerId: 'prov_cron',
      providerType: 'llm',
      apiType: 'openai',
      operation: 'llm.generate',
      ok: true,
      durationMs: 1234,
      createdAt: new Date(windowStart.getTime() + 60_000),
    });

    await retention().rollupPreviousHour();

    const rows = await db.select().from(providerCallStatsHourly).where(eq(providerCallStatsHourly.providerId, 'prov_cron'));
    expect(rows.length).to.equal(1);
    expect(rows[0]).to.include({ count: 1, sumDurationMs: 1234, minDurationMs: 1234, maxDurationMs: 1234 });
    // hour_bucket must be exactly the window start (tz-less column stores UTC
    // digits — compare via to_char so host timezone cannot skew the assertion).
    const bucketRes = await db.execute(sql`
      SELECT to_char(hour_bucket, 'YYYY-MM-DD HH24:MI:SS') AS bucket
      FROM provider_call_stats_hourly
      WHERE provider_id = 'prov_cron'
    `);
    expect((bucketRes.rows[0] as { bucket: string }).bucket).to.equal(windowStart.toISOString().slice(0, 19).replace('T', ' '));
  });

  it('runPurgeNow() deletes retention-aged rows from the four purge targets and never touches alert_events', async () => {
    const old = new Date(Date.now() - 100 * DAY_MS);
    const veryOld = new Date(Date.now() - 200 * DAY_MS);
    const recent = new Date(Date.now() - HOUR_MS);

    await db.insert(providerCallLogs).values([
      { id: 'clgl_old', providerId: 'prov_p', providerType: 'llm', apiType: 'openai', operation: 'llm.generate', ok: true, durationMs: 10, createdAt: old },
      { id: 'clgl_new', providerId: 'prov_p', providerType: 'llm', apiType: 'openai', operation: 'llm.generate', ok: true, durationMs: 10, createdAt: recent },
    ]);
    await db.insert(healthChecks).values({ id: 'hchk_old', checkName: 'db', status: 'ok', detail: {}, createdAt: old });
    await db.insert(metricSamples).values({ id: 'msmp_old', bucket: old, name: 'provider_calls_total', labels: {}, count: 1, createdAt: old });
    await db.insert(providerCallStatsHourly).values({
      hourBucket: new Date(Date.now() - 185 * DAY_MS),
      providerId: 'prov_p',
      operation: 'llm.generate',
      ok: true,
      errorCode: 'none',
      count: 1,
      sumDurationMs: 10,
    });
    await db.insert(alertEvents).values({
      id: 'alev_old',
      ruleId: 'provider-down',
      scopeKey: 'provider-down:prov_p',
      severity: 'warning',
      message: 'old alert that must survive',
      firedAt: veryOld,
    });

    await retention().runPurgeNow(90);

    const logs = await db.select().from(providerCallLogs);
    expect(logs.map((r) => r.id)).to.deep.equal(['clgl_new']);
    const health = await db.select().from(healthChecks).where(eq(healthChecks.checkName, 'db'));
    expect(health.every((r) => r.id !== 'hchk_old')).to.equal(true);
    const samples = await db.select().from(metricSamples).where(eq(metricSamples.id, 'msmp_old'));
    expect(samples.length).to.equal(0);
    const stats = await db.select().from(providerCallStatsHourly).where(eq(providerCallStatsHourly.providerId, 'prov_p'));
    expect(stats.length).to.equal(0);
    const alerts = await db.select().from(alertEvents).where(eq(alertEvents.id, 'alev_old'));
    expect(alerts.length).to.equal(1);
  });

  it('runPurgeNow() without arguments uses the configured retentionDays', async () => {
    const svc = configService();
    await svc.save({ ...(await svc.get()), retentionDays: 30 }, (await db.select().from(monitoringConfig).where(eq(monitoringConfig.id, 'global')))[0].version);

    await db.insert(providerCallLogs).values([
      { id: 'clgl_a45', providerId: 'prov_r', providerType: 'llm', apiType: 'openai', operation: 'llm.generate', ok: true, durationMs: 10, createdAt: new Date(Date.now() - 45 * DAY_MS) },
      { id: 'clgl_a20', providerId: 'prov_r', providerType: 'llm', apiType: 'openai', operation: 'llm.generate', ok: true, durationMs: 10, createdAt: new Date(Date.now() - 20 * DAY_MS) },
    ]);

    await retention().runPurgeNow();

    const logs = await db.select().from(providerCallLogs).where(eq(providerCallLogs.providerId, 'prov_r'));
    expect(logs.map((r) => r.id)).to.deep.equal(['clgl_a20']);

    // Restore defaults for later suites.
    const row = (await db.select().from(monitoringConfig).where(eq(monitoringConfig.id, 'global')))[0];
    await svc.save(monitoringConfigSchema.parse({}), row.version);
  });
});
