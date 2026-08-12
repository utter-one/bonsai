import { pgTable, text, timestamp, boolean, jsonb, integer, serial, primaryKey, foreignKey, pgView, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations, isNull, isNotNull } from 'drizzle-orm';
import { StageAction, Effect, ToolParameter, StageActionParameter } from '../types/actions';
import { FieldDescriptor } from '../types/parameters';
import { ConversationState } from '../types/conversationEvents';
import { LlmProviderConfig, LlmSettings } from '../services/providers/llm/LlmProviderFactory';
import { AsrProviderConfig } from '../services/providers/asr/AsrProviderFactory';
import { TtsProviderConfig, TtsSettings } from '../services/providers/tts/TtsProviderFactory';
import { StorageProviderConfig, ChannelProviderConfig } from '../http/contracts/provider';
import { ConversationEventData, ConversationEventType } from '../types/conversationEvents';
import { FillerSettings } from '../http/contracts/agent';
import type { ApiKeySettings } from '../http/contracts/apiKey';
import type { IterationResultData } from '../types/benchmark';


export type ProviderConfig = LlmProviderConfig | AsrProviderConfig | TtsProviderConfig | StorageProviderConfig | ChannelProviderConfig;

// User table
export const users = pgTable('users', {
  id: text('id').notNull(),
  projectId: text('project_id').notNull().references(() => projects.id),
  profile: jsonb('profile').notNull().$type<Record<string, any>>(),
  banned: boolean('banned').notNull().default(false),
  banReason: text('ban_reason'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.id] }),
]);

// Conversation table
export const conversations = pgTable('conversations', {
  id: text('id').notNull(),
  projectId: text('project_id').notNull().references(() => projects.id),
  userId: text('user_id').notNull(),
  sessionId: text('session_id').notNull(),
  stageId: text('stage_id').notNull(),
  startingStageId: text('starting_stage_id'),
  endingStageId: text('ending_stage_id'),
  stageVars: jsonb('stage_vars').$type<Record<string, Record<string, any>>>(),
  status: text('status').notNull().$type<ConversationState>().default('initialized'),
  statusDetails: text('status_reason').default(null),
  direction: text('direction').notNull().$type<'incoming' | 'outgoing'>().default('incoming'),
  metadata: jsonb('metadata').$type<Record<string, any>>(),
  lastActivityAt: timestamp('last_activity_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.id] }),
  foreignKey({ columns: [table.projectId, table.userId], foreignColumns: [users.projectId, users.id] }),
  index('idx_conversations_project_user').on(table.projectId, table.userId),
]);

// ConversationEvent table
export const conversationEvents = pgTable('conversation_events', {
  id: text('id').notNull(),
  projectId: text('project_id').notNull(),
  conversationId: text('conversation_id').notNull(),
  eventType: text('event_type').notNull().$type<ConversationEventType>(),
  eventData: jsonb('event_data').notNull().$type<ConversationEventData>(),
  stageId: text('stage_id'),
  timestamp: timestamp('timestamp').notNull(),
  metadata: jsonb('metadata').$type<Record<string, any>>(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.id] }),
  foreignKey({ columns: [table.projectId, table.conversationId], foreignColumns: [conversations.projectId, conversations.id] }).onDelete('cascade'),
  index('idx_conversation_events_project_conversation').on(table.projectId, table.conversationId),
  index('idx_conversation_events_project_type_timestamp').on(table.projectId, table.eventType, table.timestamp),
]);

