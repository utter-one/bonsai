import { inject, injectable } from 'tsyringe';
import { and, desc, eq, isNull, SQL, sql } from 'drizzle-orm';
import { db } from '../../db/index';
import { alertEvents, fallbackEvents, healthChecks, metricSamples, monitoringConfig, providerCallLogs, providers } from '../../db/schema';
import type { RequestContext } from '../RequestContext';
import { BaseService } from '../BaseService';
import { PERMISSIONS } from '../../permissions';
import { NotFoundError, OptimisticLockError, ValidationError } from '../../errors';
import { buildFilterCondition, buildOrderBy } from '../../utils/queryBuilder';
import { buildTextSearchCondition } from '../../utils/textSearch';
import { countRows, normalizeListLimit } from '../../utils/pagination';
import type { ListParams } from '../../http/contracts/common';
import type {
  AlertEventListResponse,
  AlertEventResponse,
  AlertRuleCatalogResponse,
  HealthHistoryListResponse,
  HealthSnapshotResponse,
  MetricCatalogResponse,
  MetricSeriesQuery,
  MetricSeriesResponse,
  FallbackEventListResponse,
  MonitoringConfig,
  MonitoringConfigResponse,
  MonitoringConfigUpdateRequest,
  ProviderCallListResponse,
  ProviderStatsQuery,
  ProviderStatsResponse,
  ProvidersMonitoringResponse,
} from '../../http/contracts/monitoring';
import { alertEventListResponseSchema, alertEventResponseSchema, alertRuleCatalogResponseSchema, fallbackEventListResponseSchema, healthCheckResponseSchema, healthHistoryListResponseSchema, healthSnapshotResponseSchema, metricCatalogResponseSchema, metricSeriesResponseSchema, monitoringConfigResponseSchema, monitoringConfigSchema, providerCallListResponseSchema, providerStatsResponseSchema, providersMonitoringResponseSchema } from '../../http/contracts/monitoring';
import { AuditService } from '../AuditService';
import { buildRuleCatalog } from './AlertEvents';
import { buildMetricCatalog } from './MetricsRegistry';
import { CircuitBreakerRegistry } from './CircuitBreakerRegistry';
import { HealthCheckService } from './HealthCheckService';
import { MonitoringConfigService } from './MonitoringConfigService';
import logger from '../../utils/logger';

/** Rolling window for GET /api/monitoring/providers. */
const PROVIDERS_ROLLING_WINDOW_MINUTES = 15;

/** Max from/to span for provider-stats and metrics series (raw-log scans stay cheap). */
const MAX_STATS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

interface ProvidersRollingRow {
  provider_id: string;
  calls: number;
  ok_count: number;
  p95_duration_ms: number | null;
}

interface ProvidersErrorCodesRow {
  provider_id: string;
  error_code: string;
  code_count: number;
}

interface ProviderStatsRow {
  bucket: string;
  provider_id: string;
  operation: string;
  count: number;
  sum_duration_ms: number;
  min_duration_ms: number;
  max_duration_ms: number;
  p50_ttft_ms: number | null;
  p95_ttft_ms: number | null;
  p99_ttft_ms: number | null;
  p95_max_chunk_gap_ms: number | null;
  stalled_count: number;
  rtf_over_1_count: number;
}

interface MetricSampleBucketRow {
  labels: Record<string, string>;
  bucket_epoch: string; // epoch seconds (bigint) — TZ-agnostic, reconstructed in JS
  count: number;
  sum: number | null;
  min: number | null;
  max: number | null;
}

/**
 * P1-08 — read-only monitoring API surface (PROPOSAL §3.6) + P2-03 — alert
 * history/acknowledge + monitoring config management.
 *
 * Every method is guarded by `requirePermission(context, SYSTEM_MONITORING)`
 * (defense in depth — the controller checks the same permission). Timestamps are
 * read as `::text` and reconstructed with an explicit Z marker: pg parses tz-less
 * timestamp results as host-local (P1-06 TZ lesson). Window boundaries are passed
 * to raw SQL as UTC ISO strings, never raw Dates.
 */
