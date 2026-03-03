import { pgTable, text, timestamp, boolean, jsonb, integer, serial, primaryKey, foreignKey } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { StageAction, Effect, ToolParameter, StageActionParameter } from '../types/actions';
import { FieldDescriptor } from '../types/parameters';
import { ConversationState } from '../types/conversationEvents';
import { LlmProviderConfig, LlmSettings } from '../services/providers/llm/LlmProviderFactory';
import { AsrProviderConfig } from '../services/providers/asr/AsrProviderFactory';
import { TtsProviderConfig, TtsSettings } from '../services/providers/tts/TtsProviderFactory';
import { StorageProviderConfig } from '../http/contracts/provider';
import { ConversationEventData, ConversationEventType } from '../types/conversationEvents';
import { FillerSettings } from '../http/contracts/agent';


export type ProviderConfig = LlmProviderConfig | AsrProviderConfig | TtsProviderConfig | StorageProviderConfig;

// User table
export const users = pgTable('users', {
  id: text('id').notNull(),
  projectId: text('project_id').notNull().references(() => projects.id),
  profile: jsonb('profile').notNull().$type<Record<string, any>>(),
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
  clientId: text('client_id').notNull(),
  stageId: text('stage_id').notNull(),
  stageVars: jsonb('stage_vars').$type<Record<string, Record<string, any>>>(),
  status: text('status').notNull().$type<ConversationState>().default('initialized'),
  statusDetails: text('status_reason').default(null),
  metadata: jsonb('metadata').$type<Record<string, any>>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.id] }),
  foreignKey({ columns: [table.projectId, table.userId], foreignColumns: [users.projectId, users.id] }),
]);

// ConversationEvent table
export const conversationEvents = pgTable('conversation_events', {
  id: text('id').notNull(),
  projectId: text('project_id').notNull(),
  conversationId: text('conversation_id').notNull(),
  eventType: text('event_type').notNull().$type<ConversationEventType>(),
  eventData: jsonb('event_data').notNull().$type<ConversationEventData>(),
  timestamp: timestamp('timestamp').notNull(),
  metadata: jsonb('metadata').$type<Record<string, any>>(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.id] }),
  foreignKey({ columns: [table.projectId, table.conversationId], foreignColumns: [conversations.projectId, conversations.id] }).onDelete('cascade'),
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
  }>(),
  acceptVoice: boolean('accept_voice').notNull().default(true),
  generateVoice: boolean('generate_voice').notNull().default(true),
  storageConfig: jsonb('storage_config').$type<{
    storageProviderId?: string;
    settings?: unknown;
  }>(),
  constants: jsonb('constants').$type<Record<string, any>>(),
  metadata: jsonb('metadata').$type<Record<string, any>>(),
  timezone: text('timezone'),
  autoCreateUsers: boolean('auto_create_users').notNull().default(false),
  userProfileVariableDescriptors: jsonb('user_profile_variable_descriptors').notNull().default([]).$type<FieldDescriptor[]>(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

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

// Tool table
export const tools = pgTable('tools', {
  id: text('id').notNull(),
  projectId: text('project_id').notNull().references(() => projects.id),
  name: text('name').notNull(),
  description: text('description'),
  prompt: text('prompt').notNull(),
  llmProviderId: text('llm_provider_id'),
  llmSettings: jsonb('llm_settings').$type<LlmSettings>(),
  inputType: text('input_type').$type<ToolInputType>().notNull(),
  outputType: text('output_type').$type<ToolOutputType>().notNull(),
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
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  order: integer('order').notNull().default(0),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.id] }),
  foreignKey({ columns: [table.projectId, table.categoryId], foreignColumns: [knowledgeCategories.projectId, knowledgeCategories.id] }),
]);

// GlobalAction table
export const globalActions = pgTable('global_actions', {
  id: text('id').notNull(),
  projectId: text('project_id').notNull().references(() => projects.id),
  name: text('name').notNull(),
  condition: text('condition'),
  triggerOnUserInput: boolean('trigger_on_user_input').notNull().default(true),
  triggerOnClientCommand: boolean('trigger_on_client_command').notNull().default(false),
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

// Issue table
export const issues = pgTable('issues', {
  id: serial('id').notNull(),
  projectId: text('project_id').notNull().references(() => projects.id),
  environment: text('environment'),
  buildVersion: text('build_version'),
  stage: text('stage'),
  sessionId: text('session_id'),
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
  apiType: text('api_type').notNull(), // azure, elevenlabs, openai, anthropic, gemini, groq, vertex, s3, azure-blob, gcs, local
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
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.id] }),
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
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type ArtifactType = 'user_voice' | 'user_transcript' | 'ai_voice' | 'ai_transcript' | 'tool_input' | 'tool_output' | 'other';

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
  foreignKey({ columns: [table.projectId, table.eventId], foreignColumns: [conversationEvents.projectId, conversationEvents.id] }).onDelete('set null'),
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
  issues: many(issues),
  apiKeys: many(apiKeys),
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
