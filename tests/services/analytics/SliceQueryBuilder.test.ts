import { describe, it, expect } from 'vitest';
import { SliceQueryBuilder } from '../../../src/services/analytics/SliceQueryBuilder';
import type { SourceDef, DimensionDef, MetricDef } from '../../../src/services/analytics/sources';

const simpleSource: SourceDef = {
  id: 'events',
  label: 'Events',
  description: 'All conversation events',
  table: 'conversation_events',
  timeColumn: 'ce.timestamp',
  dimensions: [
    { id: 'conversationId', label: 'Conversation', sqlExpr: 'ce.conversation_id', requiresConversationJoin: false, requiresUserJoin: false },
    { id: 'eventType', label: 'Event Type', sqlExpr: 'ce.event_type', requiresConversationJoin: false, requiresUserJoin: false, values: ['message', 'classification'] },
  ],
  metrics: [],
};

const sourceWithMetrics: SourceDef = {
  id: 'turns',
  label: 'Turns',
  description: 'Turn-level metrics',
  table: 'conversation_events',
  eventTypeFilter: 'message',
  eventRoleFilter: 'assistant',
  timeColumn: 'ce.timestamp',
  dimensions: [
    { id: 'conversationId', label: 'Conversation', sqlExpr: 'ce.conversation_id', requiresConversationJoin: false, requiresUserJoin: false },
    { id: 'stageName', label: 'Stage', sqlExpr: `ce.event_data->'metadata'->>'stageName'`, requiresConversationJoin: false, requiresUserJoin: false },
    { id: 'source', label: 'Input Source', sqlExpr: `ue.event_data->'metadata'->>'source'`, requiresConversationJoin: false, requiresUserJoin: true, values: ['text', 'voice'] },
  ],
  metrics: [
    { id: 'totalTurnDurationMs', label: 'Total Turn Duration', sqlExpr: `(ce.event_data->'metadata'->>'totalTurnDurationMs')::numeric`, unit: 'ms' },
    { id: 'timeToFirstTokenMs', label: 'Time to First Token', sqlExpr: `(ce.event_data->'metadata'->>'timeToFirstTokenMs')::numeric`, unit: 'ms' },
  ],
};

const conversationsSource: SourceDef = {
  id: 'conversations',
  label: 'Conversations',
  description: 'Conversation-level aggregations',
  table: 'conversations',
  timeColumn: 'c.created_at',
  dimensions: [
    { id: 'status', label: 'Status', sqlExpr: 'c.status', requiresConversationJoin: false, requiresUserJoin: false, values: ['initialized', 'finished'] },
    { id: 'startingStageId', label: 'Starting Stage', sqlExpr: 'c.starting_stage_id', requiresConversationJoin: false, requiresUserJoin: false },
  ],
  metrics: [
    { id: 'durationMs', label: 'Duration', sqlExpr: 'EXTRACT(EPOCH FROM (c.last_activity_at - c.created_at)) * 1000', unit: 'ms' },
  ],
};

const stageVisitsSource: SourceDef = {
  id: 'stage_visits',
  label: 'Stage Visits',
  description: 'Stage visit metrics',
  table: 'conversation_events',
  eventTypeFilter: ['conversation_start', 'jump_to_stage'],
  timeColumn: 'sv.timestamp',
  requiresCte: true,
  dimensions: [
    { id: 'conversationId', label: 'Conversation', sqlExpr: 'sv.conversation_id', requiresConversationJoin: false, requiresUserJoin: false },
    { id: 'stageSource', label: 'Stage Source', sqlExpr: 'sv.source_type', requiresConversationJoin: false, requiresUserJoin: false, values: ['starting_stage', 'transition'] },
  ],
  metrics: [
    { id: 'timeOnStageMs', label: 'Time on Stage', sqlExpr: `EXTRACT(EPOCH FROM (sv.next_ts - sv.timestamp)) * 1000`, unit: 'ms' },
    { id: 'conversationLengthMs', label: 'Conversation Length', sqlExpr: `EXTRACT(EPOCH FROM (c.last_activity_at - c.created_at)) * 1000`, unit: 'ms', requiresConversationJoin: true },
  ],
};