@injectable()
export class MonitoringService extends BaseService {
  constructor(
    @inject(HealthCheckService) private readonly healthCheckService: HealthCheckService,
    @inject(MonitoringConfigService) private readonly monitoringConfigService: MonitoringConfigService,
    @inject(AuditService) private readonly auditService: AuditService,
    @inject(CircuitBreakerRegistry) private readonly breakerRegistry: CircuitBreakerRegistry,
  ) {
    super();
  }

  /**
   * Current in-memory health snapshot (no DB).
   */
  async getHealthSnapshot(context: RequestContext): Promise<HealthSnapshotResponse> {
    this.requirePermission(context, PERMISSIONS.SYSTEM_MONITORING);
    logger.debug({ operatorId: context.operatorId }, 'Getting health snapshot');
    return healthSnapshotResponseSchema.parse(this.healthCheckService.getSnapshot());
  }

  /**
   * Persisted health history, newest first. Filters: check/checkName, status, latencyMs, createdAt.
   */
  async listHealthHistory(context: RequestContext, params?: ListParams): Promise<HealthHistoryListResponse> {
    this.requirePermission(context, PERMISSIONS.SYSTEM_MONITORING);
    logger.debug({ params }, 'Listing health history');

    const offset = params?.offset ?? 0;
    const limit = normalizeListLimit(params?.limit);

    const columnMap = {
      id: healthChecks.id,
      check: healthChecks.checkName,
      checkName: healthChecks.checkName,
      status: healthChecks.status,
      latencyMs: healthChecks.latencyMs,
      createdAt: healthChecks.createdAt,
    };

    const conditions: SQL[] = [];
    if (params?.filters) {
      for (const [field, filter] of Object.entries(params.filters)) {
        const condition = buildFilterCondition(field, filter, columnMap, logger);
        if (condition) conditions.push(condition);
      }
    }
    if (params?.textSearch) {
      const searchCondition = buildTextSearchCondition(params.textSearch, [healthChecks.checkName, healthChecks.status]);
      if (searchCondition) conditions.push(searchCondition);
    }

    const orderByClause = buildOrderBy(params?.orderBy, columnMap);
    const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

    const total = await countRows(healthChecks, whereCondition);
    const rows = await db.query.healthChecks.findMany({
      where: whereCondition,
      orderBy: orderByClause.length > 0 ? orderByClause : [desc(healthChecks.createdAt)],
      limit,
      offset,
    });

    return healthHistoryListResponseSchema.parse({
      items: rows.map((row) => healthCheckResponseSchema.parse(row)),
      total,
      offset,
      limit,
    });
  }

