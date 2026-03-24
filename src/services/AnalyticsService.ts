import { singleton } from 'tsyringe';
import { sql } from 'drizzle-orm';
import { db } from '../db/index';
import { BaseService } from './BaseService';
import type { RequestContext } from './RequestContext';
import { PERMISSIONS } from '../permissions';
import type { AnalyticsQuery, LatencyStatsResponse, LatencyPercentilesResponse, LatencyMetric, PercentileSet, LatencyTrendQuery, LatencyTrendResponse, ConversationTimelineResponse, ConversationTimelineTurn } from '../http/contracts/analytics';

/**
 * Service for computing analytics and aggregations over conversation timing data.
 * All timing values are read from the JSONB `event_data -> 'metadata'` of message events.
 */
@singleton()
export class AnalyticsService extends BaseService {

  /**
   * Returns aggregated latency statistics (avg, median, p95, min, max) for key turn-level metrics.
   * @param projectId - Project to query
   * @param query - Date range and optional filters
   * @param context - Request context for authorization
   */
  async getLatencyStats(projectId: string, query: AnalyticsQuery, context: RequestContext): Promise<LatencyStatsResponse> {
    this.requirePermission(context, PERMISSIONS.ANALYTICS_READ);

    const { whereClause } = this.buildAssistantMessageWhere(projectId, query);

    const result = await db.execute(sql.raw(`
      SELECT
        count(*)::int AS total_turns,
        ${this.buildMetricAggSQL('totalTurnDurationMs')},
        ${this.buildMetricAggSQL('timeToFirstTokenMs')},
        ${this.buildMetricAggSQL('timeToFirstTokenFromTurnStartMs')},
        ${this.buildMetricAggSQL('timeToFirstAudioMs')},
        ${this.buildMetricAggSQL('llmDurationMs')},
        ${this.buildMetricAggSQL('ttsDurationMs')},
        ${this.buildMetricAggSQL('moderationDurationMs')},
        ${this.buildMetricAggSQL('processingDurationMs', true)},
        ${this.buildMetricAggSQL('actionsDurationMs', true)},
        ${this.buildMetricAggSQL('asrDurationMs', true)}
      FROM conversation_events ce
      ${this.buildUserJoin()}
      WHERE ${whereClause}
    `));

    const row = result.rows[0] as Record<string, any>;
    return {
      totalTurns: row.total_turns ?? 0,
      totalTurnDurationMs: this.extractMetric(row, 'totalTurnDurationMs'),
      timeToFirstTokenMs: this.extractMetric(row, 'timeToFirstTokenMs'),
      timeToFirstTokenFromTurnStartMs: this.extractMetric(row, 'timeToFirstTokenFromTurnStartMs'),
      timeToFirstAudioMs: this.extractMetric(row, 'timeToFirstAudioMs'),
      llmDurationMs: this.extractMetric(row, 'llmDurationMs'),
      ttsDurationMs: this.extractMetric(row, 'ttsDurationMs'),
      moderationDurationMs: this.extractMetric(row, 'moderationDurationMs'),
      processingDurationMs: this.extractMetric(row, 'processingDurationMs'),
      actionsDurationMs: this.extractMetric(row, 'actionsDurationMs'),
      asrDurationMs: this.extractMetric(row, 'asrDurationMs'),
    };
  }

