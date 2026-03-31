import type { SourceDef, AggregationFn, DimensionDef, MetricDef } from './sources';
import { AGGREGATION_FUNCTIONS } from './sources';

/** Parsed metric specification: either a bare 'count' or an aggregation function applied to a metric */
type ParsedMetric = {
  spec: string;
  aggFn: AggregationFn;
  metricDef: MetricDef | null;
};

/**
 * Builds raw SQL queries for the slice-and-dice analytics engine.
 * Pure SQL-building class — no DB access, fully testable.
 * All SQL expressions come from the hardcoded source catalog; user input is escaped.
 */
export class SliceQueryBuilder {
  private readonly resolvedDimensions: DimensionDef[];
  private readonly parsedMetrics: ParsedMetric[];
  private readonly resolvedNormalizeDimension: DimensionDef | null;
  private readonly needsConversationJoin: boolean;
  private readonly needsUserJoin: boolean;

  constructor(
    private readonly source: SourceDef,
    private readonly params: {
      groupBy: string[];
      interval?: string;
      metrics: string[];
      normalizeBy?: string;
      from?: Date;
      to?: Date;
      conversationId?: string;
      filters?: Record<string, string>;
      limit: number;
    },
    private readonly projectId: string,
  ) {
    this.resolvedDimensions = params.groupBy.map((dimId) => {
      const dim = source.dimensions.find((d) => d.id === dimId);
      if (!dim) throw new Error(`Unknown dimension '${dimId}' for source '${source.id}'`);
      return dim;
    });

    this.parsedMetrics = params.metrics.map((spec) => this.parseMetricSpec(spec));

    if (params.normalizeBy) {
      const normDim = source.dimensions.find((d) => d.id === params.normalizeBy);
      if (!normDim) throw new Error(`Unknown normalizeBy dimension '${params.normalizeBy}' for source '${source.id}'`);
      if (params.groupBy.includes(params.normalizeBy)) throw new Error(`normalizeBy dimension '${params.normalizeBy}' must not also appear in groupBy`);
      if (this.parsedMetrics.some((m) => m.spec === 'count')) throw new Error(`The bare 'count' metric cannot be used with normalizeBy. Use 'count' without normalizeBy, or use a named metric with an aggregation function.`);
      this.resolvedNormalizeDimension = normDim;
    } else {
      this.resolvedNormalizeDimension = null;
    }

    this.needsConversationJoin = this.resolvedDimensions.some((d) => d.requiresConversationJoin)
      || this.resolveFilterDimensions().some((d) => d.requiresConversationJoin)
      || (this.resolvedNormalizeDimension?.requiresConversationJoin ?? false);

    this.needsUserJoin = this.resolvedDimensions.some((d) => d.requiresUserJoin)
      || this.parsedMetrics.some((m) => m.metricDef?.requiresUserJoin)
      || this.resolveFilterDimensions().some((d) => d.requiresUserJoin)
      || (this.resolvedNormalizeDimension?.requiresUserJoin ?? false);
  }

  /** Builds the final SQL query string */
  build(): string {
    if (this.resolvedNormalizeDimension) {
      return this.buildNestedQuery();
    }

    const parts: string[] = [];

    if (this.source.requiresCte) {
      parts.push(this.buildCte());
    }

    parts.push('SELECT');
    parts.push(this.buildSelectColumns().join(',\n  '));
    parts.push(this.buildFrom());
    parts.push(`WHERE ${this.buildWhere()}`);

    const groupByCols = this.buildGroupByColumns();
    if (groupByCols.length > 0) {
      parts.push(`GROUP BY ${groupByCols.join(', ')}`);
    }

    const orderByCols = this.buildOrderByColumns();
    if (orderByCols.length > 0) {
      parts.push(`ORDER BY ${orderByCols.join(', ')}`);
    }

    parts.push(`LIMIT ${this.params.limit}`);

    return parts.join('\n');
  }

