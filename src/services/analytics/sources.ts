/**
 * Hardcoded source catalog for the slice-and-dice analytics query engine.
 * Every SQL expression lives here — user input never reaches SQL directly.
 * This serves as both the security whitelist and the introspection data.
 */

/** Supported aggregation functions */
export const AGGREGATION_FUNCTIONS = ['count', 'sum', 'avg', 'min', 'max', 'p50', 'p75', 'p90', 'p95', 'p99'] as const;

/** Aggregation function type */
export type AggregationFn = (typeof AGGREGATION_FUNCTIONS)[number];

export const MS_AGGREGATION_FUNCTIONS: AggregationFn[] = ['avg', 'min', 'max', 'p50', 'p95', 'p99'];
export const TOKEN_AGGREGATION_FUNCTIONS: AggregationFn[] = ['sum', 'avg', 'p95'];
export const COUNT_AGGREGATION_FUNCTIONS: AggregationFn[] = ['count'];

/** Identifier for an analytics source */
export type SourceId = 'conversations' | 'events' | 'turns' | 'tool_calls' | 'classifications' | 'transformations' | 'moderation' | 'stage_visits' | 'llm_calls' | 'actions' | 'variables' | 'user_profile';

/** All valid source IDs */
export const SOURCE_IDS: SourceId[] = ['conversations', 'events', 'turns', 'tool_calls', 'classifications', 'transformations', 'moderation', 'stage_visits', 'llm_calls', 'actions', 'variables', 'user_profile'];

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
  /** SQL fragment appended to the FROM clause when this dimension is selected (e.g. a CROSS JOIN LATERAL for UNNEST). Deduplicated when multiple selected dimensions share the same join. */
  lateralJoinSql?: string;
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
  /** Aggregation functions available for this metric in the UI */
  aggregateFunctions: AggregationFn[];
  /** Whether this metric requires a LATERAL join to the user message (turns source only) */
  requiresUserJoin?: boolean;
  /** Whether this metric requires a LEFT JOIN to the conversations table (stage_visits CTE source only) */
  requiresConversationJoin?: boolean;
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
  /** Hardcoded SQL predicate appended to the WHERE clause — never derived from user input */
  additionalFilter?: string;
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
  label: 'Conversation',
  sqlExpr: 'ce.conversation_id',
  requiresConversationJoin: false,
  requiresUserJoin: false,
};

// NOTE: this doubles the name dimension, disabling 
// const stageIdDimension: DimensionDef = {
//   id: 'stageId',
//   label: 'Stage ID',
//   sqlExpr: 'ce.stage_id',
//   requiresConversationJoin: false,
//   requiresUserJoin: false,
// };

const stageNameDimension: DimensionDef = {
  id: 'stageName',
  label: 'Stage',
  sqlExpr: `ce.event_data->'metadata'->>'stageName'`,
  requiresConversationJoin: false,
  requiresUserJoin: false,
};


// ==================
// Token metrics (reused across LLM-bearing event types)
// ==================