// Operator table
export const operators = pgTable('operators', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  roles: jsonb('roles').notNull().$type<string[]>(),
  password: text('password').notNull(),
  metadata: jsonb('metadata').$type<Record<string, any>>(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Project table
export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
asrConfig: jsonb('asr_config').$type<{
    asrProviderId?: string;
    settings?: unknown;
    unintelligiblePlaceholder?: string;
    voiceActivityDetection?: boolean;
    silenceTimeoutMs?: number;
    maxSilences?: number;
    silencePlaceholder?: string;
    serverVad?: {
      algorithm?: 'legacy' | 'silero' | 'firered';
      mode?: number;
      frameDurationMs?: 10 | 20 | 30;
      silencePaddingMs?: number;
      autoEndSilenceDurationMs?: number;
      gracePeriodMs?: number;
      model?: 'v5' | 'legacy';
      positiveSpeechThreshold?: number;
      negativeSpeechThreshold?: number;
      frameSamples?: number;
      redemptionFrames?: number;
      preSpeechPadFrames?: number;
      minSpeechFrames?: number;
      submitUserSpeechOnPause?: boolean;
      speechThreshold?: number;
      smoothWindowSize?: number;
      minSpeechFrame?: number;
      maxSpeechFrame?: number;
      minSilenceFrame?: number;
      padStartFrame?: number;
      smartTurn?: {
        enabled?: boolean;
        threshold?: number;
      };
      bargeInSilenceTimeout?: number;
      bargeInSilencePlaceholder?: string;
    };
  }>(),
  acceptVoice: boolean('accept_voice').notNull().default(true),
  generateVoice: boolean('generate_voice').notNull().default(true),
  storageConfig: jsonb('storage_config').$type<{
    storageProviderId?: string;
    settings?: unknown;
  }>(),
  moderationConfig: jsonb('moderation_config').$type<{
    enabled: boolean;
    llmProviderId: string;
    blockedCategories?: string[];
    mode?: 'strict' | 'standard';
  }>(),
  costManagementConfig: jsonb('cost_management_config').$type<{
    limits: Record<string, Record<string, {
      outputTokensLimits?: { completion?: number; classification?: number; tool?: number; transformation?: number; filler?: number };
      inputTokensLimits?: { completion?: number; classification?: number; tool?: number; transformation?: number; filler?: number };
    }>>;
  }>(),
  constants: jsonb('constants').$type<Record<string, any>>(),
  metadata: jsonb('metadata').$type<Record<string, any>>(),
  timezone: text('timezone'),
  languageCode: text('language_code'),
  autoCreateUsers: boolean('auto_create_users').notNull().default(false),
  userProfileVariableDescriptors: jsonb('user_profile_variable_descriptors').notNull().default([]).$type<FieldDescriptor[]>(),
  defaultGuardrailClassifierId: text('default_guardrail_classifier_id'),
  sampleCopyConfig: jsonb('sample_copy_config').$type<{
    defaultClassifierId?: string;
  }>(),
  startingStageId: text('starting_stage_id'),
  conversationTimeoutSeconds: integer('conversation_timeout_seconds'),
  recordingConfig: jsonb('recording_config').$type<{ enabled: boolean; recordInput?: boolean; recordOutput?: boolean; format?: string }>(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  archivedAt: timestamp('archived_at'),
  archivedBy: text('archived_by').references(() => operators.id),
});

/**
 * View of active (non-archived) projects.
 * Use in list operations to exclude entities belonging to archived projects.
 */
export const activeProjects = pgView('active_projects').as((qb) =>
  qb.select().from(projects).where(isNull(projects.archivedAt)));

/**
 * View of archived projects.
 * Use in update operations to detect and block modifications to archived projects.
 */
export const archivedProjects = pgView('archived_projects').as((qb) =>
  qb.select().from(projects).where(isNotNull(projects.archivedAt)));

// Agent table
export const agents = pgTable('agents', {
  id: text('id').notNull(),
  projectId: text('project_id').notNull().references(() => projects.id),
  name: text('name').notNull(),
  description: text('description'),
  prompt: text('prompt').notNull(),
  ttsProviderId: text('tts_provider_id').references(() => providers.id),
  ttsSettings: jsonb('tts_settings').$type<TtsSettings>(),
  tags: jsonb('tags').notNull().default([]).$type<string[]>(),
  metadata: jsonb('metadata').$type<Record<string, any>>(),
  fillerSettings: jsonb('filler_settings').$type<FillerSettings>(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.id] }),
]);

// Classifier table
export const classifiers = pgTable('classifiers', {
  id: text('id').notNull(),
  projectId: text('project_id').notNull().references(() => projects.id),
  name: text('name').notNull(),
  description: text('description'),
  prompt: text('prompt').notNull(),
  llmProviderId: text('llm_provider_id'),
  llmSettings: jsonb('llm_settings').$type<LlmSettings>(),
  tags: jsonb('tags').notNull().default([]).$type<string[]>(),
  metadata: jsonb('metadata').$type<Record<string, any>>(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.id] }),
]);

// ContextTransformer table
export const contextTransformers = pgTable('context_transformers', {
  id: text('id').notNull(),
  projectId: text('project_id').notNull().references(() => projects.id),
  name: text('name').notNull(),
  description: text('description'),
  prompt: text('prompt').notNull(),
  contextFields: jsonb('context_fields').$type<string[]>(),
  llmProviderId: text('llm_provider_id'),
  llmSettings: jsonb('llm_settings').$type<LlmSettings>(),
  tags: jsonb('tags').notNull().default([]).$type<string[]>(),
  metadata: jsonb('metadata').$type<Record<string, any>>(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.id] }),
]);

export type ToolInputType = 'text' | 'image' | 'multi-modal';
export type ToolOutputType = 'text' | 'image' | 'multi-modal';
export type ToolType = 'smart_function' | 'webhook' | 'script';

// Tool table
export const tools = pgTable('tools', {
  id: text('id').notNull(),
  projectId: text('project_id').notNull().references(() => projects.id),
  name: text('name').notNull(),
  description: text('description'),
  type: text('type').$type<ToolType>().notNull().default('smart_function'),
  // smart_function fields
  prompt: text('prompt'),
  llmProviderId: text('llm_provider_id'),
  llmSettings: jsonb('llm_settings').$type<LlmSettings>(),
  inputType: text('input_type').$type<ToolInputType>(),
  outputType: text('output_type').$type<ToolOutputType>(),
  // webhook fields
  url: text('url'),
  webhookMethod: text('webhook_method'),
  webhookHeaders: jsonb('webhook_headers').$type<Record<string, string>>(),
  webhookBody: text('webhook_body'),
  // script fields
  code: text('code'),
  parameters: jsonb('parameters').notNull().default([]).$type<ToolParameter[]>(),
  tags: jsonb('tags').notNull().default([]).$type<string[]>(),
  metadata: jsonb('metadata').$type<Record<string, any>>(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.id] }),
]);

export type StageEnterBehavior = 'generate_response' | 'await_user_input';