  /**
   * Returns percentile distributions (p50, p75, p90, p95, p99) for key turn-level metrics.
   * @param projectId - Project to query
   * @param query - Date range and optional filters
   * @param context - Request context for authorization
   */
  async getLatencyPercentiles(projectId: string, query: AnalyticsQuery, context: RequestContext): Promise<LatencyPercentilesResponse> {
    this.requirePermission(context, PERMISSIONS.ANALYTICS_READ);

    const { whereClause } = this.buildAssistantMessageWhere(projectId, query);

    const result = await db.execute(sql.raw(`
      SELECT
        count(*)::int AS total_turns,
        ${this.buildPercentileSQL('totalTurnDurationMs')},
        ${this.buildPercentileSQL('timeToFirstTokenMs')},
        ${this.buildPercentileSQL('timeToFirstTokenFromTurnStartMs')},
        ${this.buildPercentileSQL('timeToFirstAudioMs')},
        ${this.buildPercentileSQL('llmDurationMs')}
      FROM conversation_events ce
      WHERE ${whereClause}
    `));

    const row = result.rows[0] as Record<string, any>;
    return {
      totalTurns: row.total_turns ?? 0,
      totalTurnDurationMs: this.extractPercentiles(row, 'totalTurnDurationMs'),
      timeToFirstTokenMs: this.extractPercentiles(row, 'timeToFirstTokenMs'),
      timeToFirstTokenFromTurnStartMs: this.extractPercentiles(row, 'timeToFirstTokenFromTurnStartMs'),
      timeToFirstAudioMs: this.extractPercentiles(row, 'timeToFirstAudioMs'),
      llmDurationMs: this.extractPercentiles(row, 'llmDurationMs'),
    };
  }

  /**
   * Returns a time-series of average latency values bucketed by the specified interval.
   * @param projectId - Project to query
   * @param query - Date range, optional filters, and bucket interval
   * @param context - Request context for authorization
   */
  async getLatencyTrend(projectId: string, query: LatencyTrendQuery, context: RequestContext): Promise<LatencyTrendResponse> {
    this.requirePermission(context, PERMISSIONS.ANALYTICS_READ);

    const { whereClause } = this.buildAssistantMessageWhere(projectId, query);
    const truncUnit = query.interval === 'hour' ? 'hour' : query.interval === 'week' ? 'week' : 'day';

    const result = await db.execute(sql.raw(`
      SELECT
        date_trunc('${truncUnit}', ce.timestamp) AS bucket,
        count(*)::int AS turn_count,
        avg((ce.event_data->'metadata'->>'totalTurnDurationMs')::numeric) AS avg_total_turn_duration_ms,
        avg((ce.event_data->'metadata'->>'timeToFirstTokenMs')::numeric) AS avg_time_to_first_token_ms,
        avg((ce.event_data->'metadata'->>'llmDurationMs')::numeric) AS avg_llm_duration_ms,
        avg((ce.event_data->'metadata'->>'timeToFirstAudioMs')::numeric) AS avg_time_to_first_audio_ms
      FROM conversation_events ce
      WHERE ${whereClause}
      GROUP BY bucket
      ORDER BY bucket ASC
    `));

    return {
      interval: query.interval,
      points: result.rows.map((row: any) => ({
        bucket: new Date(row.bucket).toISOString(),
        turnCount: row.turn_count,
        avgTotalTurnDurationMs: this.toNullableNumber(row.avg_total_turn_duration_ms),
        avgTimeToFirstTokenMs: this.toNullableNumber(row.avg_time_to_first_token_ms),
        avgLlmDurationMs: this.toNullableNumber(row.avg_llm_duration_ms),
        avgTimeToFirstAudioMs: this.toNullableNumber(row.avg_time_to_first_audio_ms),
      })),
    };
  }