describe('SliceQueryBuilder', () => {
  describe('SELECT clause', () => {
    it('builds SELECT with count metric only', () => {
      const builder = new SliceQueryBuilder(simpleSource, { groupBy: [], metrics: ['count'], limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain('COUNT(*)::int');
    });

    it('builds SELECT with aggregation function on metric', () => {
      const builder = new SliceQueryBuilder(sourceWithMetrics, { groupBy: ['stageName'], metrics: ['sum:totalTurnDurationMs'], limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain('COALESCE(SUM(');
      expect(sql).toContain('"sum:totalTurnDurationMs"');
    });

    it('builds SELECT with date_trunc bucket when interval is provided', () => {
      const builder = new SliceQueryBuilder(simpleSource, { groupBy: [], metrics: ['count'], interval: 'hour', limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain("date_trunc('hour', ce.timestamp) AS bucket");
    });

    it('builds SELECT with dimension columns', () => {
      const builder = new SliceQueryBuilder(simpleSource, { groupBy: ['conversationId', 'eventType'], metrics: ['count'], limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain('ce.conversation_id AS "conversationId"');
      expect(sql).toContain('ce.event_type AS "eventType"');
    });

    it('builds SELECT with multiple metrics', () => {
      const builder = new SliceQueryBuilder(sourceWithMetrics, { groupBy: [], metrics: ['sum:totalTurnDurationMs', 'avg:timeToFirstTokenMs'], limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain('COALESCE(SUM(');
      expect(sql).toContain('AVG(');
    });
  });

  describe('GROUP BY', () => {
    it('generates GROUP BY from selected dimensions', () => {
      const builder = new SliceQueryBuilder(simpleSource, { groupBy: ['eventType'], metrics: ['count'], limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain('GROUP BY "eventType"');
    });

    it('includes bucket in GROUP BY when interval is provided', () => {
      const builder = new SliceQueryBuilder(simpleSource, { groupBy: ['eventType'], metrics: ['count'], interval: 'day', limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain('GROUP BY bucket, "eventType"');
    });

    it('omits GROUP BY when no dimensions and no interval', () => {
      const builder = new SliceQueryBuilder(simpleSource, { groupBy: [], metrics: ['count'], limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).not.toContain('GROUP BY');
    });

    it('combines multiple dimensions in GROUP BY', () => {
      const builder = new SliceQueryBuilder(simpleSource, { groupBy: ['conversationId', 'eventType'], metrics: ['count'], limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain('GROUP BY "conversationId", "eventType"');
    });
  });

  describe('WHERE clause', () => {
    it('includes project_id filter for conversation_events table', () => {
      const builder = new SliceQueryBuilder(simpleSource, { groupBy: [], metrics: ['count'], limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain("ce.project_id = '__test_project__'");
    });

    it('includes project_id filter for conversations table', () => {
      const builder = new SliceQueryBuilder(conversationsSource, { groupBy: [], metrics: ['count'], limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain("c.project_id = '__test_project__'");
    });

    it('includes time range filters when from and to are provided', () => {
      const from = new Date('2024-01-01T00:00:00.000Z');
      const to = new Date('2024-01-31T23:59:59.999Z');
      const builder = new SliceQueryBuilder(simpleSource, { groupBy: [], metrics: ['count'], from, to, limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain("ce.timestamp >= '2024-01-01T00:00:00.000Z'");
      expect(sql).toContain("ce.timestamp <= '2024-01-31T23:59:59.999Z'");
    });

    it('includes only from filter when to is not provided', () => {
      const from = new Date('2024-06-01T00:00:00.000Z');
      const builder = new SliceQueryBuilder(simpleSource, { groupBy: [], metrics: ['count'], from, limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain("ce.timestamp >= '2024-06-01T00:00:00.000Z'");
      expect(sql).not.toContain('<=');
    });

    it('includes eventTypeFilter from source definition', () => {
      const builder = new SliceQueryBuilder(sourceWithMetrics, { groupBy: [], metrics: ['count'], limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain("ce.event_type = 'message'");
    });

    it('includes eventRoleFilter from source definition', () => {
      const builder = new SliceQueryBuilder(sourceWithMetrics, { groupBy: [], metrics: ['count'], limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain("ce.event_data->>'role' = 'assistant'");
    });

    it('includes conversationId filter', () => {
      const builder = new SliceQueryBuilder(simpleSource, { groupBy: [], metrics: ['count'], conversationId: 'conv_123', limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain("ce.conversation_id = 'conv_123'");
    });

    it('includes scenarioRunConversationIds filter', () => {
      const builder = new SliceQueryBuilder(simpleSource, { groupBy: [], metrics: ['count'], scenarioRunConversationIds: ['run_1', 'run_2'], limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain("ce.conversation_id IN ('run_1', 'run_2')");
    });

    it('includes dimension equality filters', () => {
      const builder = new SliceQueryBuilder(simpleSource, { groupBy: [], metrics: ['count'], filters: { eventType: 'message' }, limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain("ce.event_type = 'message'");
    });

    it('escapes single quotes in parameters', () => {
      const builder = new SliceQueryBuilder(simpleSource, { groupBy: [], metrics: ['count'], conversationId: "conv'd", limit: 100 }, "__test_project'");
      const sql = builder.build();
      expect(sql).toContain("conv''d");
      expect(sql).toContain("__test_project''");
    });

    it('escapes single quotes in filter values', () => {
      const builder = new SliceQueryBuilder(simpleSource, { groupBy: [], metrics: ['count'], filters: { eventType: "type'value" }, limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain("type''value");
    });
  });

  describe('ORDER BY', () => {
    it('applies ORDER BY for dimensions', () => {
      const builder = new SliceQueryBuilder(simpleSource, { groupBy: ['eventType'], metrics: ['count'], limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain('ORDER BY "eventType" ASC NULLS LAST');
    });

    it('includes bucket first in ORDER BY when interval is provided', () => {
      const builder = new SliceQueryBuilder(simpleSource, { groupBy: ['eventType'], metrics: ['count'], interval: 'hour', limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain('ORDER BY bucket ASC, "eventType" ASC NULLS LAST');
    });

    it('omits ORDER BY when no dimensions and no interval', () => {
      const builder = new SliceQueryBuilder(simpleSource, { groupBy: [], metrics: ['count'], limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).not.toContain('ORDER BY');
    });
  });

  describe('expression whitelist validation', () => {
    it('resolves valid dimension from source', () => {
      const builder = new SliceQueryBuilder(simpleSource, { groupBy: ['conversationId'], metrics: ['count'], limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain('ce.conversation_id');
    });

    it('throws for unknown dimension in groupBy', () => {
      expect(() => new SliceQueryBuilder(simpleSource, { groupBy: ['unknownDim'], metrics: ['count'], limit: 100 }, '__test_project__'))
        .toThrow("Unknown dimension 'unknownDim' for source 'events'");
    });

    it('throws for unknown metric in source', () => {
      expect(() => new SliceQueryBuilder(sourceWithMetrics, { groupBy: [], metrics: ['sum:unknownMetric'], limit: 100 }, '__test_project__'))
        .toThrow("Unknown metric 'unknownMetric' for source 'turns'");
    });

    it('throws for unknown aggregation function', () => {
      expect(() => new SliceQueryBuilder(sourceWithMetrics, { groupBy: [], metrics: ['median:totalTurnDurationMs'], limit: 100 }, '__test_project__'))
        .toThrow(/Unknown aggregation function 'median'/);
    });

    it('throws for metric spec without colon', () => {
      expect(() => new SliceQueryBuilder(sourceWithMetrics, { groupBy: [], metrics: ['totalTurnDurationMs'], limit: 100 }, '__test_project__'))
        .toThrow("Invalid metric spec 'totalTurnDurationMs'");
    });

    it('throws for unknown filter dimension when building', () => {
      const builder = new SliceQueryBuilder(simpleSource, { groupBy: [], metrics: ['count'], filters: { unknownDim: 'value' }, limit: 100 }, '__test_project__');
      expect(() => builder.build()).toThrow("Unknown filter dimension 'unknownDim' for source 'events'");
    });

    it('throws for unknown normalizeBy dimension', () => {
      expect(() => new SliceQueryBuilder(simpleSource, { groupBy: [], metrics: ['count'], normalizeBy: 'unknownDim', limit: 100 }, '__test_project__'))
        .toThrow("Unknown normalizeBy dimension 'unknownDim' for source 'events'");
    });

    it('throws when normalizeBy dimension is also in groupBy', () => {
      expect(() => new SliceQueryBuilder(sourceWithMetrics, { groupBy: ['stageName'], metrics: ['sum:totalTurnDurationMs'], normalizeBy: 'stageName', limit: 100 }, '__test_project__'))
        .toThrow("normalizeBy dimension 'stageName' must not also appear in groupBy");
    });

    it('throws when bare count metric is used with normalizeBy', () => {
      expect(() => new SliceQueryBuilder(sourceWithMetrics, { groupBy: [], metrics: ['count'], normalizeBy: 'conversationId', limit: 100 }, '__test_project__'))
        .toThrow("The bare 'count' metric cannot be used with normalizeBy");
    });
  });

  describe('FROM clause', () => {
    it('uses FROM conversations c for conversations source', () => {
      const builder = new SliceQueryBuilder(conversationsSource, { groupBy: [], metrics: ['count'], limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain('FROM conversations c');
    });

    it('uses FROM conversation_events ce for event-based sources', () => {
      const builder = new SliceQueryBuilder(simpleSource, { groupBy: [], metrics: ['count'], limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain('FROM conversation_events ce');
    });

    it('adds LEFT JOIN conversations when dimension requires it', () => {
      const sourceWithConvJoin: SourceDef = {
        ...simpleSource,
        dimensions: [
          ...simpleSource.dimensions,
          { id: 'convStatus', label: 'Status', sqlExpr: 'c.status', requiresConversationJoin: true, requiresUserJoin: false },
        ],
      };
      const builder = new SliceQueryBuilder(sourceWithConvJoin, { groupBy: ['convStatus'], metrics: ['count'], limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain('LEFT JOIN conversations c');
    });

    it('adds user lateral join when dimension requires it', () => {
      const builder = new SliceQueryBuilder(sourceWithMetrics, { groupBy: ['source'], metrics: ['count'], limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain('LEFT JOIN LATERAL');
    });
  });

  describe('CTE queries (stage_visits)', () => {
    it('includes WITH stage_visits CTE for requiresCte sources', () => {
      const builder = new SliceQueryBuilder(stageVisitsSource, { groupBy: [], metrics: ['count'], limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain('WITH stage_visits AS');
      expect(sql).toContain('conversation_events ce');
      expect(sql).toContain('LEAD(ce.timestamp)');
    });

    it('uses FROM stage_visits sv for CTE sources', () => {
      const builder = new SliceQueryBuilder(stageVisitsSource, { groupBy: [], metrics: ['count'], limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain('FROM stage_visits sv');
    });

    it('adds conversation join for CTE source when metric requires it', () => {
      const builder = new SliceQueryBuilder(stageVisitsSource, { groupBy: [], metrics: ['sum:conversationLengthMs'], limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain('LEFT JOIN conversations c');
    });

    it('uses sv.conversation_id for conversation filter on CTE source', () => {
      const builder = new SliceQueryBuilder(stageVisitsSource, { groupBy: [], metrics: ['count'], conversationId: 'conv_123', limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain("sv.conversation_id = 'conv_123'");
    });
  });

  describe('normalizeBy nested query', () => {
    it('builds two-phase nested query with normalizeBy', () => {
      const builder = new SliceQueryBuilder(sourceWithMetrics, {
        groupBy: ['stageName'],
        metrics: ['sum:totalTurnDurationMs'],
        normalizeBy: 'conversationId',
        limit: 100,
      }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain('_inner');
      expect(sql).toContain('SUM(');
      expect(sql).toContain('"_normalizeBy"');
    });

    it('includes outer aggregation function in nested query', () => {
      const builder = new SliceQueryBuilder(sourceWithMetrics, {
        groupBy: ['stageName'],
        metrics: ['avg:totalTurnDurationMs'],
        normalizeBy: 'conversationId',
        limit: 100,
      }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain('AVG(_inner."avg:totalTurnDurationMs")');
    });

    it('includes bucket in nested query when interval is provided', () => {
      const builder = new SliceQueryBuilder(sourceWithMetrics, {
        groupBy: ['stageName'],
        metrics: ['sum:totalTurnDurationMs'],
        normalizeBy: 'conversationId',
        interval: 'day',
        limit: 100,
      }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain('bucket');
      expect(sql).toContain('_inner.bucket');
    });

    it('throws when count metric is used with normalizeBy in outer aggregation', () => {
      const builder = new SliceQueryBuilder(sourceWithMetrics, {
        groupBy: ['stageName'],
        metrics: ['count:totalTurnDurationMs'],
        normalizeBy: 'conversationId',
        limit: 100,
      }, '__test_project__');
      expect(() => builder.build()).toThrow("The 'count' metric cannot be used with normalizeBy");
    });

    it('applies percentile aggregation in outer query', () => {
      const builder = new SliceQueryBuilder(sourceWithMetrics, {
        groupBy: ['stageName'],
        metrics: ['p95:totalTurnDurationMs'],
        normalizeBy: 'conversationId',
        limit: 100,
      }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain('PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY _inner."p95:totalTurnDurationMs")');
    });
  });

  describe('aggregation functions', () => {
    it('builds SUM with COALESCE', () => {
      const builder = new SliceQueryBuilder(sourceWithMetrics, { groupBy: [], metrics: ['sum:totalTurnDurationMs'], limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain('COALESCE(SUM(');
    });

    it('builds AVG', () => {
      const builder = new SliceQueryBuilder(sourceWithMetrics, { groupBy: [], metrics: ['avg:totalTurnDurationMs'], limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain('AVG(');
    });

    it('builds MIN', () => {
      const builder = new SliceQueryBuilder(sourceWithMetrics, { groupBy: [], metrics: ['min:totalTurnDurationMs'], limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain('MIN(');
    });

    it('builds MAX', () => {
      const builder = new SliceQueryBuilder(sourceWithMetrics, { groupBy: [], metrics: ['max:totalTurnDurationMs'], limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain('MAX(');
    });

    it('builds COUNT(*)::int for bare count', () => {
      const builder = new SliceQueryBuilder(simpleSource, { groupBy: [], metrics: ['count'], limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain('COUNT(*)::int');
    });

    it('builds COUNT(expr)::int for count aggregation', () => {
      const builder = new SliceQueryBuilder(sourceWithMetrics, { groupBy: [], metrics: ['count:totalTurnDurationMs'], limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain('COUNT(');
    });

    it('builds PERCENTILE_CONT for p50', () => {
      const builder = new SliceQueryBuilder(sourceWithMetrics, { groupBy: [], metrics: ['p50:totalTurnDurationMs'], limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain('PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY');
    });

    it('builds PERCENTILE_CONT for p99', () => {
      const builder = new SliceQueryBuilder(sourceWithMetrics, { groupBy: [], metrics: ['p99:totalTurnDurationMs'], limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain('PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY');
    });
  });

  describe('LIMIT clause', () => {
    it('includes LIMIT with provided value', () => {
      const builder = new SliceQueryBuilder(simpleSource, { groupBy: [], metrics: ['count'], limit: 50 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain('LIMIT 50');
    });

    it('respects large limit values', () => {
      const builder = new SliceQueryBuilder(simpleSource, { groupBy: [], metrics: ['count'], limit: 10000 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain('LIMIT 10000');
    });
  });

  describe('complex query assembly', () => {
    it('assembles all clauses correctly for a typical query', () => {
      const from = new Date('2024-01-01T00:00:00.000Z');
      const to = new Date('2024-01-31T23:59:59.999Z');
      const builder = new SliceQueryBuilder(sourceWithMetrics, {
        groupBy: ['stageName'],
        metrics: ['sum:totalTurnDurationMs', 'avg:timeToFirstTokenMs', 'count'],
        interval: 'day',
        from,
        to,
        filters: { conversationId: 'conv_123' },
        limit: 100,
      }, '__test_project__');
      const sql = builder.build();

      expect(sql).toContain('SELECT');
      expect(sql).toContain('date_trunc(\'day\', ce.timestamp) AS bucket');
      expect(sql).toContain('FROM conversation_events ce');
      expect(sql).toContain("ce.event_type = 'message'");
      expect(sql).toContain("ce.event_data->>'role' = 'assistant'");
      expect(sql).toContain('WHERE');
      expect(sql).toContain("ce.project_id = '__test_project__'");
      expect(sql).toContain("ce.timestamp >= '2024-01-01T00:00:00.000Z'");
      expect(sql).toContain("ce.timestamp <= '2024-01-31T23:59:59.999Z'");
      expect(sql).toContain('GROUP BY bucket, "stageName"');
      expect(sql).toContain('ORDER BY bucket ASC, "stageName" ASC NULLS LAST');
      expect(sql).toContain('LIMIT 100');
    });

    it('assembles CTE query with conversation join and all filters', () => {
      const builder = new SliceQueryBuilder(stageVisitsSource, {
        groupBy: ['stageSource'],
        metrics: ['sum:timeOnStageMs', 'avg:conversationLengthMs'],
        interval: 'week',
        conversationId: 'conv_456',
        limit: 50,
      }, '__test_project__');
      const sql = builder.build();

      expect(sql).toContain('WITH stage_visits AS');
      expect(sql).toContain('FROM stage_visits sv');
      expect(sql).toContain('LEFT JOIN conversations c');
      expect(sql).toContain("sv.conversation_id = 'conv_456'");
      expect(sql).toContain('GROUP BY bucket, "stageSource"');
    });

    it('handles conversations table source with all features', () => {
      const from = new Date('2024-06-01T00:00:00.000Z');
      const builder = new SliceQueryBuilder(conversationsSource, {
        groupBy: ['status', 'startingStageId'],
        metrics: ['sum:durationMs', 'count'],
        interval: 'month',
        from,
        limit: 200,
      }, '__test_project__');
      const sql = builder.build();

      expect(sql).toContain('FROM conversations c');
      expect(sql).toContain("c.project_id = '__test_project__'");
      expect(sql).toContain('c.status AS "status"');
      expect(sql).toContain('c.starting_stage_id AS "startingStageId"');
      expect(sql).toContain('GROUP BY bucket, "status", "startingStageId"');
    });

    it('handles array eventTypeFilter correctly', () => {
      const builder = new SliceQueryBuilder(stageVisitsSource, { groupBy: [], metrics: ['count'], limit: 10 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain("ce.event_type IN ('conversation_start', 'jump_to_stage')");
    });
  });

  describe('empty dimension list', () => {
    it('handles empty groupBy with count metric', () => {
      const builder = new SliceQueryBuilder(simpleSource, { groupBy: [], metrics: ['count'], limit: 1 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain('SELECT');
      expect(sql).toContain('COUNT(*)::int');
      expect(sql).not.toContain('GROUP BY');
      expect(sql).not.toContain('ORDER BY');
    });

    it('handles empty groupBy with interval', () => {
      const builder = new SliceQueryBuilder(simpleSource, { groupBy: [], metrics: ['count'], interval: 'hour', limit: 100 }, '__test_project__');
      const sql = builder.build();
      expect(sql).toContain('GROUP BY bucket');
      expect(sql).toContain('ORDER BY bucket ASC');
    });
  });

  describe('lateral join deduplication', () => {
    it('does not duplicate lateral joins when multiple dimensions share the same join', () => {
      const sourceWithSharedJoin: SourceDef = {
        id: 'moderation',
        label: 'Moderation',
        description: 'Test source',
        table: 'conversation_events',
        timeColumn: 'ce.timestamp',
        dimensions: [
          {
            id: 'dim1', label: 'Dim 1', sqlExpr: 'alias',
            requiresConversationJoin: false, requiresUserJoin: false,
            lateralJoinSql: 'CROSS JOIN LATERAL jsonb_array_elements_text(ce.event_data->\'categories\') AS alias',
          },
          {
            id: 'dim2', label: 'Dim 2', sqlExpr: 'alias',
            requiresConversationJoin: false, requiresUserJoin: false,
            lateralJoinSql: 'CROSS JOIN LATERAL jsonb_array_elements_text(ce.event_data->\'categories\') AS alias',
          },
        ],
        metrics: [],
      };
      const builder = new SliceQueryBuilder(sourceWithSharedJoin, { groupBy: ['dim1', 'dim2'], metrics: ['count'], limit: 100 }, '__test_project__');
      const sql = builder.build();
      const joinCount = (sql.match(/CROSS JOIN LATERAL/g) || []).length;
      expect(joinCount).toBe(1);
    });
  });
});