// Stage table
export const stages = pgTable('stages', {
  id: text('id').notNull(),
  projectId: text('project_id').notNull().references(() => projects.id),
  name: text('name').notNull(),
  description: text('description'),
  prompt: text('prompt').notNull(),
  llmProviderId: text('llm_provider_id'),
  llmSettings: jsonb('llm_settings').$type<LlmSettings>(),
  agentId: text('agent_id').notNull(),
  enterBehavior: text('enter_behavior').notNull().$type<StageEnterBehavior>().default('generate_response'),
  useKnowledge: boolean('use_knowledge').notNull().default(false),
  knowledgeTags: jsonb('knowledge_tags').notNull().default([]).$type<string[]>(),
  useGlobalActions: boolean('use_global_actions').notNull().default(true),
  globalActions: jsonb('global_actions').notNull().default([]).$type<string[]>(),
  variableDescriptors: jsonb('variable_descriptors').notNull().default([]).$type<FieldDescriptor[]>(),
  actions: jsonb('actions').notNull().default({}).$type<Record<string, StageAction>>(),
  defaultClassifierId: text('default_classifier_id'),
  transformerIds: jsonb('transformer_ids').notNull().default([]).$type<string[]>(),
  tags: jsonb('tags').notNull().default([]).$type<string[]>(),
  metadata: jsonb('metadata').$type<Record<string, any>>(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.id] }),
  foreignKey({ columns: [table.projectId, table.agentId], foreignColumns: [agents.projectId, agents.id] }),
  foreignKey({ columns: [table.projectId, table.defaultClassifierId], foreignColumns: [classifiers.projectId, classifiers.id] }),
]);

// KnowledgeCategory table
export const knowledgeCategories = pgTable('knowledge_categories', {
  id: text('id').notNull(),
  projectId: text('project_id').notNull().references(() => projects.id),
  name: text('name').notNull(),
  promptTrigger: text('prompt_trigger').notNull(),
  tags: jsonb('tags').notNull().default([]).$type<string[]>(),
  order: integer('order').notNull().default(0),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.id] }),
]);

// KnowledgeItem table
export const knowledgeItems = pgTable('knowledge_items', {
  id: text('id').notNull(),
  projectId: text('project_id').notNull(),
  categoryId: text('category_id').notNull(),
  questions: text('questions').array().notNull().default([]),
  answer: text('answer').notNull(),
  order: integer('order').notNull().default(0),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.id] }),
  foreignKey({ columns: [table.projectId, table.categoryId], foreignColumns: [knowledgeCategories.projectId, knowledgeCategories.id] }),
]);

export type SamplingMethod = 'random' | 'round_robin';
export type SampleCopyMode = 'regular' | 'forced';

// CopyDecorator table
export const copyDecorators = pgTable('copy_decorators', {
  id: text('id').notNull(),
  projectId: text('project_id').notNull().references(() => projects.id),
  name: text('name').notNull(),
  template: text('template').notNull(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.id] }),
  uniqueIndex('copy_decorators_project_id_name_unique').on(table.projectId, table.name),
]);

// SampleCopy table
export const sampleCopies = pgTable('sample_copies', {
  id: text('id').notNull(),
  projectId: text('project_id').notNull().references(() => projects.id),
  name: text('name').notNull(),
  stages: jsonb('stages').$type<string[]>(),
  agents: jsonb('agents').$type<string[]>(),
  promptTrigger: text('prompt_trigger').notNull(),
  classifierOverrideId: text('classifier_override_id'),
  content: jsonb('content').notNull().default([]).$type<string[]>(),
  amount: integer('amount').notNull().default(1),
  samplingMethod: text('sampling_method').notNull().default('random').$type<SamplingMethod>(),
  mode: text('mode').notNull().default('regular').$type<SampleCopyMode>(),
  decoratorId: text('decorator_id'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.id] }),
  foreignKey({ columns: [table.projectId, table.decoratorId], foreignColumns: [copyDecorators.projectId, copyDecorators.id] }),
  uniqueIndex('sample_copies_project_id_name_unique').on(table.projectId, table.name),
]);

// GlobalAction table
export const globalActions = pgTable('global_actions', {
  id: text('id').notNull(),
  projectId: text('project_id').notNull().references(() => projects.id),
  name: text('name').notNull(),
  condition: text('condition'),
  triggerOnUserInput: boolean('trigger_on_user_input').notNull().default(true),
  triggerOnClientCommand: boolean('trigger_on_client_command').notNull().default(false),
  triggerOnExternal: boolean('trigger_on_external').notNull().default(false),
  classificationTrigger: text('classification_trigger'),
  overrideClassifierId: text('override_classifier_id'),
  parameters: jsonb('parameters').notNull().default([]).$type<StageActionParameter[]>(),
  effects: jsonb('effects').notNull().default([]).$type<Effect[]>(),
  examples: jsonb('examples').$type<string[]>(),
  tags: jsonb('tags').notNull().default([]).$type<string[]>(),
  metadata: jsonb('metadata').$type<Record<string, any>>(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.id] }),
]);

