import { inject, singleton } from 'tsyringe';
import { schedule } from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { sql } from 'drizzle-orm';
import { db } from '../../db';
import { MonitoringConfigService } from './MonitoringConfigService';
import logger from '../../utils/logger';

const MS_PER_DAY = 86_400_000;

/**
 * P1-06 — rollups + retention (PROPOSAL §3.2e/§4).
 *
 * Hourly (`0 * * * *`): rolls the previous complete hour of
 * `provider_call_logs` up into `provider_call_stats_hourly` (single idempotent
 * `INSERT ... SELECT ... ON CONFLICT DO NOTHING`; TTFT / chunk-gap percentiles
 * are computed over non-NULL jsonb-extracted values in separate CTE
 * aggregations because `percentile_cont` does not skip NULLs).
 *
 * Daily (`0 3 * * *`): purges `provider_call_logs`, `health_checks`,
 * `metric_samples` older than `retentionDays` and
 * `provider_call_stats_hourly` older than 2× `retentionDays`.
 * `alert_events`, `fallback_events` and `monitoring_config` are never purged.
 */
@singleton()
export class RetentionService {
  private rollupTask: ScheduledTask | null = null;
  private purgeTask: ScheduledTask | null = null;
  private isRollingUp = false;
  private isPurging = false;

  constructor(
    @inject(MonitoringConfigService) private readonly monitoringConfigService: MonitoringConfigService,
  ) {}

  /** Starts both cron jobs. Called from server.ts with the other background services. */
  start(): void {
    logger.info('Starting RetentionService (hourly rollup, daily purge at 03:00)');
    this.rollupTask = schedule('0 * * * *', () => {
      this.rollupPreviousHour().catch((error) => logger.error({ error }, 'Unhandled error in RetentionService.rollupPreviousHour'));
    });
    this.purgeTask = schedule('0 3 * * *', () => {
      this.runPurgeNow().catch((error) => logger.error({ error }, 'Unhandled error in RetentionService.runPurgeNow'));
    });
  }

  /** Stops both cron jobs (P1-09 shutdown hook). */
  stop(): void {
    if (this.rollupTask) {
      this.rollupTask.destroy();
      this.rollupTask = null;
    }
    if (this.purgeTask) {
      this.purgeTask.destroy();
      this.purgeTask = null;
    }
    logger.info('RetentionService stopped');
  }

  /** Cron entry: roll up the previous complete hour (boundary computed in SQL). */
  async rollupPreviousHour(): Promise<void> {
    // The timestamp columns are tz-less; compute the boundary inside Postgres
    // so the app clock's timezone can never disagree with date_trunc().
    //
    // TZ gotcha (verified e2e on a non-UTC host): pg parses naive-timestamp
    // results as host-local time, which would shift the boundary by the host
    // offset. Fetch the boundary as text and mark it UTC explicitly — the DB
    // session runs in UTC (postgres image default + test container), so the
    // wall clock IS UTC.
    const result = await db.execute(sql`
      SELECT (date_trunc('hour', now()) - interval '1 hour')::text AS start
    `);
    const hourStartText = (result.rows[0] as { start: string }).start;
    const hourStart = new Date(`${hourStartText.replace(' ', 'T')}Z`);
    await this.runRollupForHour(hourStart);
  }