  /**
   * Returns an ordered list of per-turn timing breakdowns for a specific conversation.
   * Links user and assistant message events using turnIndex to build a unified timeline.
   * @param projectId - Project to query
   * @param conversationId - Conversation to inspect
   * @param context - Request context for authorization
   */
  async getConversationTimeline(projectId: string, conversationId: string, context: RequestContext): Promise<ConversationTimelineResponse> {
    this.requirePermission(context, PERMISSIONS.ANALYTICS_READ);

    // Fetch all user and assistant message events for the conversation, ordered by timestamp
    const result = await db.execute(sql.raw(`
      SELECT
        ce.event_data->>'role' AS role,
        ce.timestamp,
        ce.event_data->'metadata' AS metadata
      FROM conversation_events ce
      WHERE ce.project_id = '${this.escapeParam(projectId)}'
        AND ce.conversation_id = '${this.escapeParam(conversationId)}'
        AND ce.event_type = 'message'
      ORDER BY ce.timestamp ASC
    `));

    // Group by turnIndex and merge user + assistant metadata
    const turnMap = new Map<number, ConversationTimelineTurn>();

    for (const row of result.rows as any[]) {
      const meta = row.metadata ?? {};
      const turnIndex = meta.turnIndex as number | undefined;
      if (turnIndex == null) continue;

      const existing = turnMap.get(turnIndex);
      if (row.role === 'user') {
        turnMap.set(turnIndex, {
          ...existing,
          turnIndex,
          timestamp: new Date(row.timestamp).toISOString(),
          source: meta.source ?? null,
          turnStartMs: this.toNullableNumber(meta.turnStartMs),
          asrStartMs: this.toNullableNumber(meta.asrStartMs),
          asrEndMs: this.toNullableNumber(meta.asrEndMs),
          asrDurationMs: this.toNullableNumber(meta.asrDurationMs),
          moderationStartMs: this.toNullableNumber(meta.moderationStartMs),
          moderationEndMs: this.toNullableNumber(meta.moderationEndMs),
          moderationDurationMs: this.toNullableNumber(meta.moderationDurationMs),
          fillerStartMs: this.toNullableNumber(meta.fillerStartMs),
          fillerEndMs: this.toNullableNumber(meta.fillerEndMs),
          fillerDurationMs: this.toNullableNumber(meta.fillerDurationMs),
          processingStartMs: this.toNullableNumber(meta.processingStartMs),
          processingEndMs: this.toNullableNumber(meta.processingEndMs),
          processingDurationMs: this.toNullableNumber(meta.processingDurationMs),
          knowledgeRetrievalStartMs: this.toNullableNumber(meta.knowledgeRetrievalStartMs),
          knowledgeRetrievalEndMs: this.toNullableNumber(meta.knowledgeRetrievalEndMs),
          knowledgeRetrievalDurationMs: this.toNullableNumber(meta.knowledgeRetrievalDurationMs),
          actionsStartMs: this.toNullableNumber(meta.actionsStartMs),
          actionsEndMs: this.toNullableNumber(meta.actionsEndMs),
          actionsDurationMs: this.toNullableNumber(meta.actionsDurationMs),
          timeToFirstTokenMs: existing?.timeToFirstTokenMs ?? null,
          timeToFirstTokenFromTurnStartMs: existing?.timeToFirstTokenFromTurnStartMs ?? null,
          timeToFirstAudioMs: existing?.timeToFirstAudioMs ?? null,
          llmStartMs: existing?.llmStartMs ?? null,
          llmEndMs: existing?.llmEndMs ?? null,
          firstTokenMs: existing?.firstTokenMs ?? null,
          firstAudioMs: existing?.firstAudioMs ?? null,
          llmDurationMs: existing?.llmDurationMs ?? null,
          ttsStartMs: existing?.ttsStartMs ?? null,
          ttsEndMs: existing?.ttsEndMs ?? null,
          ttsDurationMs: existing?.ttsDurationMs ?? null,
          turnEndMs: existing?.turnEndMs ?? null,
          totalTurnDurationMs: existing?.totalTurnDurationMs ?? null,
        });
      } else if (row.role === 'assistant') {
        const prev = turnMap.get(turnIndex) ?? {} as any;
        turnMap.set(turnIndex, {
          turnIndex,
          timestamp: prev.timestamp ?? new Date(row.timestamp).toISOString(),
          source: prev.source ?? null,
          turnStartMs: prev.turnStartMs ?? this.toNullableNumber(meta.turnStartMs),
          asrStartMs: prev.asrStartMs ?? null,
          asrEndMs: prev.asrEndMs ?? null,
          asrDurationMs: prev.asrDurationMs ?? null,
          moderationStartMs: prev.moderationStartMs ?? null,
          moderationEndMs: prev.moderationEndMs ?? null,
          moderationDurationMs: prev.moderationDurationMs ?? this.toNullableNumber(meta.moderationDurationMs),
          fillerStartMs: prev.fillerStartMs ?? null,
          fillerEndMs: prev.fillerEndMs ?? null,
          fillerDurationMs: prev.fillerDurationMs ?? null,
          processingStartMs: prev.processingStartMs ?? null,
          processingEndMs: prev.processingEndMs ?? null,
          processingDurationMs: prev.processingDurationMs ?? null,
          knowledgeRetrievalStartMs: prev.knowledgeRetrievalStartMs ?? null,
          knowledgeRetrievalEndMs: prev.knowledgeRetrievalEndMs ?? null,
          knowledgeRetrievalDurationMs: prev.knowledgeRetrievalDurationMs ?? null,
          actionsStartMs: prev.actionsStartMs ?? null,
          actionsEndMs: prev.actionsEndMs ?? null,
          actionsDurationMs: prev.actionsDurationMs ?? null,
          llmStartMs: this.toNullableNumber(meta.llmStartMs),
          llmEndMs: this.toNullableNumber(meta.llmEndMs),
          firstTokenMs: this.toNullableNumber(meta.firstTokenMs),
          firstAudioMs: this.toNullableNumber(meta.firstAudioMs),
          timeToFirstTokenMs: this.toNullableNumber(meta.timeToFirstTokenMs),
          timeToFirstTokenFromTurnStartMs: this.toNullableNumber(meta.timeToFirstTokenFromTurnStartMs),
          timeToFirstAudioMs: this.toNullableNumber(meta.timeToFirstAudioMs),
          llmDurationMs: this.toNullableNumber(meta.llmDurationMs),
          ttsStartMs: this.toNullableNumber(meta.ttsStartMs),
          ttsEndMs: this.toNullableNumber(meta.ttsEndMs),
          ttsDurationMs: this.toNullableNumber(meta.ttsDurationMs),
          turnEndMs: this.toNullableNumber(meta.turnEndMs),
          totalTurnDurationMs: this.toNullableNumber(meta.totalTurnDurationMs),
        });
      }
    }

    const turns = Array.from(turnMap.values()).sort((a, b) => a.turnIndex - b.turnIndex);
    return { conversationId, turns };
  }