// Guardrail table
export const guardrails = pgTable('guardrails', {
  id: text('id').notNull(),
  projectId: text('project_id').notNull().references(() => projects.id),
  name: text('name').notNull(),
  condition: text('condition'),
  classificationTrigger: text('classification_trigger'),
  effects: jsonb('effects').notNull().default([]).$type<Effect[]>(),
  examples: jsonb('examples').$type<string[]>(),
  tags: jsonb('tags').notNull().default([]).$type<string[]>(),
  metadata: jsonb('metadata').$type<Record<string, any>>(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.id] }),
]);

// Issue table
export const issues = pgTable('issues', {
  id: serial('id').notNull(),
  projectId: text('project_id').notNull().references(() => projects.id),
  environment: text('environment'),
  buildVersion: text('build_version'),
  stage: text('stage'),
  conversationId: text('conversation_id'),
  eventIndex: integer('event_index'),
  userId: text('user_id'),
  severity: text('severity').notNull(),
  category: text('category').notNull(),
  bugDescription: text('bug_description').notNull(),
  expectedBehaviour: text('expected_behaviour').notNull(),
  comments: text('comments').notNull(),
  status: text('status').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.id] }),
]);

// Environment table
export const environments = pgTable('environments', {
  id: text('id').primaryKey(),
  description: text('description').notNull(),
  url: text('url').notNull(),
  login: text('login').notNull(),
  password: text('password').notNull(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Provider table
export const providers = pgTable('providers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  providerType: text('provider_type').notNull(), // asr, tts, llm, embeddings, storage
  apiType: text('api_type').notNull(), // azure, elevenlabs, openai, anthropic, gemini, groq, s3, azure-blob, gcs, local
  config: jsonb('config').notNull().$type<ProviderConfig>(),
  createdBy: text('created_by').references(() => operators.id),
  tags: jsonb('tags').$type<string[]>(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ApiKey table
export const apiKeys = pgTable('api_keys', {
  id: text('id').notNull(),
  projectId: text('project_id').notNull().references(() => projects.id),
  name: text('name').notNull(),
  key: text('key').notNull().unique(),
  lastUsedAt: timestamp('last_used_at'),
  isActive: boolean('is_active').notNull().default(true),
  metadata: jsonb('metadata').$type<Record<string, any>>(),
  keySettings: jsonb('key_settings').$type<ApiKeySettings>(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.id] }),
  index('idx_api_keys_project_is_active').on(table.projectId, table.isActive),
]);

// AuditLog table
export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  action: text('action').notNull(),
  entityId: text('entity_id').notNull(),
  entityType: text('entity_type').notNull(),
  projectId: text('project_id'),
  oldEntity: jsonb('old_entity').$type<Record<string, any>>(),
  newEntity: jsonb('new_entity').$type<Record<string, any>>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('idx_audit_logs_project_id').on(table.projectId),
  index('idx_audit_logs_created_at').on(table.createdAt),
]);

// SavedSliceQuery table
export const savedSliceQueries = pgTable('saved_slice_queries', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  operatorId: text('operator_id').references(() => operators.id, { onDelete: 'set null' }),
  query: jsonb('query').notNull().$type<Record<string, any>>(),
  isShared: boolean('is_shared').notNull().default(false),
  metadata: jsonb('metadata').$type<Record<string, any>>(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('saved_slice_queries_project_id_name_unique').on(table.projectId, table.name),
  index('idx_saved_slice_queries_project_id').on(table.projectId),
  index('idx_saved_slice_queries_operator_id').on(table.operatorId),
]);

// SavedFunnelQuery table
export const savedFunnelQueries = pgTable('saved_funnel_queries', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  operatorId: text('operator_id').references(() => operators.id, { onDelete: 'set null' }),
  query: jsonb('query').notNull().$type<Record<string, any>>(),
  isShared: boolean('is_shared').notNull().default(false),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('saved_funnel_queries_project_id_name_unique').on(table.projectId, table.name),
  index('idx_saved_funnel_queries_project_id').on(table.projectId),
  index('idx_saved_funnel_queries_operator_id').on(table.operatorId),
]);

export type ArtifactType = 'user_voice' | 'user_transcript' | 'ai_voice' | 'ai_transcript' | 'tool_input' | 'tool_output' | 'attachment' | 'other';

// Secrets table — stores AES-256-GCM encrypted secret values
// Each row holds a single encrypted value; the ID is embedded in `@sec:name:id` references
export const secrets = pgTable('secrets', {
  id: text('id').primaryKey(),
  encryptedValue: text('encrypted_value').notNull(),
  iv: text('iv').notNull(),
  tag: text('tag').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ConversationArtifact table
export const conversationArtifacts = pgTable('conversation_artifacts', {
  id: text('id').notNull(),
  projectId: text('project_id').notNull(),
  conversationId: text('conversation_id').notNull(),
  artifactType: text('artifact_type').notNull().$type<ArtifactType>(),
  eventId: text('event_id'),
  inputTurnId: text('input_turn_id'),
  outputTurnId: text('output_turn_id'),
  storageKey: text('storage_key'),
  storageUrl: text('storage_url'),
  data: text('data'), // Binary data as base64 - optional since we may store in external storage
  mimeType: text('mime_type').notNull(),
  fileSize: integer('file_size').notNull(),
  metadata: jsonb('metadata').$type<Record<string, any>>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.id] }),
  foreignKey({ columns: [table.projectId, table.conversationId], foreignColumns: [conversations.projectId, conversations.id] }).onDelete('cascade'),
]);

