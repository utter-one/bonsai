/**
 * Hardcoded source catalog for the slice-and-dice analytics query engine.
 * Every SQL expression lives here — user input never reaches SQL directly.
 * This serves as both the security whitelist and the introspection data.
 */

/** Supported aggregation functions */
export const AGGREGATION_FUNCTIONS = ['count', 'sum', 'avg', 'min', 'max', 'p50', 'p75', 'p90', 'p95', 'p99'] as const;

/** Aggregation function type */
export type AggregationFn = (typeof AGGREGATION_FUNCTIONS)[number];

/** Identifier for an analytics source */
export type SourceId = 'conversations' | 'events' | 'turns' | 'tool_calls' | 'classifications' | 'transformations' | 'moderation' | 'stage_visits';

/** All valid source IDs */
export const SOURCE_IDS: SourceId[] = ['conversations', 'events', 'turns', 'tool_calls', 'classifications', 'transformations', 'moderation', 'stage_visits'];

/** Definition of a dimension (categorical field) available for groupBy and filtering */
export type DimensionDef = {
  id: string;
  label: string;
  /** Raw SQL expression for this dimension — never derived from user input */
  sqlExpr: string;
  /** Whether querying this dimension requires a LEFT JOIN to the conversations table */
  requiresConversationJoin: boolean;
  /** Whether querying this dimension requires a LATERAL join to the user message */
  requiresUserJoin: boolean;
  /** Optional hint of known values (for UI enumeration) */
  values?: string[];
};

/** Definition of a numeric metric available for aggregation */
export type MetricDef = {
  id: string;
  label: string;
  /** Raw SQL expression yielding a numeric value — never derived from user input */
  sqlExpr: string;
  /** Unit for display */
  unit: 'ms' | 'tokens' | 'count' | 'boolean';
  /** Whether this metric requires a LATERAL join to the user message (turns source only) */
  requiresUserJoin?: boolean;
};

/** Complete definition of an analytics source */
export type SourceDef = {
  id: SourceId;
  label: string;
  description: string;
  /** Which table to query from */
  table: 'conversations' | 'conversation_events';
  /** Filter to specific event_type(s) — undefined for conversations table */
  eventTypeFilter?: string | string[];
  /** Filter to a specific role — undefined unless source is message-based */
  eventRoleFilter?: string;
  /** SQL expression for the time column used in date_trunc bucketing */
  timeColumn: string;
  /** Whether this source needs a CTE wrapping */
  requiresCte?: boolean;
  dimensions: DimensionDef[];
  metrics: MetricDef[];
};

// ==================
// Shared dimension definitions (reused across event-based sources)
// ==================

const conversationIdDimension: DimensionDef = {
  id: 'conversationId',
  label: 'Conversation ID',
  sqlExpr: 'ce.conversation_id',
  requiresConversationJoin: false,
  requiresUserJoin: false,
};

const stageIdDimension: DimensionDef = {
  id: 'stageId',
  label: 'Stage ID',
  sqlExpr: 'ce.stage_id',
  requiresConversationJoin: false,
  requiresUserJoin: false,
};


// ==================
// Token metrics (reused across LLM-bearing event types)
// ==================

function tokenMetrics(prefix: string): MetricDef[] {
  return [
    { id: 'promptTokens', label: 'Prompt Tokens', sqlExpr: `(${prefix}->>'promptTokens')::numeric`, unit: 'tokens' },
    { id: 'completionTokens', label: 'Completion Tokens', sqlExpr: `(${prefix}->>'completionTokens')::numeric`, unit: 'tokens' },
    { id: 'totalTokens', label: 'Total Tokens', sqlExpr: `(${prefix}->>'totalTokens')::numeric`, unit: 'tokens' },
  ];
}

// ==================
// Source definitions
// ==================

