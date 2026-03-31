import { singleton } from 'tsyringe';
import { sql } from 'drizzle-orm';
import { db } from '../../db/index';
import { BaseService } from '../BaseService';
import type { RequestContext } from '../RequestContext';
import { PERMISSIONS } from '../../permissions';
import { SOURCES } from './sources';
import type { SourceId } from './sources';
import { SliceQueryBuilder } from './SliceQueryBuilder';
import type { SourceCatalogResponse, SliceQuery, SliceQueryResponse } from '../../http/contracts/sliceAnalytics';
import type { RelativeTime } from '../../http/contracts/sliceAnalytics';
import { InvalidOperationError } from '../../errors';

/** Maps a relative time range to a concrete { from, to } date pair anchored to now */
function resolveRelativeTime(relativeTime: RelativeTime): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date(to);
  switch (relativeTime.unit) {
    case 'hours':  from.setHours(from.getHours() - relativeTime.amount); break;
    case 'days':   from.setDate(from.getDate() - relativeTime.amount); break;
    case 'weeks':  from.setDate(from.getDate() - relativeTime.amount * 7); break;
    case 'months': from.setMonth(from.getMonth() - relativeTime.amount); break;
  }
  return { from, to };
}

/**
 * Service for the slice-and-dice analytics query engine.
 * Validates user queries against the hardcoded source catalog and executes
 * dynamically built SQL aggregations.
 */
@singleton()
export class SliceAnalyticsService extends BaseService {

  /**
   * Returns the source catalog: available sources with their dimensions and metrics.
   * SQL expressions are stripped — only public metadata is returned.
   */
  getCatalog(): SourceCatalogResponse {
    const sources = Object.values(SOURCES).map((source) => ({
      id: source.id,
      label: source.label,
      description: source.description,
      dimensions: source.dimensions.map((d) => ({
        id: d.id,
        label: d.label,
        ...(d.values ? { values: d.values } : {}),
      })),
      metrics: source.metrics.map((m) => ({
        id: m.id,
        label: m.label,
        unit: m.unit,
      })),
    }));

    return { sources };
  }

  /**
   * Executes a slice-and-dice analytics query against the specified source.
   * @param projectId - Project to query
   * @param params - Validated query parameters
   * @param context - Request context for authorization
   */
  async query(projectId: string, params: SliceQuery, context: RequestContext): Promise<SliceQueryResponse> {
    this.requirePermission(context, PERMISSIONS.ANALYTICS_READ);

    const source = SOURCES[params.source as SourceId];
    if (!source) {
      throw new InvalidOperationError(`Unknown analytics source '${params.source}'`);
    }

    // Resolve relativeTime to concrete from/to before building the query
    const resolvedParams: SliceQuery = params.relativeTime
      ? { ...params, ...resolveRelativeTime(params.relativeTime) }
      : params;

    let builder: SliceQueryBuilder;
    try {
      builder = new SliceQueryBuilder(source, {
        groupBy: resolvedParams.groupBy,
        interval: resolvedParams.interval,
        metrics: resolvedParams.metrics,
        normalizeBy: resolvedParams.normalizeBy,
        from: resolvedParams.from,
        to: resolvedParams.to,
        conversationId: resolvedParams.conversationId,
        filters: resolvedParams.filters,
        limit: resolvedParams.limit,
      }, projectId);
    } catch (err: any) {
      throw new InvalidOperationError(err.message);
    }

    const queryStr = builder.build();
    const result = await db.execute(sql.raw(queryStr));

    const rows = result.rows.map((row: any) => {
      const dimensions: Record<string, string | null> = {};
      for (const dimId of params.groupBy) {
        const val = row[dimId];
        dimensions[dimId] = val != null ? String(val) : null;
      }

      const metrics: Record<string, number | null> = {};
      for (const spec of params.metrics) {
        const val = row[spec];
        metrics[spec] = this.toNullableNumber(val);
      }

      return {
        bucket: row.bucket ? new Date(row.bucket).toISOString() : null,
        dimensions,
        metrics,
      };
    });

    return {
      source: params.source,
      ...(params.interval ? { interval: params.interval } : {}),
      groupBy: params.groupBy,
      ...(params.normalizeBy ? { normalizeBy: params.normalizeBy } : {}),
      metrics: params.metrics,
      rows,
    };
  }

  /** Converts a value to a number or null, rounding to 2 decimal places */
  private toNullableNumber(value: any): number | null {
    if (value == null) return null;
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }
}