/** Comparison modes for evaluation assertions */
export type EvaluationComparisonMode = 'exists' | 'not_exists' | 'eq' | 'contains' | 'includes' | 'matches' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin';

/** Expected value entry with optional comparison mode */
export type ExpectedValueEntry = {
  value?: unknown;
  mode?: EvaluationComparisonMode;
};

/** Entry in the data extraction configuration: a stage variable with an optional expected value and comparison mode */
export type DataExtractionEntry = {
  stageId: string;
  varName: string;
  expectedValue?: unknown;
  expectedMode?: EvaluationComparisonMode;
};

/** Status of a scenario run or scenario conversation */
export type ScenarioRunStatus = 'queued' | 'in_progress' | 'passed' | 'failed' | 'cancelled' | 'error';

/** Possible outcomes for a single test run conversation (persisted on scenarioConversations) */
export type TestRunStatus = 'conversation_ended' | 'conversation_aborted' | 'conversation_failed' | 'max_turns_reached' | 'tester_hung_up';

/** Detailed test statistics for a scenario run or scenario conversation */
export type TestStatistics = {
  passedTests: number;
  failedTests: number;
};

// Tester table — persona that acts as a user in scenario testing
export const testers = pgTable('testers', {
  id: text('id').notNull(),
  projectId: text('project_id').notNull().references(() => projects.id),
  name: text('name').notNull(),
  description: text('description'),
  prompt: text('prompt').notNull(),
  hangUpPrompt: text('hang_up_prompt'),
  llmProviderId: text('llm_provider_id'),
  llmSettings: jsonb('llm_settings').$type<LlmSettings>(),
  userProfile: jsonb('user_profile').$type<Record<string, unknown>>(),
  tags: jsonb('tags').notNull().default([]).$type<string[]>(),
  metadata: jsonb('metadata').$type<Record<string, any>>(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.id] }),
]);

// Scenario table — conversation scenario definition for automated testing
export const scenarios = pgTable('scenarios', {
  id: text('id').notNull(),
  projectId: text('project_id').notNull().references(() => projects.id),
  name: text('name').notNull(),
  description: text('description'),
  language: text('language').notNull(),
  startingStageId: text('starting_stage_id').notNull(),
  maxTurns: integer('max_turns').notNull(),
  endingStageIds: jsonb('ending_stage_ids').notNull().default([]).$type<string[]>(),
  personaCanHangUp: boolean('persona_can_hang_up').notNull().default(false),
  conversationOpener: text('conversation_opener'),
  dataExtraction: jsonb('data_extraction').$type<DataExtractionEntry[]>(),
  contextTransformerId: text('context_transformer_id'),
  dataPostProcessingExpected: jsonb('data_post_processing_expected').$type<Record<string, ExpectedValueEntry>>(),
  tags: jsonb('tags').notNull().default([]).$type<string[]>(),
  metadata: jsonb('metadata').$type<Record<string, any>>(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.id] }),
]);

// ScenarioRun table — an instance of running a scenario with one or more testers
export const scenarioRuns = pgTable('scenario_runs', {
  id: text('id').notNull(),
  projectId: text('project_id').notNull().references(() => projects.id),
  scenarioId: text('scenario_id').notNull(),
  testers: jsonb('testers').notNull().default({}).$type<Record<string, number>>(),
  totalConversations: integer('total_conversations').notNull(),
  status: text('status').notNull().$type<ScenarioRunStatus>().default('queued'),
  statusDetails: text('status_details'),
  errorCount: integer('error_count').notNull().default(0),
  testStatistics: jsonb('test_statistics').$type<TestStatistics>(),
  metadata: jsonb('metadata').$type<Record<string, any>>(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.id] }),
  index('idx_scenario_runs_project_scenario').on(table.projectId, table.scenarioId),
]);

// ScenarioConversation table — individual conversation executed as part of a scenario run
export const scenarioConversations = pgTable('scenario_conversations', {
  id: text('id').notNull(),
  projectId: text('project_id').notNull().references(() => projects.id),
  scenarioRunId: text('scenario_run_id').notNull(),
  scenarioId: text('scenario_id').notNull(),
  testerId: text('tester_id').notNull(),
  conversationId: text('conversation_id'),
  status: text('status').notNull().$type<ScenarioRunStatus>().default('queued'),
  testRunStatus: text('test_run_status').$type<TestRunStatus>(),
  dataExtractionResults: jsonb('data_extraction_results').$type<Record<string, unknown>>(),
  dataTransformationResults: jsonb('data_transformation_results').$type<Record<string, unknown>>(),
  testStatistics: jsonb('test_statistics').$type<TestStatistics>(),
  metadata: jsonb('metadata').$type<Record<string, any>>(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.id] }),
  index('idx_scenario_conversations_project_run').on(table.projectId, table.scenarioRunId),
]);

// Relations
export const usersRelations = relations(users, ({ one, many }) => ({
  project: one(projects, {
    fields: [users.projectId],
    references: [projects.id],
  }),
  conversations: many(conversations),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  project: one(projects, {
    fields: [conversations.projectId],
    references: [projects.id],
  }),
  user: one(users, {
    fields: [conversations.projectId, conversations.userId],
    references: [users.projectId, users.id],
  }),
  events: many(conversationEvents),
  artifacts: many(conversationArtifacts),
}));