  /**
   * Builds a two-phase nested SQL query for normalizeBy aggregation.
   * Inner query pre-aggregates metrics (SUM) within each (groupBy + normalizeBy) group.
   * Outer query applies the requested aggregation function across those sums.
   */
  private buildNestedQuery(): string {
    const parts: string[] = [];
    const normDim = this.resolvedNormalizeDimension!;

    if (this.source.requiresCte) {
      parts.push(this.buildCte());
    }

    // Inner SELECT: bucket + groupBy dims + _normalizeBy + SUM per metric
    const innerCols: string[] = [];
    if (this.params.interval) {
      innerCols.push(`date_trunc('${this.params.interval}', ${this.source.timeColumn}) AS bucket`);
    }
    for (const dim of this.resolvedDimensions) {
      innerCols.push(`${dim.sqlExpr} AS "${dim.id}"`);
    }
    innerCols.push(`${normDim.sqlExpr} AS "_normalizeBy"`);
    for (const m of this.parsedMetrics) {
      innerCols.push(`SUM(${m.metricDef!.sqlExpr}) AS "${m.spec}"`);
    }

    const innerGroupByCols: string[] = [];
    if (this.params.interval) {
      innerGroupByCols.push('bucket');
    }
    for (const dim of this.resolvedDimensions) {
      innerGroupByCols.push(`"${dim.id}"`);
    }
    innerGroupByCols.push('"_normalizeBy"');

    const innerParts: string[] = ['SELECT', innerCols.join(',\n  '), this.buildFrom(), `WHERE ${this.buildWhere()}`, `GROUP BY ${innerGroupByCols.join(', ')}` ];

    // Outer SELECT: bucket + groupBy dim aliases + outer aggregation per metric
    const outerCols: string[] = [];
    if (this.params.interval) {
      outerCols.push('_inner.bucket');
    }
    for (const dim of this.resolvedDimensions) {
      outerCols.push(`_inner."${dim.id}"`);
    }
    for (const m of this.parsedMetrics) {
      outerCols.push(`${this.buildOuterAggExpr(m)} AS "${m.spec}"`);
    }

    const outerGroupByCols: string[] = [];
    const outerOrderByCols: string[] = [];
    if (this.params.interval) {
      outerGroupByCols.push('_inner.bucket');
      outerOrderByCols.push('_inner.bucket ASC');
    }
    for (const dim of this.resolvedDimensions) {
      outerGroupByCols.push(`_inner."${dim.id}"`);
      outerOrderByCols.push(`_inner."${dim.id}" ASC NULLS LAST`);
    }

    parts.push('SELECT');
    parts.push(outerCols.join(',\n  '));
    parts.push('FROM (');
    parts.push(innerParts.join('\n'));
    parts.push(') _inner');

    if (outerGroupByCols.length > 0) {
      parts.push(`GROUP BY ${outerGroupByCols.join(', ')}`);
    }
    if (outerOrderByCols.length > 0) {
      parts.push(`ORDER BY ${outerOrderByCols.join(', ')}`);
    }
    parts.push(`LIMIT ${this.params.limit}`);

    return parts.join('\n');
  }

  /** Builds a single outer aggregation SQL expression over pre-summed inner aliases */
  private buildOuterAggExpr(m: ParsedMetric): string {
    const innerRef = `_inner."${m.spec}"`;
    switch (m.aggFn) {
      case 'sum': return `COALESCE(SUM(${innerRef}), 0)`;
      case 'avg': return `AVG(${innerRef})`;
      case 'min': return `MIN(${innerRef})`;
      case 'max': return `MAX(${innerRef})`;
      case 'p50': return `PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY ${innerRef})`;
      case 'p75': return `PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ${innerRef})`;
      case 'p90': return `PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY ${innerRef})`;
      case 'p95': return `PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${innerRef})`;
      case 'p99': return `PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY ${innerRef})`;
      case 'count': throw new Error(`The 'count' metric cannot be used with normalizeBy`);
      default: throw new Error(`Unsupported aggregation function '${m.aggFn}'`);
    }
  }