  /**
   * Per-provider overview: identity + latest probe status (in-memory snapshot)
   * + rolling 15-minute call-log window (count, ok rate, p95, top error codes).
   */
  async getProvidersOverview(context: RequestContext): Promise<ProvidersMonitoringResponse> {
    this.requirePermission(context, PERMISSIONS.SYSTEM_MONITORING);
    logger.debug({ operatorId: context.operatorId }, 'Getting providers overview');

    const providerRows = await db.select({
      id: providers.id,
      name: providers.name,
      providerType: providers.providerType,
      apiType: providers.apiType,
    }).from(providers);

    // Latest check per provider from the in-memory snapshot (check name: provider:<id>).
    const snapshot = this.healthCheckService.getSnapshot();
    const probeStatusById = new Map<string, string>();
    for (const check of snapshot.checks) {
      if (check.name.startsWith('provider:')) {
        probeStatusById.set(check.name.slice('provider:'.length), check.status);
      }
    }

    // Rolling window aggregates + top error codes, computed entirely in SQL
    // (now() - interval — no JS Date parameters, P1-06 TZ lesson).
    const rollingRows = (await db.execute(sql`
      SELECT
        provider_id,
        COUNT(*)::int AS calls,
        COUNT(*) FILTER (WHERE ok)::int AS ok_count,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_duration_ms
      FROM provider_call_logs
      WHERE created_at >= now() - make_interval(mins => ${PROVIDERS_ROLLING_WINDOW_MINUTES})
      GROUP BY provider_id
    `)).rows as unknown as ProvidersRollingRow[];

    const errorCodeRows = (await db.execute(sql`
      SELECT provider_id, error_code, COUNT(*)::int AS code_count
      FROM provider_call_logs
      WHERE ok = false
        AND created_at >= now() - make_interval(mins => ${PROVIDERS_ROLLING_WINDOW_MINUTES})
      GROUP BY provider_id, error_code
      ORDER BY provider_id, code_count DESC
    `)).rows as unknown as ProvidersErrorCodesRow[];

    const rollingById = new Map<string, ProvidersRollingRow>();
    for (const row of rollingRows) rollingById.set(row.provider_id, row);
    const errorCodesByProvider = new Map<string, Array<[string, number]>>();
    for (const row of errorCodeRows) {
      const list = errorCodesByProvider.get(row.provider_id) ?? [];
      if (list.length < 3) list.push([row.error_code, row.code_count]);
      errorCodesByProvider.set(row.provider_id, list);
    }

    // P3-01: in-memory breaker state per provider (null when no calls recorded yet).
    const breakerSnapshots = this.breakerRegistry.snapshot();

    const overview = providerRows.map((provider) => {
      const rolling = rollingById.get(provider.id);
      const breaker = breakerSnapshots[provider.id];
      return {
        id: provider.id,
        name: provider.name,
        providerType: provider.providerType,
        apiType: provider.apiType,
        probeStatus: probeStatusById.get(provider.id) ?? null,
        rolling: {
          windowMinutes: PROVIDERS_ROLLING_WINDOW_MINUTES,
          calls: rolling?.calls ?? 0,
          okRate: rolling && rolling.calls > 0 ? rolling.ok_count / rolling.calls : null,
          p95DurationMs: rolling?.p95_duration_ms ?? null,
          topErrorCodes: errorCodesByProvider.get(provider.id) ?? [],
        },
        circuitBreaker: breaker
          ? { state: breaker.state, failuresInWindow: breaker.failuresInWindow, lastStateChangeAt: breaker.lastStateChangeAt, opensInLast24h: breaker.opensInLast24h }
          : null,
      };
    });

    return providersMonitoringResponseSchema.parse({ providers: overview });
  }

  /**
   * Raw provider call logs. Filters: providerId, providerType, apiType, operation, model,
   * projectId, conversationId, ok, errorCode, statusHttp, durationMs, fallbackProviderId, createdAt.
   */
  async listProviderCalls(context: RequestContext, params?: ListParams): Promise<ProviderCallListResponse> {
    this.requirePermission(context, PERMISSIONS.SYSTEM_MONITORING);
    logger.debug({ params }, 'Listing provider calls');

    const offset = params?.offset ?? 0;
    const limit = normalizeListLimit(params?.limit);

    const columnMap = {
      id: providerCallLogs.id,
      providerId: providerCallLogs.providerId,
      providerType: providerCallLogs.providerType,
      apiType: providerCallLogs.apiType,
      operation: providerCallLogs.operation,
      model: providerCallLogs.model,
      projectId: providerCallLogs.projectId,
      conversationId: providerCallLogs.conversationId,
      ok: providerCallLogs.ok,
      errorCode: providerCallLogs.errorCode,
      statusHttp: providerCallLogs.statusHttp,
      durationMs: providerCallLogs.durationMs,
      fallbackProviderId: providerCallLogs.fallbackProviderId,
      createdAt: providerCallLogs.createdAt,
    };

    const conditions: SQL[] = [];
    if (params?.filters) {
      for (const [field, filter] of Object.entries(params.filters)) {
        const condition = buildFilterCondition(field, filter, columnMap, logger);
        if (condition) conditions.push(condition);
      }
    }
    if (params?.textSearch) {
      const searchCondition = buildTextSearchCondition(params.textSearch, [
        providerCallLogs.operation,
        providerCallLogs.model,
        providerCallLogs.providerId,
        providerCallLogs.conversationId,
      ]);
      if (searchCondition) conditions.push(searchCondition);
    }

    const orderByClause = buildOrderBy(params?.orderBy, columnMap);
    const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

    const total = await countRows(providerCallLogs, whereCondition);
    const rows = await db.query.providerCallLogs.findMany({
      where: whereCondition,
      orderBy: orderByClause.length > 0 ? orderByClause : [desc(providerCallLogs.createdAt)],
      limit,
      offset,
    });

    return providerCallListResponseSchema.parse({
      items: rows,
      total,
      offset,
      limit,
    });
  }