  // ==================
  // Private helpers
  // ==================

  /**
   * Builds a WHERE clause for querying assistant message events with optional filters.
   * User-message metrics (processingDurationMs, actionsDurationMs, asrDurationMs) are joined via a correlated sub-select
   * when required by the `source` filter.
   */
  private buildAssistantMessageWhere(projectId: string, query: AnalyticsQuery): { whereClause: string } {
    const conditions: string[] = [
      `ce.project_id = '${this.escapeParam(projectId)}'`,
      `ce.event_type = 'message'`,
      `ce.event_data->>'role' = 'assistant'`,
    ];

    if (query.from) {
      conditions.push(`ce.timestamp >= '${query.from.toISOString()}'`);
    }
    if (query.to) {
      conditions.push(`ce.timestamp <= '${query.to.toISOString()}'`);
    }
    if (query.stageId) {
      conditions.push(`ce.conversation_id IN (SELECT id FROM conversations WHERE project_id = '${this.escapeParam(projectId)}' AND stage_id = '${this.escapeParam(query.stageId)}')`);
    }
    if (query.source) {
      conditions.push(`ue.event_data->'metadata'->>'source' = '${this.escapeParam(query.source)}'`);
    }

    return { whereClause: conditions.join(' AND ') };
  }

  /**
   * Generates a LEFT JOIN to the matching user message on the same turn (by turnIndex) for accessing
   * user-side metrics from assistant message rows.
   */
  private buildUserJoin(): string {
    return `LEFT JOIN LATERAL (
      SELECT ue_inner.event_data
      FROM conversation_events ue_inner
      WHERE ue_inner.project_id = ce.project_id
        AND ue_inner.conversation_id = ce.conversation_id
        AND ue_inner.event_type = 'message'
        AND ue_inner.event_data->>'role' = 'user'
        AND (ue_inner.event_data->'metadata'->>'turnIndex') = (ce.event_data->'metadata'->>'turnIndex')
      LIMIT 1
    ) ue ON true`;
  }