export const conversationEventsRelations = relations(conversationEvents, ({ one }) => ({
  conversation: one(conversations, {
    fields: [conversationEvents.projectId, conversationEvents.conversationId],
    references: [conversations.projectId, conversations.id],
  }),
}));

export const projectsRelations = relations(projects, ({ many }) => ({
  conversations: many(conversations),
  users: many(users),
  agents: many(agents),
  stages: many(stages),
  classifiers: many(classifiers),
  contextTransformers: many(contextTransformers),
  tools: many(tools),
  knowledgeCategories: many(knowledgeCategories),
  globalActions: many(globalActions),
  guardrails: many(guardrails),
  issues: many(issues),
  apiKeys: many(apiKeys),
  sampleCopies: many(sampleCopies),
  copyDecorators: many(copyDecorators),
  savedSliceQueries: many(savedSliceQueries),
  savedFunnelQueries: many(savedFunnelQueries),
  testers: many(testers),
  scenarios: many(scenarios),
  scenarioRuns: many(scenarioRuns),
  scenarioConversations: many(scenarioConversations),
  quickPrompts: many(quickPrompts),
  projectSnapshots: many(projectSnapshots),
}));

export const agentsRelations = relations(agents, ({ one, many }) => ({
  project: one(projects, {
    fields: [agents.projectId],
    references: [projects.id],
  }),
  stages: many(stages),
}));

export const stagesRelations = relations(stages, ({ one }) => ({
  project: one(projects, {
    fields: [stages.projectId],
    references: [projects.id],
  }),
  agent: one(agents, {
    fields: [stages.agentId],
    references: [agents.id],
  }),
}));

export const classifiersRelations = relations(classifiers, ({ one }) => ({
  project: one(projects, {
    fields: [classifiers.projectId],
    references: [projects.id],
  }),
}));

export const contextTransformersRelations = relations(contextTransformers, ({ one }) => ({
  project: one(projects, {
    fields: [contextTransformers.projectId],
    references: [projects.id],
  }),
}));

export const toolsRelations = relations(tools, ({ one }) => ({
  project: one(projects, {
    fields: [tools.projectId],
    references: [projects.id],
  }),
}));

export const globalActionsRelations = relations(globalActions, ({ one }) => ({
  project: one(projects, {
    fields: [globalActions.projectId],
    references: [projects.id],
  }),
}));

export const guardrailsRelations = relations(guardrails, ({ one }) => ({
  project: one(projects, {
    fields: [guardrails.projectId],
    references: [projects.id],
  }),
}));

export const copyDecoratorsRelations = relations(copyDecorators, ({ one, many }) => ({
  project: one(projects, {
    fields: [copyDecorators.projectId],
    references: [projects.id],
  }),
  sampleCopies: many(sampleCopies),
}));

export const sampleCopiesRelations = relations(sampleCopies, ({ one }) => ({
  project: one(projects, {
    fields: [sampleCopies.projectId],
    references: [projects.id],
  }),
  decorator: one(copyDecorators, {
    fields: [sampleCopies.projectId, sampleCopies.decoratorId],
    references: [copyDecorators.projectId, copyDecorators.id],
  }),
}));

export const issuesRelations = relations(issues, ({ one }) => ({
  project: one(projects, {
    fields: [issues.projectId],
    references: [projects.id],
  }),
}));

export const knowledgeItemsRelations = relations(knowledgeItems, ({ one }) => ({
  category: one(knowledgeCategories, {
    fields: [knowledgeItems.projectId, knowledgeItems.categoryId],
    references: [knowledgeCategories.projectId, knowledgeCategories.id],
  }),
}));

export const knowledgeCategoriesRelations = relations(knowledgeCategories, ({ one, many }) => ({
  project: one(projects, {
    fields: [knowledgeCategories.projectId],
    references: [projects.id],
  }),
  items: many(knowledgeItems),
}));

export const conversationArtifactsRelations = relations(conversationArtifacts, ({ one }) => ({
  conversation: one(conversations, {
    fields: [conversationArtifacts.projectId, conversationArtifacts.conversationId],
    references: [conversations.projectId, conversations.id],
  }),
  event: one(conversationEvents, {
    fields: [conversationArtifacts.projectId, conversationArtifacts.eventId],
    references: [conversationEvents.projectId, conversationEvents.id],
  }),
}));

export const operatorsRelations = relations(operators, ({ many }) => ({
  auditLogs: many(auditLogs),
  providers: many(providers),
  quickPrompts: many(quickPrompts),
}));