const conversationsSource: SourceDef = {
  id: 'conversations',
  label: 'Conversations',
  description: 'Conversation-level aggregations: counts, durations, and outcomes. One row per conversation.',
  table: 'conversations',
  timeColumn: 'c.created_at',
  dimensions: [
    { id: 'status', label: 'Conversation Status', sqlExpr: 'c.status', requiresConversationJoin: false, requiresUserJoin: false, values: ['initialized', 'awaiting_user_input', 'receiving_user_voice', 'processing_user_input', 'generating_response', 'finished', 'aborted', 'failed'] },
    { id: 'startingStageId', label: 'Starting Stage', sqlExpr: 'c.starting_stage_id', requiresConversationJoin: false, requiresUserJoin: false },
    { id: 'endingStageId', label: 'Ending Stage', sqlExpr: 'c.ending_stage_id', requiresConversationJoin: false, requiresUserJoin: false },
  ],
  metrics: [
    { id: 'durationMs', label: 'Conversation Duration', sqlExpr: 'EXTRACT(EPOCH FROM (c.last_activity_at - c.created_at)) * 1000', unit: 'ms' },
  ],
};

const turnsSource: SourceDef = {
  id: 'turns',
  label: 'Turns',
  description: 'Turn-level timing and token metrics from assistant message events. Includes latency breakdowns, LLM duration, TTS timing, and token usage.',
  table: 'conversation_events',
  eventTypeFilter: 'message',
  eventRoleFilter: 'assistant',
  timeColumn: 'ce.timestamp',
  dimensions: [
    conversationIdDimension,
    stageIdDimension,
    { id: 'source', label: 'Input Source', sqlExpr: `ue.event_data->'metadata'->>'source'`, requiresConversationJoin: false, requiresUserJoin: true, values: ['text', 'voice'] },
    { id: 'model', label: 'LLM Model', sqlExpr: `ce.event_data->'metadata'->'llmUsage'->>'model'`, requiresConversationJoin: false, requiresUserJoin: false },
    { id: 'provider', label: 'LLM Provider', sqlExpr: `ce.event_data->'metadata'->'llmUsage'->>'providerApiType'`, requiresConversationJoin: false, requiresUserJoin: false },
    { id: 'prescripted', label: 'Prescripted Response', sqlExpr: `ce.event_data->'metadata'->>'prescripted'`, requiresConversationJoin: false, requiresUserJoin: false, values: ['true', 'false'] },
  ],
  metrics: [
    { id: 'totalTurnDurationMs', label: 'Total Turn Duration', sqlExpr: `(ce.event_data->'metadata'->>'totalTurnDurationMs')::numeric`, unit: 'ms' },
    { id: 'timeToFirstTokenMs', label: 'Time to First Token', sqlExpr: `(ce.event_data->'metadata'->>'timeToFirstTokenMs')::numeric`, unit: 'ms' },
    { id: 'timeToFirstTokenFromTurnStartMs', label: 'Time to First Token (from Turn Start)', sqlExpr: `(ce.event_data->'metadata'->>'timeToFirstTokenFromTurnStartMs')::numeric`, unit: 'ms' },
    { id: 'timeToFirstAudioMs', label: 'Time to First Audio', sqlExpr: `(ce.event_data->'metadata'->>'timeToFirstAudioMs')::numeric`, unit: 'ms' },
    { id: 'llmDurationMs', label: 'LLM Duration', sqlExpr: `(ce.event_data->'metadata'->>'llmDurationMs')::numeric`, unit: 'ms' },
    { id: 'ttsDurationMs', label: 'TTS Duration', sqlExpr: `(ce.event_data->'metadata'->>'ttsDurationMs')::numeric`, unit: 'ms' },
    { id: 'ttsConnectDurationMs', label: 'TTS Connection Duration', sqlExpr: `(ce.event_data->'metadata'->>'ttsConnectDurationMs')::numeric`, unit: 'ms' },
    { id: 'promptRenderDurationMs', label: 'Prompt Render Duration', sqlExpr: `(ce.event_data->'metadata'->>'promptRenderDurationMs')::numeric`, unit: 'ms' },
    { id: 'moderationDurationMs', label: 'Moderation Duration', sqlExpr: `(ce.event_data->'metadata'->>'moderationDurationMs')::numeric`, unit: 'ms' },
    { id: 'stageTransitionDurationMs', label: 'Stage Transition Duration', sqlExpr: `(ue.event_data->'metadata'->>'stageTransitionDurationMs')::numeric`, unit: 'ms', requiresUserJoin: true },
    { id: 'processingDurationMs', label: 'Processing Duration', sqlExpr: `(ue.event_data->'metadata'->>'processingDurationMs')::numeric`, unit: 'ms', requiresUserJoin: true },
    { id: 'actionsDurationMs', label: 'Actions Duration', sqlExpr: `(ue.event_data->'metadata'->>'actionsDurationMs')::numeric`, unit: 'ms', requiresUserJoin: true },
    { id: 'asrDurationMs', label: 'ASR Duration', sqlExpr: `(ue.event_data->'metadata'->>'asrDurationMs')::numeric`, unit: 'ms', requiresUserJoin: true },
    ...tokenMetrics(`ce.event_data->'metadata'->'llmUsage'`),
  ],
};