  /**
   * Paginated fallback_events (P3-06): every failover transition the wrappers
   * record — which provider failed, which one served instead, why, and whether
   * the fallback ultimately succeeded. Newest first by default.
   */
  async listFallbackEvents(context: RequestContext, params?: ListParams): Promise<FallbackEventListResponse> {
    this.requirePermission(context, PERMISSIONS.SYSTEM_MONITORING);
    logger.debug({ params }, 'Listing fallback events');

    const offset = params?.offset ?? 0;
    const limit = normalizeListLimit(params?.limit);

    const columnMap = {
      id: fallbackEvents.id,
      providerId: fallbackEvents.providerId,
      fallbackProviderId: fallbackEvents.fallbackProviderId,
      providerType: fallbackEvents.providerType,
      operation: fallbackEvents.operation,
      reason: fallbackEvents.reason,
      projectId: fallbackEvents.projectId,
      conversationId: fallbackEvents.conversationId,
      success: fallbackEvents.success,
      createdAt: fallbackEvents.createdAt,
    };

    const conditions: SQL[] = [];
    if (params?.filters) {
      for (const [field, filter] of Object.entries(params.filters)) {
        const condition = buildFilterCondition(field, filter, columnMap, logger);
        if (condition) conditions.push(condition);
      }
    }
    if (params?.textSearch) {
      const searchCondition = buildTextSearchCondition(params.textSearch, [
        fallbackEvents.providerId,
        fallbackEvents.fallbackProviderId,
        fallbackEvents.operation,
        fallbackEvents.reason,
      ]);
      if (searchCondition) conditions.push(searchCondition);
    }

    const orderByClause = buildOrderBy(params?.orderBy, columnMap);
    const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

    const total = await countRows(fallbackEvents, whereCondition);
    const rows = await db.query.fallbackEvents.findMany({
      where: whereCondition,
      orderBy: orderByClause.length > 0 ? orderByClause : [desc(fallbackEvents.createdAt)],
      limit,
      offset,
    });

    return fallbackEventListResponseSchema.parse({
      items: rows,
      total,
      offset,
      limit,
    });
  }