export const providersRelations = relations(providers, ({ one }) => ({
  creator: one(operators, {
    fields: [providers.createdBy],
    references: [operators.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  operator: one(operators, {
    fields: [auditLogs.userId],
    references: [operators.id],
  }),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  project: one(projects, {
    fields: [apiKeys.projectId],
    references: [projects.id],
  }),
}));

export const savedSliceQueriesRelations = relations(savedSliceQueries, ({ one }) => ({
  project: one(projects, {
    fields: [savedSliceQueries.projectId],
    references: [projects.id],
  }),
  operator: one(operators, {
    fields: [savedSliceQueries.operatorId],
    references: [operators.id],
  }),
}));

export const savedFunnelQueriesRelations = relations(savedFunnelQueries, ({ one }) => ({
  project: one(projects, {
    fields: [savedFunnelQueries.projectId],
    references: [projects.id],
  }),
  operator: one(operators, {
    fields: [savedFunnelQueries.operatorId],
    references: [operators.id],
  }),
}));

export const testersRelations = relations(testers, ({ one }) => ({
  project: one(projects, {
    fields: [testers.projectId],
    references: [projects.id],
  }),
}));

export const scenariosRelations = relations(scenarios, ({ one }) => ({
  project: one(projects, {
    fields: [scenarios.projectId],
    references: [projects.id],
  }),
}));

export const scenarioRunsRelations = relations(scenarioRuns, ({ one, many }) => ({
  project: one(projects, {
    fields: [scenarioRuns.projectId],
    references: [projects.id],
  }),
  conversations: many(scenarioConversations),
}));

export const scenarioConversationsRelations = relations(scenarioConversations, ({ one }) => ({
  project: one(projects, {
    fields: [scenarioConversations.projectId],
    references: [projects.id],
  }),
  scenarioRun: one(scenarioRuns, {
    fields: [scenarioConversations.projectId, scenarioConversations.scenarioRunId],
    references: [scenarioRuns.projectId, scenarioRuns.id],
  }),
}));

// QuickPrompt table — reusable prompt templates with "copy on select" behavior
export type QuickPromptCategory = 'agent' | 'stage' | 'filler' | 'transformer' | 'classifier' | 'tool' | 'tester' | 'summarization';

export const quickPrompts = pgTable('quick_prompts', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  categoryId: text('category_id').notNull().$type<QuickPromptCategory>(),
  ownerId: text('owner_id').references(() => operators.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  description: text('description'),
  content: text('content').notNull(),
  tags: jsonb('tags').notNull().default([]).$type<string[]>(),
  isPublic: boolean('is_public').notNull().default(true),
  isSystem: boolean('is_system').notNull().default(false),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('idx_quick_prompts_project_id').on(table.projectId),
  index('idx_quick_prompts_category_id').on(table.categoryId),
  index('idx_quick_prompts_owner_id').on(table.ownerId),
  index('idx_quick_prompts_is_public').on(table.isPublic),
]);

// ─── Processing Deferral ────────────────────────────────────────────────────

/** Status of a deferred processing entry */
export type DeferredProcessingStatus = 'pending' | 'processed' | 'failed' | 'cancelled';

// deferred_processing — incoming messages queued for delayed processing
export const deferredProcessing = pgTable('deferred_processing', {
  id: text('id').notNull().primaryKey(),
  sessionId: text('session_id').notNull(),
  providerId: text('provider_id').notNull().references(() => providers.id),
  projectId: text('project_id').notNull().references(() => projects.id),
  conversationId: text('conversation_id'),
  channelType: text('channel_type').notNull(),
  processAt: timestamp('process_at').notNull(),
  message: jsonb('message').notNull().$type<Record<string, unknown>>(),
  status: text('status').notNull().default('pending').$type<DeferredProcessingStatus>(),
  retryCount: integer('retry_count').notNull().default(0),
  lastError: text('last_error'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  processedAt: timestamp('processed_at'),
}, (table) => [
  index('idx_deferred_processing_process_at_status').on(table.processAt, table.status),
  index('idx_deferred_processing_session_id').on(table.sessionId),
]);

// ─── Benchmarking ────────────────────────────────────────────────────────────

export type BenchmarkProviderType = 'llm' | 'tts' | 'asr';
export type BenchmarkRunTrigger = 'manual' | 'scheduled';
export type BenchmarkRunStatus = 'pending' | 'in_progress' | 'completed' | 'failed';
export type BenchmarkInputType = 'messages' | 'text' | 'audio';

// benchmark_suites — groups multiple benchmark configs into a single executable unit
export const benchmarkSuites = pgTable('benchmark_suites', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  cronExpression: text('cron_expression'),
  isActive: boolean('is_active').notNull().default(true),
  tags: jsonb('tags').notNull().default([]).$type<string[]>(),
  createdBy: text('created_by').references(() => operators.id),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// benchmark_provider_configs — reusable provider + settings snapshot for benchmarking
export const benchmarkProviderConfigs = pgTable('benchmark_provider_configs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  providerType: text('provider_type').notNull().$type<BenchmarkProviderType>(),
  providerId: text('provider_id').notNull().references(() => providers.id),
  settings: jsonb('settings').notNull().$type<Record<string, unknown>>(),
  providerSettings: jsonb('provider_settings').$type<Record<string, unknown>>(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// benchmark_configs — single test case linking a provider config with typed input data
export const benchmarkConfigs = pgTable('benchmark_configs', {
  id: text('id').primaryKey(),
  suiteId: text('suite_id').notNull().references(() => benchmarkSuites.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  providerConfigId: text('provider_config_id').notNull().references(() => benchmarkProviderConfigs.id),
  inputType: text('input_type').notNull().$type<BenchmarkInputType>(),
  inputData: jsonb('input_data').notNull().$type<Record<string, unknown>>(),
  repeats: integer('repeats').notNull().default(3),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('idx_benchmark_configs_suite_id').on(table.suiteId),
]);

// benchmark_runs — one execution of a full benchmark suite
export const benchmarkRuns = pgTable('benchmark_runs', {
  id: text('id').primaryKey(),
  suiteId: text('suite_id').notNull().references(() => benchmarkSuites.id),
  trigger: text('trigger').notNull().$type<BenchmarkRunTrigger>(),
  status: text('status').notNull().default('pending').$type<BenchmarkRunStatus>(),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  error: text('error'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('idx_benchmark_runs_suite_id').on(table.suiteId),
  index('idx_benchmark_runs_status').on(table.status),
]);

// benchmark_config_executions — one row per (config × run); the unique execution ID grouping all iteration results
export const benchmarkConfigExecutions = pgTable('benchmark_config_executions', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => benchmarkRuns.id, { onDelete: 'cascade' }),
  configId: text('config_id').notNull().references(() => benchmarkConfigs.id),
  status: text('status').notNull().default('pending').$type<BenchmarkRunStatus>(),
  stats: jsonb('stats').$type<Record<string, unknown>>(),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  error: text('error'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('idx_benchmark_config_executions_run_id').on(table.runId, table.configId),
]);

// benchmark_results — one row per iteration within a config execution; raw timing data
export const benchmarkResults = pgTable('benchmark_results', {
  id: text('id').primaryKey(),
  configExecutionId: text('config_execution_id').notNull().references(() => benchmarkConfigExecutions.id, { onDelete: 'cascade' }),
  iterationIndex: integer('iteration_index').notNull(),
  startedAt: timestamp('started_at').notNull(),
  completedAt: timestamp('completed_at'),
  result: jsonb('result').notNull().$type<IterationResultData>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('idx_benchmark_results_config_execution_id').on(table.configExecutionId),
]);

// ─── Project Snapshots ──────────────────────────────────────────────────────

// project_snapshots — immutable point-in-time records of complete project configuration
export const projectSnapshots = pgTable('project_snapshots', {
  id: text('id').primaryKey(),                           // proj_snap_{uuidv7}
  projectId: text('project_id').notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),                 // sequential: 1, 2, 3, ...
  name: text('name'),                                    // optional operator label
  entityData: jsonb('entity_data').notNull(),            // full snapshot payload
  createdBy: text('created_by').references(() => operators.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  // Enforce unique version per project
  uniqueIndex('project_snapshots_project_id_version_unique')
    .on(table.projectId, table.version),
  // Fast lookup for listing versions of a project
  index('idx_project_snapshots_project_id').on(table.projectId),
]);

// ─── Benchmarking Relations ───────────────────────────────────────────────────

export const quickPromptsRelations = relations(quickPrompts, ({ one }) => ({
  project: one(projects, {
    fields: [quickPrompts.projectId],
    references: [projects.id],
  }),
  owner: one(operators, {
    fields: [quickPrompts.ownerId],
    references: [operators.id],
  }),
}));

export const benchmarkSuitesRelations = relations(benchmarkSuites, ({ one, many }) => ({
  creator: one(operators, {
    fields: [benchmarkSuites.createdBy],
    references: [operators.id],
  }),
  configs: many(benchmarkConfigs),
  runs: many(benchmarkRuns),
}));

export const benchmarkProviderConfigsRelations = relations(benchmarkProviderConfigs, ({ one, many }) => ({
  provider: one(providers, {
    fields: [benchmarkProviderConfigs.providerId],
    references: [providers.id],
  }),
  benchmarkConfigs: many(benchmarkConfigs),
}));

export const benchmarkConfigsRelations = relations(benchmarkConfigs, ({ one, many }) => ({
  suite: one(benchmarkSuites, {
    fields: [benchmarkConfigs.suiteId],
    references: [benchmarkSuites.id],
  }),
  providerConfig: one(benchmarkProviderConfigs, {
    fields: [benchmarkConfigs.providerConfigId],
    references: [benchmarkProviderConfigs.id],
  }),
  executions: many(benchmarkConfigExecutions),
}));

export const benchmarkRunsRelations = relations(benchmarkRuns, ({ one, many }) => ({
  suite: one(benchmarkSuites, {
    fields: [benchmarkRuns.suiteId],
    references: [benchmarkSuites.id],
  }),
  executions: many(benchmarkConfigExecutions),
}));

export const benchmarkConfigExecutionsRelations = relations(benchmarkConfigExecutions, ({ one, many }) => ({
  run: one(benchmarkRuns, {
    fields: [benchmarkConfigExecutions.runId],
    references: [benchmarkRuns.id],
  }),
  config: one(benchmarkConfigs, {
    fields: [benchmarkConfigExecutions.configId],
    references: [benchmarkConfigs.id],
  }),
  results: many(benchmarkResults),
}));

export const benchmarkResultsRelations = relations(benchmarkResults, ({ one }) => ({
  execution: one(benchmarkConfigExecutions, {
    fields: [benchmarkResults.configExecutionId],
    references: [benchmarkConfigExecutions.id],
  }),
}));

export const projectSnapshotsRelations = relations(projectSnapshots, ({ one }) => ({
  project: one(projects, {
    fields: [projectSnapshots.projectId],
    references: [projects.id],
  }),
  creator: one(operators, {
    fields: [projectSnapshots.createdBy],
    references: [operators.id],
  }),
}));