  /** Builds stage_visits CTE */
  private buildCte(): string {
    const escapedProjectId = this.escapeParam(this.projectId);
    return `WITH stage_visits AS (
  SELECT
    ce.conversation_id,
    CASE
      WHEN ce.event_type = 'conversation_start' THEN ce.event_data->>'stageId'
      ELSE ce.event_data->>'toStageId'
    END AS stage_id,
    ce.timestamp,
    LEAD(ce.timestamp) OVER (PARTITION BY ce.conversation_id ORDER BY ce.timestamp) AS next_ts
  FROM conversation_events ce
  WHERE ce.project_id = '${escapedProjectId}'
    AND ce.event_type IN ('conversation_start', 'jump_to_stage')
)`;
  }

  /** Builds SELECT column expressions */
  private buildSelectColumns(): string[] {
    const cols: string[] = [];

    if (this.params.interval) {
      cols.push(`date_trunc('${this.params.interval}', ${this.source.timeColumn}) AS bucket`);
    }

    for (const dim of this.resolvedDimensions) {
      cols.push(`${dim.sqlExpr} AS "${dim.id}"`);
    }

    for (const m of this.parsedMetrics) {
      cols.push(`${this.buildAggExpr(m)} AS "${m.spec}"`);
    }

    return cols;
  }

  /** Builds FROM clause with JOINs */
  private buildFrom(): string {
    const parts: string[] = [];

    if (this.source.requiresCte) {
      parts.push('FROM stage_visits sv');
      if (this.needsConversationJoin) {
        parts.push('LEFT JOIN conversations c ON c.id = sv.conversation_id AND c.project_id = c.project_id');
      }
    } else if (this.source.table === 'conversations') {
      parts.push('FROM conversations c');
    } else {
      parts.push('FROM conversation_events ce');
      if (this.needsConversationJoin) {
        parts.push('LEFT JOIN conversations c ON c.id = ce.conversation_id AND c.project_id = ce.project_id');
      }
      if (this.needsUserJoin) {
        parts.push(this.buildUserLateralJoin());
      }
    }

    return parts.join('\n');
  }