  /**
   * Aggregated call stats, one row per (bucket, providerId, operation). All values are
   * recomputed from provider_call_logs over the window (P1-08 soundness finding 1):
   * the hourly rollup cannot merge percentiles across its ok/errorCode PK dimension and
   * has no row for the live partial hour yet. Percentile expressions mirror the P1-06
   * rollup CTEs (ttft / chunk-gap over non-NULL jsonb-extracted values).
   */
  async getProviderStats(context: RequestContext, query: ProviderStatsQuery): Promise<ProviderStatsResponse> {
    this.requirePermission(context, PERMISSIONS.SYSTEM_MONITORING);
    logger.debug({ query }, 'Getting provider stats');

    this.assertWindow(query.from, query.to);

    const granularity = query.groupBy; // 'hour' | 'day'
    const fromIso = query.from.toISOString();
    const toIso = query.to.toISOString();

    // Dynamic WHERE fragments (optional providerId / operation).
    const providerCondition = query.providerId ? sql`AND provider_id = ${query.providerId}` : sql``;
    const operationCondition = query.operation ? sql`AND operation = ${query.operation}` : sql``;

    const result = await db.execute(sql`
      WITH base AS (
        SELECT
          date_trunc(${granularity}, created_at) AS bucket,
          provider_id,
          operation,
          duration_ms,
          provider_type,
          (metrics ->> 'ttftMs')::float8 AS ttft,
          (metrics ->> 'maxChunkGapMs')::float8 AS max_chunk_gap,
          (metrics ->> 'audioDurationMs')::float8 AS audio_duration
        FROM provider_call_logs
        WHERE created_at >= ${fromIso}
          AND created_at < ${toIso}
          ${providerCondition}
          ${operationCondition}
      ),
      main_agg AS (
        SELECT
          bucket,
          provider_id,
          operation,
          COUNT(*)::bigint AS count,
          SUM(duration_ms)::bigint AS sum_duration_ms,
          MIN(duration_ms) AS min_duration_ms,
          MAX(duration_ms) AS max_duration_ms,
          COUNT(*) FILTER (WHERE max_chunk_gap > 10000)::int AS stalled_count,
          COUNT(*) FILTER (WHERE provider_type = 'tts' AND audio_duration > 0 AND duration_ms > audio_duration)::int AS rtf_over_1_count
        FROM base
        GROUP BY bucket, provider_id, operation
      ),
      ttft_agg AS (
        SELECT
          bucket,
          provider_id,
          operation,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY ttft) AS p50_ttft_ms,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY ttft) AS p95_ttft_ms,
          percentile_cont(0.99) WITHIN GROUP (ORDER BY ttft) AS p99_ttft_ms
        FROM base
        WHERE ttft IS NOT NULL
        GROUP BY bucket, provider_id, operation
      ),
      gap_agg AS (
        SELECT
          bucket,
          provider_id,
          operation,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY max_chunk_gap) AS p95_max_chunk_gap_ms
        FROM base
        WHERE max_chunk_gap IS NOT NULL
        GROUP BY bucket, provider_id, operation
      )
      SELECT
        m.bucket::text AS bucket,
        m.provider_id,
        m.operation,
        m.count,
        m.sum_duration_ms,
        m.min_duration_ms,
        m.max_duration_ms,
        t.p50_ttft_ms,
        t.p95_ttft_ms,
        t.p99_ttft_ms,
        g.p95_max_chunk_gap_ms,
        m.stalled_count,
        m.rtf_over_1_count
      FROM main_agg m
      LEFT JOIN ttft_agg t USING (bucket, provider_id, operation)
      LEFT JOIN gap_agg g USING (bucket, provider_id, operation)
      ORDER BY m.bucket, m.provider_id, m.operation
    `);

    // NB: pg returns bigint columns as strings — coerce (window bounds keep values well inside Number range).
    const buckets = (result.rows as unknown as ProviderStatsRow[]).map((row) => ({
      bucket: new Date(`${row.bucket.replace(' ', 'T')}Z`),
      providerId: row.provider_id,
      operation: row.operation,
      count: Number(row.count),
      sumDurationMs: Number(row.sum_duration_ms),
      minDurationMs: row.min_duration_ms,
      maxDurationMs: row.max_duration_ms,
      p50TtftMs: row.p50_ttft_ms,
      p95TtftMs: row.p95_ttft_ms,
      p99TtftMs: row.p99_ttft_ms,
      p95MaxChunkGapMs: row.p95_max_chunk_gap_ms,
      stalledCount: row.stalled_count,
      rtfOver1Count: row.rtf_over_1_count,
    }));

    return providerStatsResponseSchema.parse({
      from: query.from,
      to: query.to,
      groupBy: query.groupBy,
      buckets,
    });
  }