function tokenMetrics(prefix: string): MetricDef[] {
  return [
    { id: 'promptTokens', label: 'Prompt Tokens', sqlExpr: `(${prefix}->>'promptTokens')::numeric`, unit: 'tokens', aggregateFunctions: TOKEN_AGGREGATION_FUNCTIONS },
    { id: 'completionTokens', label: 'Completion Tokens', sqlExpr: `(${prefix}->>'completionTokens')::numeric`, unit: 'tokens', aggregateFunctions: TOKEN_AGGREGATION_FUNCTIONS },
    { id: 'totalTokens', label: 'Total Tokens', sqlExpr: `(${prefix}->>'totalTokens')::numeric`, unit: 'tokens', aggregateFunctions: TOKEN_AGGREGATION_FUNCTIONS },
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
    { id: 'durationMs', label: 'Conversation Duration', sqlExpr: 'EXTRACT(EPOCH FROM (c.last_activity_at - c.created_at)) * 1000', unit: 'ms', aggregateFunctions: MS_AGGREGATION_FUNCTIONS },
    { id: 'turnsAmount', label: 'Turns Amount', sqlExpr: `(SELECT COUNT(*) FROM conversation_events ce2 WHERE ce2.project_id = c.project_id AND ce2.conversation_id = c.id AND ce2.event_type = 'message' AND ce2.event_data->>'role' = 'assistant')`, unit: 'count', aggregateFunctions: ['sum'] },
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
    stageNameDimension,
    { id: 'source', label: 'Input Source', sqlExpr: `ue.event_data->'metadata'->>'source'`, requiresConversationJoin: false, requiresUserJoin: true, values: ['text', 'voice'] },
    { id: 'model', label: 'LLM Model', sqlExpr: `ce.event_data->'metadata'->'llmUsage'->>'model'`, requiresConversationJoin: false, requiresUserJoin: false },
    { id: 'provider', label: 'LLM Provider', sqlExpr: `ce.event_data->'metadata'->'llmUsage'->>'providerApiType'`, requiresConversationJoin: false, requiresUserJoin: false },
    { id: 'prescripted', label: 'Prescripted Response', sqlExpr: `ce.event_data->'metadata'->>'prescripted'`, requiresConversationJoin: false, requiresUserJoin: false, values: ['true', 'false'] },
  ],
  metrics: [
    { id: 'totalTurnDurationMs', label: 'Total Turn Duration', sqlExpr: `(ce.event_data->'metadata'->>'totalTurnDurationMs')::numeric`, unit: 'ms', aggregateFunctions: MS_AGGREGATION_FUNCTIONS },
    { id: 'timeToFirstTokenMs', label: 'Time to First Token', sqlExpr: `(ce.event_data->'metadata'->>'timeToFirstTokenMs')::numeric`, unit: 'ms', aggregateFunctions: MS_AGGREGATION_FUNCTIONS },
    { id: 'timeToFirstTokenFromTurnStartMs', label: 'Time to First Token (from Turn Start)', sqlExpr: `(ce.event_data->'metadata'->>'timeToFirstTokenFromTurnStartMs')::numeric`, unit: 'ms', aggregateFunctions: MS_AGGREGATION_FUNCTIONS },
    { id: 'timeToFirstAudioMs', label: 'Time to First Audio', sqlExpr: `(ce.event_data->'metadata'->>'timeToFirstAudioMs')::numeric`, unit: 'ms', aggregateFunctions: MS_AGGREGATION_FUNCTIONS },
    { id: 'llmDurationMs', label: 'LLM Duration', sqlExpr: `(ce.event_data->'metadata'->>'llmDurationMs')::numeric`, unit: 'ms', aggregateFunctions: MS_AGGREGATION_FUNCTIONS },
    { id: 'ttsDurationMs', label: 'TTS Duration', sqlExpr: `(ce.event_data->'metadata'->>'ttsDurationMs')::numeric`, unit: 'ms', aggregateFunctions: MS_AGGREGATION_FUNCTIONS },
    { id: 'ttsConnectDurationMs', label: 'TTS Connection Duration', sqlExpr: `(ce.event_data->'metadata'->>'ttsConnectDurationMs')::numeric`, unit: 'ms', aggregateFunctions: MS_AGGREGATION_FUNCTIONS },
    { id: 'promptRenderDurationMs', label: 'Prompt Render Duration', sqlExpr: `(ce.event_data->'metadata'->>'promptRenderDurationMs')::numeric`, unit: 'ms', aggregateFunctions: MS_AGGREGATION_FUNCTIONS },
    { id: 'moderationDurationMs', label: 'Moderation Duration', sqlExpr: `(ce.event_data->'metadata'->>'moderationDurationMs')::numeric`, unit: 'ms', aggregateFunctions: MS_AGGREGATION_FUNCTIONS },
    { id: 'stageTransitionDurationMs', label: 'Stage Transition Duration', sqlExpr: `(ue.event_data->'metadata'->>'stageTransitionDurationMs')::numeric`, unit: 'ms', aggregateFunctions: MS_AGGREGATION_FUNCTIONS, requiresUserJoin: true },
    { id: 'processingDurationMs', label: 'Processing Duration', sqlExpr: `(ue.event_data->'metadata'->>'processingDurationMs')::numeric`, unit: 'ms', aggregateFunctions: MS_AGGREGATION_FUNCTIONS, requiresUserJoin: true },
    { id: 'actionsDurationMs', label: 'Actions Duration', sqlExpr: `(ue.event_data->'metadata'->>'actionsDurationMs')::numeric`, unit: 'ms', aggregateFunctions: MS_AGGREGATION_FUNCTIONS, requiresUserJoin: true },
    { id: 'asrDurationMs', label: 'ASR Duration', sqlExpr: `(ue.event_data->'metadata'->>'asrDurationMs')::numeric`, unit: 'ms', aggregateFunctions: MS_AGGREGATION_FUNCTIONS, requiresUserJoin: true },
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
    stageNameDimension,
    //{ id: 'toolId', label: 'Tool ID', sqlExpr: `ce.event_data->>'toolId'`, requiresConversationJoin: false, requiresUserJoin: false },
    { id: 'toolName', label: 'Tool Name', sqlExpr: `ce.event_data->>'toolName'`, requiresConversationJoin: false, requiresUserJoin: false },
    { id: 'toolType', label: 'Tool Type', sqlExpr: `ce.event_data->>'toolType'`, requiresConversationJoin: false, requiresUserJoin: false, values: ['smart_function', 'webhook', 'script'] },
    { id: 'success', label: 'Success', sqlExpr: `(ce.event_data->>'success')`, requiresConversationJoin: false, requiresUserJoin: false, values: ['true', 'false'] },
    { id: 'sourceActionName', label: 'Source Action', sqlExpr: `ce.event_data->>'sourceActionName'`, requiresConversationJoin: false, requiresUserJoin: false },
  ],
  metrics: [
    { id: 'durationMs', label: 'Execution Duration', sqlExpr: `(ce.event_data->'metadata'->>'durationMs')::numeric`, unit: 'ms', aggregateFunctions: MS_AGGREGATION_FUNCTIONS },
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
    stageNameDimension,
    //{ id: 'classifierId', label: 'Classifier ID', sqlExpr: `ce.event_data->>'classifierId'`, requiresConversationJoin: false, requiresUserJoin: false },
    { id: 'classifierName', label: 'Classifier', sqlExpr: `ce.event_data->'metadata'->>'classifierName'`, requiresConversationJoin: false, requiresUserJoin: false },
    { id: 'model', label: 'LLM Model', sqlExpr: `ce.event_data->'metadata'->'llmUsage'->>'model'`, requiresConversationJoin: false, requiresUserJoin: false },
    { id: 'provider', label: 'LLM Provider', sqlExpr: `ce.event_data->'metadata'->'llmUsage'->>'providerApiType'`, requiresConversationJoin: false, requiresUserJoin: false },
    { id: 'actionName', label: 'Action Name', sqlExpr: `act_item->>'name'`, requiresConversationJoin: false, requiresUserJoin: false, lateralJoinSql: `CROSS JOIN LATERAL jsonb_array_elements(ce.event_data->'actions') AS clf_item\nCROSS JOIN LATERAL jsonb_array_elements(clf_item->'actions') AS act_item` },
  ],
  metrics: [
    { id: 'durationMs', label: 'Classification Duration', sqlExpr: `(ce.event_data->'metadata'->>'durationMs')::numeric`, unit: 'ms', aggregateFunctions: MS_AGGREGATION_FUNCTIONS },
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
    stageNameDimension,
    //{ id: 'transformerId', label: 'Transformer ID', sqlExpr: `ce.event_data->>'transformerId'`, requiresConversationJoin: false, requiresUserJoin: false },
    { id: 'transformerName', label: 'Transformer', sqlExpr: `ce.event_data->'metadata'->>'transformerName'`, requiresConversationJoin: false, requiresUserJoin: false },
    { id: 'model', label: 'LLM Model', sqlExpr: `ce.event_data->'metadata'->'llmUsage'->>'model'`, requiresConversationJoin: false, requiresUserJoin: false },
    { id: 'provider', label: 'LLM Provider', sqlExpr: `ce.event_data->'metadata'->'llmUsage'->>'providerApiType'`, requiresConversationJoin: false, requiresUserJoin: false },
  ],
  metrics: [
    { id: 'durationMs', label: 'Transformation Duration', sqlExpr: `(ce.event_data->'metadata'->>'durationMs')::numeric`, unit: 'ms', aggregateFunctions: MS_AGGREGATION_FUNCTIONS },
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
    stageNameDimension,
    { id: 'flagged', label: 'Flagged', sqlExpr: `(ce.event_data->>'flagged')`, requiresConversationJoin: false, requiresUserJoin: false, values: ['true', 'false'] },
    { id: 'detectedCategory', label: 'Detected Category', sqlExpr: `detected_category`, requiresConversationJoin: false, requiresUserJoin: false, lateralJoinSql: `CROSS JOIN LATERAL jsonb_array_elements_text(ce.event_data->'detectedCategories') AS detected_category` },
    { id: 'blockingCategory', label: 'Blocking Category', sqlExpr: `blocking_category`, requiresConversationJoin: false, requiresUserJoin: false, lateralJoinSql: `CROSS JOIN LATERAL jsonb_array_elements_text(ce.event_data->'blockingCategories') AS blocking_category` },
  ],
  metrics: [
    { id: 'durationMs', label: 'Moderation Duration', sqlExpr: `(ce.event_data->>'durationMs')::numeric`, unit: 'ms', aggregateFunctions: MS_AGGREGATION_FUNCTIONS },
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
    stageNameDimension,
    {
      id: 'eventType', label: 'Event Type', sqlExpr: 'ce.event_type',
      requiresConversationJoin: false, requiresUserJoin: false,
      values: ['message', 'classification', 'transformation', 'execution_plan', 'command', 'tool_call', 'conversation_start', 'conversation_resume', 'conversation_end', 'conversation_aborted', 'conversation_failed', 'jump_to_stage', 'moderation', 'variables_updated', 'user_profile_updated', 'user_input_modified', 'user_banned', 'visibility_changed', 'sample_copy_selection'],
    },
    { id: 'sourceActionName', label: 'Source Action', sqlExpr: `ce.event_data->>'sourceActionName'`, requiresConversationJoin: false, requiresUserJoin: false },
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
    { id: 'conversationId', label: 'Conversation', sqlExpr: 'sv.conversation_id', requiresConversationJoin: false, requiresUserJoin: false },
    { id: 'stageName', label: 'Stage Name', sqlExpr: 's.name', requiresConversationJoin: false, requiresUserJoin: false, lateralJoinSql: 'LEFT JOIN stages s ON s.id = sv.stage_id' },
    { id: 'stageSource', label: 'Stage Source', sqlExpr: 'sv.source_type', requiresConversationJoin: false, requiresUserJoin: false, values: ['starting_stage', 'transition'] },
    { id: 'fromStageName', label: 'From Stage Name', sqlExpr: 'fs.name', requiresConversationJoin: false, requiresUserJoin: false, lateralJoinSql: 'LEFT JOIN stages fs ON fs.id = sv.from_stage_id' },
  ],
  metrics: [
    { id: 'timeOnStageMs', label: 'Time on Stage', sqlExpr: `EXTRACT(EPOCH FROM (sv.next_ts - sv.timestamp)) * 1000`, unit: 'ms', aggregateFunctions: MS_AGGREGATION_FUNCTIONS },
    { id: 'conversationLengthMs', label: 'Conversation Length', sqlExpr: `EXTRACT(EPOCH FROM (c.last_activity_at - c.created_at)) * 1000`, unit: 'ms', aggregateFunctions: MS_AGGREGATION_FUNCTIONS, requiresConversationJoin: true },
    { id: 'turnsAmount', label: 'Turns Amount', sqlExpr: `(SELECT COUNT(*) FROM conversation_events ce_turns WHERE ce_turns.conversation_id = sv.conversation_id AND ce_turns.event_type = 'message' AND ce_turns.event_data->>'role' = 'assistant' AND ce_turns.timestamp >= sv.timestamp AND (sv.next_ts IS NULL OR ce_turns.timestamp < sv.next_ts))`, unit: 'count', aggregateFunctions: COUNT_AGGREGATION_FUNCTIONS },
  ],
};