  /** Builds SQL aggregate expressions for a single metric (avg, median/p50, p95, min, max) */
  private buildMetricAggSQL(metric: string, fromUser = false): string {
    const alias = metric.toLowerCase();
    const src = fromUser
      ? `(ue.event_data->'metadata'->>'${metric}')::numeric`
      : `(ce.event_data->'metadata'->>'${metric}')::numeric`;
    return [
      `count(${src}) AS ${alias}_count`,
      `avg(${src}) AS ${alias}_avg`,
      `percentile_cont(0.5) WITHIN GROUP (ORDER BY ${src}) AS ${alias}_median`,
      `percentile_cont(0.95) WITHIN GROUP (ORDER BY ${src}) AS ${alias}_p95`,
      `min(${src}) AS ${alias}_min`,
      `max(${src}) AS ${alias}_max`,
    ].join(', ');
  }

  /** Builds SQL percentile expressions for a single metric (p50, p75, p90, p95, p99) */
  private buildPercentileSQL(metric: string): string {
    const alias = metric.toLowerCase();
    const src = `(ce.event_data->'metadata'->>'${metric}')::numeric`;
    return [
      `percentile_cont(0.50) WITHIN GROUP (ORDER BY ${src}) AS ${alias}_p50`,
      `percentile_cont(0.75) WITHIN GROUP (ORDER BY ${src}) AS ${alias}_p75`,
      `percentile_cont(0.90) WITHIN GROUP (ORDER BY ${src}) AS ${alias}_p90`,
      `percentile_cont(0.95) WITHIN GROUP (ORDER BY ${src}) AS ${alias}_p95`,
      `percentile_cont(0.99) WITHIN GROUP (ORDER BY ${src}) AS ${alias}_p99`,
    ].join(', ');
  }

  /** Extracts a LatencyMetric from a query result row by metric name */
  private extractMetric(row: Record<string, any>, metric: string): LatencyMetric {
    const alias = metric.toLowerCase();
    return {
      count: Number(row[`${alias}_count`] ?? 0),
      avg: this.toNullableNumber(row[`${alias}_avg`]),
      median: this.toNullableNumber(row[`${alias}_median`]),
      p95: this.toNullableNumber(row[`${alias}_p95`]),
      min: this.toNullableNumber(row[`${alias}_min`]),
      max: this.toNullableNumber(row[`${alias}_max`]),
    };
  }

  /** Extracts a PercentileSet from a query result row by metric name */
  private extractPercentiles(row: Record<string, any>, metric: string): PercentileSet {
    const alias = metric.toLowerCase();
    return {
      p50: this.toNullableNumber(row[`${alias}_p50`]),
      p75: this.toNullableNumber(row[`${alias}_p75`]),
      p90: this.toNullableNumber(row[`${alias}_p90`]),
      p95: this.toNullableNumber(row[`${alias}_p95`]),
      p99: this.toNullableNumber(row[`${alias}_p99`]),
    };
  }

  /** Converts a value to a number or null, rounding to 2 decimal places */
  private toNullableNumber(value: any): number | null {
    if (value == null) return null;
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }

  /** Escapes a string parameter for safe inline SQL (prevents SQL injection) */
  private escapeParam(value: string): string {
    return value.replace(/'/g, "''");
  }
}