  /**
   * Generic time series over metric_samples: one series per exact label set,
   * points bucketed at the requested step, oldest first. Sample encoding is
   * per-kind (counters=delta, gauges=(1,v,v,v), histograms=(Δc,Δs,min,max)) —
   * the endpoint just buckets/sums; the consumer knows the metric kind.
   */
  async getMetricSeries(context: RequestContext, query: MetricSeriesQuery): Promise<MetricSeriesResponse> {
    this.requirePermission(context, PERMISSIONS.SYSTEM_MONITORING);
    logger.debug({ query }, 'Getting metric series');

    this.assertWindow(query.from, query.to);

    const stepSeconds = query.step === '1m' ? 60 : query.step === '1h' ? 3600 : 900;
    const fromIso = query.from.toISOString();
    const toIso = query.to.toISOString();
    const labelsJson = query.labels ? JSON.stringify(query.labels) : null;

    // The bucket expression is computed once in the CTE: a parameterized expression
    // repeated across SELECT and GROUP BY is not proven identical by Postgres in
    // prepared statements (42803). The CTE column also avoids the ORDER BY
    // ambiguity where an alias named `bucket` resolves to the source column.
    const result = await db.execute(sql`
      WITH b AS (
        SELECT
          labels,
          count,
          sum,
          min,
          max,
          ((extract(epoch from bucket) / ${stepSeconds})::bigint) * ${stepSeconds} AS bucket_epoch
        FROM metric_samples
        WHERE name = ${query.name}
          AND bucket >= ${fromIso}
          AND bucket < ${toIso}
          ${labelsJson ? sql`AND labels = ${labelsJson}::jsonb` : sql``}
      )
      SELECT
        labels,
        bucket_epoch,
        SUM(count)::bigint AS count,
        SUM(sum) AS sum,
        MIN(min) AS min,
        MAX(max) AS max
      FROM b
      GROUP BY labels, bucket_epoch
      ORDER BY bucket_epoch, labels::text
    `);

    const rows = result.rows as unknown as MetricSampleBucketRow[];
    const seriesMap = new Map<string, { labels: Record<string, string>; points: Array<{ bucket: Date; count: number; sum: number | null; min: number | null; max: number | null }> }>();
    for (const row of rows) {
      const key = JSON.stringify(row.labels);
      const series = seriesMap.get(key) ?? { labels: row.labels, points: [] };
      series.points.push({
        bucket: new Date(Number(row.bucket_epoch) * 1000),
        // pg returns bigint columns as strings — coerce.
        count: Number(row.count),
        sum: row.sum,
        min: row.min,
        max: row.max,
      });
      seriesMap.set(key, series);
    }

    return metricSeriesResponseSchema.parse({
      name: query.name,
      from: query.from,
      to: query.to,
      step: query.step,
      series: [...seriesMap.values()],
    });
  }

  /**
   * GET /api/monitoring/metric-catalog
   * Static catalog of every registered metric — served from the closed
   * MetricsRegistry config so it never drifts from what the series endpoint
   * and the Prometheus exporter accept (same pattern as getRuleCatalog).
   */
  getMetricCatalog(context: RequestContext): MetricCatalogResponse {
    this.requirePermission(context, PERMISSIONS.SYSTEM_MONITORING);
    logger.debug({ operatorId: context.operatorId }, 'Getting metric catalog');
    return metricCatalogResponseSchema.parse({ metrics: buildMetricCatalog() });
  }

  // ---------------------------------------------------------------------
  // P2-03 — alerts history + acknowledge
  // ---------------------------------------------------------------------

  /**
   * Paginated alert events, newest fired_at first by default.
   * Filters: id, ruleId, scopeKey, severity, status, firedAt, resolvedAt, ackedAt;
   * textSearch over message + scopeKey + ruleId.
   */
  async listAlerts(context: RequestContext, params?: ListParams): Promise<AlertEventListResponse> {
    this.requirePermission(context, PERMISSIONS.SYSTEM_MONITORING);
    logger.debug({ params }, 'Listing alert events');

    const offset = params?.offset ?? 0;
    const limit = normalizeListLimit(params?.limit);

    const columnMap = {
      id: alertEvents.id,
      ruleId: alertEvents.ruleId,
      scopeKey: alertEvents.scopeKey,
      severity: alertEvents.severity,
      status: alertEvents.status,
      firedAt: alertEvents.firedAt,
      resolvedAt: alertEvents.resolvedAt,
      ackedAt: alertEvents.ackedAt,
    };

    const conditions: SQL[] = [];
    if (params?.filters) {
      for (const [field, filter] of Object.entries(params.filters)) {
        const condition = buildFilterCondition(field, filter, columnMap, logger);
        if (condition) conditions.push(condition);
      }
    }
    if (params?.textSearch) {
      const searchCondition = buildTextSearchCondition(params.textSearch, [
        alertEvents.message,
        alertEvents.scopeKey,
        alertEvents.ruleId,
      ]);
      if (searchCondition) conditions.push(searchCondition);
    }

    const orderByClause = buildOrderBy(params?.orderBy, columnMap);
    const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

    const total = await countRows(alertEvents, whereCondition);
    const rows = await db.query.alertEvents.findMany({
      where: whereCondition,
      orderBy: orderByClause.length > 0 ? orderByClause : [desc(alertEvents.firedAt)],
      limit,
      offset,
    });

    return alertEventListResponseSchema.parse({
      items: rows.map((row) => alertEventResponseSchema.parse(row)),
      total,
      offset,
      limit,
    });
  }