const toolCallsSource: SourceDef = {
  id: 'tool_calls',
  label: 'Tool Calls',
  description: 'Tool execution metrics: duration, success/failure rates, and token usage (smart functions). One row per tool invocation.',
  table: 'conversation_events',
  eventTypeFilter: 'tool_call',
  timeColumn: 'ce.timestamp',
  dimensions: [
    conversationIdDimension,
    stageIdDimension,
    { id: 'toolId', label: 'Tool ID', sqlExpr: `ce.event_data->>'toolId'`, requiresConversationJoin: false, requiresUserJoin: false },
    { id: 'toolName', label: 'Tool Name', sqlExpr: `ce.event_data->>'toolName'`, requiresConversationJoin: false, requiresUserJoin: false },
    { id: 'toolType', label: 'Tool Type', sqlExpr: `ce.event_data->>'toolType'`, requiresConversationJoin: false, requiresUserJoin: false, values: ['smart_function', 'webhook', 'script'] },
    { id: 'success', label: 'Success', sqlExpr: `(ce.event_data->>'success')`, requiresConversationJoin: false, requiresUserJoin: false, values: ['true', 'false'] },
    { id: 'sourceActionName', label: 'Source Action', sqlExpr: `ce.event_data->>'sourceActionName'`, requiresConversationJoin: false, requiresUserJoin: false },
  ],
  metrics: [
    { id: 'durationMs', label: 'Execution Duration', sqlExpr: `(ce.event_data->'metadata'->>'durationMs')::numeric`, unit: 'ms' },
    ...tokenMetrics(`ce.event_data->'metadata'->'llmUsage'`),
  ],
};

const classificationsSource: SourceDef = {
  id: 'classifications',
  label: 'Classifications',
  description: 'Classifier execution metrics: duration, token usage, and firing rates. One row per classification event.',
  table: 'conversation_events',
  eventTypeFilter: 'classification',
  timeColumn: 'ce.timestamp',
  dimensions: [
    conversationIdDimension,
    stageIdDimension,
    { id: 'classifierId', label: 'Classifier ID', sqlExpr: `ce.event_data->>'classifierId'`, requiresConversationJoin: false, requiresUserJoin: false },
    { id: 'classifierName', label: 'Classifier Name', sqlExpr: `ce.event_data->'metadata'->>'classifierName'`, requiresConversationJoin: false, requiresUserJoin: false },
    { id: 'model', label: 'LLM Model', sqlExpr: `ce.event_data->'metadata'->'llmUsage'->>'model'`, requiresConversationJoin: false, requiresUserJoin: false },
    { id: 'provider', label: 'LLM Provider', sqlExpr: `ce.event_data->'metadata'->'llmUsage'->>'providerApiType'`, requiresConversationJoin: false, requiresUserJoin: false },
  ],
  metrics: [
    { id: 'durationMs', label: 'Classification Duration', sqlExpr: `(ce.event_data->'metadata'->>'durationMs')::numeric`, unit: 'ms' },
    ...tokenMetrics(`ce.event_data->'metadata'->'llmUsage'`),
  ],
};