const llmCallsSource: SourceDef = {
  id: 'llm_calls',
  label: 'LLM Calls',
  description: 'All LLM invocations across turns, classifications, transformations, and smart function tool calls. Filtered to events that contain llmUsage. One row per LLM call regardless of event type.',
  table: 'conversation_events',
  eventTypeFilter: ['message', 'classification', 'transformation', 'tool_call'],
  additionalFilter: `ce.event_data->'metadata'->'llmUsage' IS NOT NULL`,
  timeColumn: 'ce.timestamp',
  dimensions: [
    conversationIdDimension,
    stageNameDimension,
    { id: 'eventType', label: 'Event Type', sqlExpr: 'ce.event_type', requiresConversationJoin: false, requiresUserJoin: false, values: ['message', 'classification', 'transformation', 'tool_call'] },
    { id: 'model', label: 'LLM Model', sqlExpr: `ce.event_data->'metadata'->'llmUsage'->>'model'`, requiresConversationJoin: false, requiresUserJoin: false },
    { id: 'provider', label: 'LLM Provider', sqlExpr: `ce.event_data->'metadata'->'llmUsage'->>'providerApiType'`, requiresConversationJoin: false, requiresUserJoin: false },
  ],
  metrics: [
    { id: 'durationMs', label: 'LLM Duration', sqlExpr: `COALESCE((ce.event_data->'metadata'->>'llmDurationMs')::numeric, (ce.event_data->'metadata'->>'durationMs')::numeric)`, unit: 'ms', aggregateFunctions: MS_AGGREGATION_FUNCTIONS },
    ...tokenMetrics(`ce.event_data->'metadata'->'llmUsage'`),
  ],
};