  /**
   * Rolls up [hourStart, hourStart + 1 h) into `provider_call_stats_hourly`.
   * Idempotent: re-running a bucket is a no-op (ON CONFLICT DO NOTHING on the
   * 5-key PK). Exposed as a test seam (e2e uses explicit windows).
   *
   * Boundaries are passed as UTC ISO strings, never raw Dates: a raw Date
   * parameter is serialized by pg in the host timezone, and Postgres drops
   * the offset when casting to a tz-less `timestamp` column — shifting the
   * window by the host offset on non-UTC hosts. ISO strings round-trip the
   * UTC wall clock that drizzle inserts (see e2e TZ regression coverage).
   */
  async runRollupForHour(hourStart: Date): Promise<void> {
    if (this.isRollingUp) return;
    this.isRollingUp = true;
    const startedAt = Date.now();
    try {
      const hourStartIso = hourStart.toISOString();
      const hourEndIso = new Date(hourStart.getTime() + 3_600_000).toISOString();
      const result = await db.execute(sql`
        WITH base AS (
          SELECT
            date_trunc('hour', created_at) AS hour_bucket,
            provider_id,
            operation,
            ok,
            COALESCE(error_code, 'none') AS error_code,
            provider_type,
            duration_ms,
            (metrics ->> 'ttftMs')::float8 AS ttft,
            (metrics ->> 'maxChunkGapMs')::float8 AS max_chunk_gap,
            (metrics ->> 'audioDurationMs')::float8 AS audio_duration
          FROM provider_call_logs
          WHERE created_at >= ${hourStartIso} AND created_at < ${hourEndIso}
        ),
        main_agg AS (
          SELECT
            hour_bucket,
            provider_id,
            operation,
            ok,
            error_code,
            COUNT(*)::bigint AS count,
            SUM(duration_ms)::bigint AS sum_duration_ms,
            MIN(duration_ms) AS min_duration_ms,
            MAX(duration_ms) AS max_duration_ms,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_duration_ms,
            COUNT(*) FILTER (WHERE max_chunk_gap > 10000)::int AS stalled_count,
            COUNT(*) FILTER (WHERE provider_type = 'tts' AND audio_duration > 0 AND duration_ms > audio_duration)::int AS rtf_over_1_count
          FROM base
          GROUP BY hour_bucket, provider_id, operation, ok, error_code
        ),
        ttft_agg AS (
          SELECT
            hour_bucket,
            provider_id,
            operation,
            ok,
            error_code,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY ttft) AS p50_ttft_ms,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY ttft) AS p95_ttft_ms,
            percentile_cont(0.99) WITHIN GROUP (ORDER BY ttft) AS p99_ttft_ms
          FROM base
          WHERE ttft IS NOT NULL
          GROUP BY hour_bucket, provider_id, operation, ok, error_code
        ),
        gap_agg AS (
          SELECT
            hour_bucket,
            provider_id,
            operation,
            ok,
            error_code,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY max_chunk_gap) AS p95_max_chunk_gap_ms
          FROM base
          WHERE max_chunk_gap IS NOT NULL
          GROUP BY hour_bucket, provider_id, operation, ok, error_code
        )
        INSERT INTO provider_call_stats_hourly
          (hour_bucket, provider_id, operation, ok, error_code,
           count, sum_duration_ms, min_duration_ms, max_duration_ms, p95_duration_ms,
           p50_ttft_ms, p95_ttft_ms, p99_ttft_ms, p95_max_chunk_gap_ms,
           stalled_count, rtf_over_1_count)
        SELECT
          m.hour_bucket, m.provider_id, m.operation, m.ok, m.error_code,
          m.count, m.sum_duration_ms, m.min_duration_ms, m.max_duration_ms, m.p95_duration_ms,
          t.p50_ttft_ms, t.p95_ttft_ms, t.p99_ttft_ms, g.p95_max_chunk_gap_ms,
          m.stalled_count, m.rtf_over_1_count
        FROM main_agg m
        LEFT JOIN ttft_agg t USING (hour_bucket, provider_id, operation, ok, error_code)
        LEFT JOIN gap_agg g USING (hour_bucket, provider_id, operation, ok, error_code)
        ON CONFLICT DO NOTHING
      `);
      logger.info(
        { hourStart: hourStart.toISOString(), rows: result.rowCount, durationMs: Date.now() - startedAt },
        'RetentionService hourly rollup completed',
      );
    } finally {
      this.isRollingUp = false;
    }
  }

  /**
   * Purges retention-target tables. `retentionDays` defaults to the
   * monitoring config value. `alert_events` / `fallback_events` /
   * `monitoring_config` are never touched. Exposed as a test seam.
   */
  async runPurgeNow(retentionDays?: number): Promise<void> {
    if (this.isPurging) return;
    this.isPurging = true;
    const startedAt = Date.now();
    try {
      const days = retentionDays ?? (await this.monitoringConfigService.get()).retentionDays;
      // ISO strings — never raw Date parameters (tz-less column + non-UTC host
      // would shift the cutoff by the host offset; see runRollupForHour).
      const cutoffIso = new Date(Date.now() - days * MS_PER_DAY).toISOString();
      const statsCutoffIso = new Date(Date.now() - 2 * days * MS_PER_DAY).toISOString();

      const logs = await db.execute(sql`DELETE FROM provider_call_logs WHERE created_at < ${cutoffIso}`);
      const health = await db.execute(sql`DELETE FROM health_checks WHERE created_at < ${cutoffIso}`);
      const samples = await db.execute(sql`DELETE FROM metric_samples WHERE created_at < ${cutoffIso}`);
      const stats = await db.execute(sql`DELETE FROM provider_call_stats_hourly WHERE hour_bucket < ${statsCutoffIso}`);

      logger.info(
        {
          days,
          purged: {
            provider_call_logs: logs.rowCount,
            health_checks: health.rowCount,
            metric_samples: samples.rowCount,
            provider_call_stats_hourly: stats.rowCount,
          },
          durationMs: Date.now() - startedAt,
        },
        'RetentionService purge completed',
      );
    } finally {
      this.isPurging = false;
    }
  }
}