  /** Single alert event; 404 when missing. */
  async getAlert(context: RequestContext, id: string): Promise<AlertEventResponse> {
    this.requirePermission(context, PERMISSIONS.SYSTEM_MONITORING);
    const rows = await db.select().from(alertEvents).where(eq(alertEvents.id, id));
    if (rows.length === 0) {
      throw new NotFoundError(`Alert event '${id}' not found`);
    }
    return alertEventResponseSchema.parse(rows[0]);
  }

  /**
   * Stamp acked_at + acked_by exactly once (idempotent — a second ack returns
   * the existing stamps without overwriting them). Writes an audit entry on the
   * first ack only.
   */
  async acknowledgeAlert(context: RequestContext, id: string): Promise<AlertEventResponse> {
    this.requirePermission(context, PERMISSIONS.SYSTEM_MONITORING);
    logger.debug({ operatorId: context.operatorId, alertId: id }, 'Acknowledging alert event');

    const now = new Date();
    const updated = await db
      .update(alertEvents)
      .set({ ackedAt: now, ackedBy: context.operatorId })
      .where(and(eq(alertEvents.id, id), isNull(alertEvents.ackedAt)))
      .returning();

    if (updated.length > 0) {
      await this.auditService.logChange({
        userId: context.operatorId,
        action: 'ACK',
        entityType: 'alert_event',
        entityId: id,
        newEntity: { ackedAt: now, ackedBy: context.operatorId },
      });
      return alertEventResponseSchema.parse(updated[0]);
    }

    // Guarded update matched nothing: either the id is unknown (404) or the
    // alert was already acknowledged (idempotent 200, no overwrite).
    const rows = await db.select().from(alertEvents).where(eq(alertEvents.id, id));
    if (rows.length === 0) {
      throw new NotFoundError(`Alert event '${id}' not found`);
    }
    return alertEventResponseSchema.parse(rows[0]);
  }

  /**
   * Permanently delete an alert event — for stalled alerts or known
   * situations without an easy resolution (e.g. a deleted provider).
   * Returns the deleted row. The engine's in-memory state machine is
   * untouched: if the condition still holds it may fire a NEW row later —
   * disable the rule in the monitoring config to silence it permanently.
   */
  async deleteAlert(context: RequestContext, id: string): Promise<AlertEventResponse> {
    this.requirePermission(context, PERMISSIONS.SYSTEM_MONITORING);
    logger.debug({ operatorId: context.operatorId, alertId: id }, 'Deleting alert event');

    const rows = await db.select().from(alertEvents).where(eq(alertEvents.id, id));
    if (rows.length === 0) {
      throw new NotFoundError(`Alert event '${id}' not found`);
    }

    await db.delete(alertEvents).where(eq(alertEvents.id, id));
    await this.auditService.logDelete(
      'alert_event',
      id,
      { status: rows[0].status, ruleId: rows[0].ruleId, scopeKey: rows[0].scopeKey, firedAt: rows[0].firedAt },
      context.operatorId,
    );
    return alertEventResponseSchema.parse(rows[0]);
  }

  // ---------------------------------------------------------------------
  // P2-03 — monitoring config (read + optimistic-locked full replace)
  // ---------------------------------------------------------------------