const transformationsSource: SourceDef = {
  id: 'transformations',
  label: 'Transformations',
  description: 'Context transformer execution metrics: duration and token usage. One row per transformation event.',
  table: 'conversation_events',
  eventTypeFilter: 'transformation',
  timeColumn: 'ce.timestamp',
  dimensions: [
    conversationIdDimension,
    stageIdDimension,
    { id: 'transformerId', label: 'Transformer ID', sqlExpr: `ce.event_data->>'transformerId'`, requiresConversationJoin: false, requiresUserJoin: false },
    { id: 'transformerName', label: 'Transformer Name', sqlExpr: `ce.event_data->'metadata'->>'transformerName'`, requiresConversationJoin: false, requiresUserJoin: false },
    { id: 'model', label: 'LLM Model', sqlExpr: `ce.event_data->'metadata'->'llmUsage'->>'model'`, requiresConversationJoin: false, requiresUserJoin: false },
    { id: 'provider', label: 'LLM Provider', sqlExpr: `ce.event_data->'metadata'->'llmUsage'->>'providerApiType'`, requiresConversationJoin: false, requiresUserJoin: false },
  ],
  metrics: [
    { id: 'durationMs', label: 'Transformation Duration', sqlExpr: `(ce.event_data->'metadata'->>'durationMs')::numeric`, unit: 'ms' },
    ...tokenMetrics(`ce.event_data->'metadata'->'llmUsage'`),
  ],
};

const moderationSource: SourceDef = {
  id: 'moderation',
  label: 'Moderation',
  description: 'Content moderation check metrics: flag rates, durations. One row per moderation event.',
  table: 'conversation_events',
  eventTypeFilter: 'moderation',
  timeColumn: 'ce.timestamp',
  dimensions: [
    conversationIdDimension,
    stageIdDimension,
    { id: 'flagged', label: 'Flagged', sqlExpr: `(ce.event_data->>'flagged')`, requiresConversationJoin: false, requiresUserJoin: false, values: ['true', 'false'] },
  ],
  metrics: [
    { id: 'durationMs', label: 'Moderation Duration', sqlExpr: `(ce.event_data->>'durationMs')::numeric`, unit: 'ms' },
  ],
};

const eventsSource: SourceDef = {
  id: 'events',
  label: 'Events',
  description: 'All conversation events. Useful for counting event volume, breaking down by event type, and general event-level analysis without source-specific metrics.',
  table: 'conversation_events',
  timeColumn: 'ce.timestamp',
  dimensions: [
    conversationIdDimension,
    stageIdDimension,
    {
      id: 'eventType', label: 'Event Type', sqlExpr: 'ce.event_type',
      requiresConversationJoin: false, requiresUserJoin: false,
      values: ['message', 'classification', 'transformation', 'execution_plan', 'command', 'tool_call', 'conversation_start', 'conversation_resume', 'conversation_end', 'conversation_aborted', 'conversation_failed', 'jump_to_stage', 'moderation', 'variables_updated', 'user_profile_updated', 'user_input_modified', 'user_banned', 'visibility_changed', 'sample_copy_selection'],
    },
  ],
  metrics: [],
};

const stageVisitsSource: SourceDef = {
  id: 'stage_visits',
  label: 'Stage Visits',
  description: 'Stage visit metrics: visit counts and time spent on each stage. Combines conversation_start and jump_to_stage events with time-on-stage computed via window functions.',
  table: 'conversation_events',
  eventTypeFilter: ['conversation_start', 'jump_to_stage'],
  timeColumn: 'sv.timestamp',
  requiresCte: true,
  dimensions: [
    { id: 'conversationId', label: 'Conversation ID', sqlExpr: 'sv.conversation_id', requiresConversationJoin: false, requiresUserJoin: false },
    { id: 'stageId', label: 'Stage ID', sqlExpr: 'sv.stage_id', requiresConversationJoin: false, requiresUserJoin: false },
  ],
  metrics: [
    { id: 'timeOnStageMs', label: 'Time on Stage', sqlExpr: `EXTRACT(EPOCH FROM (sv.next_ts - sv.timestamp)) * 1000`, unit: 'ms' },
  ],
};

/** Map of all analytics sources keyed by SourceId */
export const SOURCES: Record<SourceId, SourceDef> = {
  conversations: conversationsSource,
  events: eventsSource,
  turns: turnsSource,
  tool_calls: toolCallsSource,
  classifications: classificationsSource,
  transformations: transformationsSource,
  moderation: moderationSource,
  stage_visits: stageVisitsSource,
};