  /** Builds the LATERAL JOIN to the matching user message for user-side metrics */
  private buildUserLateralJoin(): string {
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

  /** Builds WHERE clause */
  private buildWhere(): string {
    const conditions: string[] = [];
    const escapedProjectId = this.escapeParam(this.projectId);

    if (this.source.requiresCte) {
      // CTE already filtered by project_id; add conversation join conditions if needed
      if (this.needsConversationJoin) {
        conditions.push(`c.project_id = '${escapedProjectId}'`);
      }
      // Always true for CTE — ensure at least one condition
      if (conditions.length === 0) {
        conditions.push('1=1');
      }
    } else if (this.source.table === 'conversations') {
      conditions.push(`c.project_id = '${escapedProjectId}'`);
    } else {
      conditions.push(`ce.project_id = '${escapedProjectId}'`);

      if (this.source.eventTypeFilter) {
        if (Array.isArray(this.source.eventTypeFilter)) {
          const types = this.source.eventTypeFilter.map((t) => `'${this.escapeParam(t)}'`).join(', ');
          conditions.push(`ce.event_type IN (${types})`);
        } else {
          conditions.push(`ce.event_type = '${this.escapeParam(this.source.eventTypeFilter)}'`);
        }
      }

      if (this.source.eventRoleFilter) {
        conditions.push(`ce.event_data->>'role' = '${this.escapeParam(this.source.eventRoleFilter)}'`);
      }

      if (this.source.additionalFilter) {
        conditions.push(this.source.additionalFilter);
      }
    }

    // Date range
    if (this.params.from) {
      conditions.push(`${this.source.timeColumn} >= '${this.params.from.toISOString()}'`);
    }
    if (this.params.to) {
      conditions.push(`${this.source.timeColumn} <= '${this.params.to.toISOString()}'`);
    }

    // Conversation filter
    if (this.params.conversationId) {
      const convCol = this.source.requiresCte ? 'sv.conversation_id'
        : this.source.table === 'conversations' ? 'c.id'
          : 'ce.conversation_id';
      conditions.push(`${convCol} = '${this.escapeParam(this.params.conversationId)}'`);
    }

    // Additional dimension equality filters
    if (this.params.filters) {
      for (const [dimId, value] of Object.entries(this.params.filters)) {
        const dim = this.source.dimensions.find((d) => d.id === dimId);
        if (!dim) throw new Error(`Unknown filter dimension '${dimId}' for source '${this.source.id}'`);
        conditions.push(`${dim.sqlExpr} = '${this.escapeParam(value)}'`);
      }
    }

    return conditions.join(' AND ');
  }

  /** Builds GROUP BY column references */
  private buildGroupByColumns(): string[] {
    const cols: string[] = [];
    if (this.params.interval) {
      cols.push('bucket');
    }
    for (const dim of this.resolvedDimensions) {
      cols.push(`"${dim.id}"`);
    }
    return cols;
  }

  /** Builds ORDER BY column references */
  private buildOrderByColumns(): string[] {
    const cols: string[] = [];
    if (this.params.interval) {
      cols.push('bucket ASC');
    }
    for (const dim of this.resolvedDimensions) {
      cols.push(`"${dim.id}" ASC NULLS LAST`);
    }
    return cols;
  }

  /** Builds a single aggregation SQL expression from a parsed metric */
  private buildAggExpr(m: ParsedMetric): string {
    if (m.spec === 'count') {
      return 'COUNT(*)::int';
    }
    const expr = m.metricDef!.sqlExpr;
    switch (m.aggFn) {
      case 'sum': return `COALESCE(SUM(${expr}), 0)`;
      case 'avg': return `AVG(${expr})`;
      case 'min': return `MIN(${expr})`;
      case 'max': return `MAX(${expr})`;
      case 'p50': return `PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY ${expr})`;
      case 'p75': return `PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ${expr})`;
      case 'p90': return `PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY ${expr})`;
      case 'p95': return `PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${expr})`;
      case 'p99': return `PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY ${expr})`;
      case 'count': return `COUNT(${expr})::int`;
      default: throw new Error(`Unsupported aggregation function '${m.aggFn}'`);
    }
  }

  /** Parses a metric spec string into its components */
  private parseMetricSpec(spec: string): ParsedMetric {
    if (spec === 'count') {
      return { spec, aggFn: 'count', metricDef: null };
    }

    const colonIndex = spec.indexOf(':');
    if (colonIndex === -1) {
      throw new Error(`Invalid metric spec '${spec}'. Expected 'count' or '{aggFn}:{metricId}'`);
    }

    const aggFn = spec.substring(0, colonIndex) as AggregationFn;
    const metricId = spec.substring(colonIndex + 1);

    if (!AGGREGATION_FUNCTIONS.includes(aggFn)) {
      throw new Error(`Unknown aggregation function '${aggFn}' in metric '${spec}'. Valid functions: ${AGGREGATION_FUNCTIONS.join(', ')}`);
    }

    const metricDef = this.source.metrics.find((m) => m.id === metricId);
    if (!metricDef) {
      throw new Error(`Unknown metric '${metricId}' for source '${this.source.id}'`);
    }

    return { spec, aggFn, metricDef };
  }

  /** Resolves filter dimensions from the filters param */
  private resolveFilterDimensions(): DimensionDef[] {
    if (!this.params.filters) return [];
    return Object.keys(this.params.filters)
      .map((dimId) => this.source.dimensions.find((d) => d.id === dimId))
      .filter((d): d is DimensionDef => d !== undefined);
  }

  /** Escapes a string parameter for safe inline SQL */
  private escapeParam(value: string): string {
    return value.replace(/'/g, "''");
  }
}