const actionsSource: SourceDef = {
  id: 'actions',
  label: 'Actions',
  description: 'Action execution analytics from execution_plan events. One row per action per execution plan. Tracks which actions fired, in which stages and lifecycle contexts.',
  table: 'conversation_events',
  eventTypeFilter: 'execution_plan',
  timeColumn: 'ce.timestamp',
  dimensions: [
    conversationIdDimension,
    stageNameDimension,
    { id: 'actionName', label: 'Action Name', sqlExpr: `action_name`, requiresConversationJoin: false, requiresUserJoin: false, lateralJoinSql: `CROSS JOIN LATERAL jsonb_array_elements_text(ce.event_data->'actions') AS action_name` },
    { id: 'lifecycleContext', label: 'Lifecycle Context', sqlExpr: `ce.event_data->>'lifecycleContext'`, requiresConversationJoin: false, requiresUserJoin: false, values: ['on_enter', 'on_leave', 'on_fallback', 'conversation_start', 'conversation_resume', 'conversation_end', 'conversation_abort', 'conversation_failed'] },
  ],
  metrics: [],
};

const variablesSource: SourceDef = {
  id: 'variables',
  label: 'Variables',
  description: 'Variable change analytics from variables_updated events. One row per changed variable name per event.',
  table: 'conversation_events',
  eventTypeFilter: 'variables_updated',
  timeColumn: 'ce.timestamp',
  dimensions: [
    conversationIdDimension,
    stageNameDimension,
    { id: 'variableName', label: 'Variable Name', sqlExpr: `variable_name`, requiresConversationJoin: false, requiresUserJoin: false, lateralJoinSql: `CROSS JOIN LATERAL jsonb_array_elements_text(ce.event_data->'changedVariableNames') AS variable_name` },
    { id: 'sourceActionName', label: 'Source Action', sqlExpr: `ce.event_data->>'sourceActionName'`, requiresConversationJoin: false, requiresUserJoin: false },
  ],
  metrics: [],
};

const userProfileSource: SourceDef = {
  id: 'user_profile',
  label: 'User Profile',
  description: 'User profile change analytics from user_profile_updated events. One row per changed profile field per event.',
  table: 'conversation_events',
  eventTypeFilter: 'user_profile_updated',
  timeColumn: 'ce.timestamp',
  dimensions: [
    conversationIdDimension,
    stageNameDimension,
    { id: 'profileName', label: 'Profile Field Name', sqlExpr: `profile_name`, requiresConversationJoin: false, requiresUserJoin: false, lateralJoinSql: `CROSS JOIN LATERAL jsonb_array_elements_text(ce.event_data->'changedProfileNames') AS profile_name` },
    { id: 'sourceActionName', label: 'Source Action', sqlExpr: `ce.event_data->>'sourceActionName'`, requiresConversationJoin: false, requiresUserJoin: false },
  ],
  metrics: [],
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
  llm_calls: llmCallsSource,
  actions: actionsSource,
  variables: variablesSource,
  user_profile: userProfileSource,
};