  /** Current config + row metadata (version for optimistic locking). */
  /**
   * GET /api/monitoring/rules — static catalog of all built-in alert rules
   * (id, scope, severity, summary, defaultParams). Projected from the engine
   * rule registry, so it can never drift from the evaluators.
   */
  getRuleCatalog(context: RequestContext): AlertRuleCatalogResponse {
    this.requirePermission(context, PERMISSIONS.SYSTEM_MONITORING);
    logger.debug({ operatorId: context.operatorId }, 'Getting alert rule catalog');
    return alertRuleCatalogResponseSchema.parse({ rules: buildRuleCatalog() });
  }

  async getConfig(context: RequestContext): Promise<MonitoringConfigResponse> {
    this.requirePermission(context, PERMISSIONS.SYSTEM_MONITORING);
    // get() validates the row (and creates the default row on first boot).
    const config = await this.monitoringConfigService.get();
    const rows = await db.select().from(monitoringConfig).where(eq(monitoringConfig.id, 'global'));
    const row = rows[0];
    if (!row) {
      throw new OptimisticLockError('Monitoring config row is missing');
    }
    return monitoringConfigResponseSchema.parse({
      config,
      version: row.version,
      updatedAt: row.updatedAt,
    });
  }

  /**
   * Full-replace config under optimistic lock. Validates (ZodError → 400),
   * version-mismatch (OptimisticLockError → 409), persists + refreshes the
   * shared config cache (MonitoringConfigService.save — engine and notifiers
   * observe the new config on their next evaluation/delivery, no restart),
   * and writes a sanitized audit entry (webhook URLs carry tokens — they are
   * replaced by `hasUrl: true` in the before/after summaries).
   */
  async updateConfig(context: RequestContext, body: MonitoringConfigUpdateRequest): Promise<MonitoringConfigResponse> {
    this.requirePermission(context, PERMISSIONS.SYSTEM_MONITORING);
    logger.debug({ operatorId: context.operatorId, version: body.version }, 'Updating monitoring config');

    const before = await this.monitoringConfigService.get();
    const parsed = monitoringConfigSchema.parse(body.config);
    await this.monitoringConfigService.save(parsed, body.version);
    await this.auditService.logChange({
      userId: context.operatorId,
      action: 'UPDATE_MONITORING_CONFIG',
      entityType: 'monitoring_config',
      entityId: 'global',
      oldEntity: { version: body.version, config: this.configAuditSummary(before) },
      newEntity: { version: body.version + 1, config: this.configAuditSummary(parsed) },
    });

    const rows = await db.select().from(monitoringConfig).where(eq(monitoringConfig.id, 'global'));
    const row = rows[0];
    if (!row) {
      throw new OptimisticLockError('Monitoring config row is missing');
    }
    return monitoringConfigResponseSchema.parse({
      config: parsed,
      version: row.version,
      updatedAt: row.updatedAt,
    });
  }

  // ---------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------

  /**
   * Audit-safe config summary (finding 5): the webhook `url` may carry a token
   * and is replaced by `hasUrl: true`; everything else (including rule
   * overrides, email recipients, channel provider ids) is not a secret.
   */
  private configAuditSummary(config: MonitoringConfig): Record<string, unknown> {
    return {
      retentionDays: config.retentionDays,
      probeSettings: config.probeSettings,
      alerting: config.alerting,
      rules: config.rules,
      notifiers: config.notifiers.map((n) => ({
        id: n.id,
        type: n.type,
        enabled: n.enabled,
        ...(n.minSeverity !== undefined ? { minSeverity: n.minSeverity } : {}),
        ...(n.channelProviderId !== undefined ? { channelProviderId: n.channelProviderId } : {}),
        ...(n.to !== undefined ? { to: n.to } : {}),
        ...(n.url !== undefined ? { hasUrl: true } : {}),
      })),
    };
  }

  /** Window must be non-empty and bounded (raw-log scans stay cheap). */
  private assertWindow(from: Date, to: Date): void {
    if (to.getTime() <= from.getTime()) {
      throw new ValidationError('to must be after from', []);
    }
    if (to.getTime() - from.getTime() > MAX_STATS_WINDOW_MS) {
      throw new ValidationError('Window too large: maximum span is 14 days (from -> to)', []);
    }
  }
}
