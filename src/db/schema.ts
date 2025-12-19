import { pgTable, text, timestamp, boolean, jsonb, integer, serial } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// User table
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  profile: jsonb('profile').notNull().$type<Record<string, any>>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Conversation table
export const conversations = pgTable('conversations', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  clientId: text('client_id').notNull(),
  stageId: text('stage_id').notNull(),
  state: jsonb('state').notNull().$type<{
    variables: Record<string, Record<string, any>>;
    currentActions: string[];
  }>(),
  status: text('status').notNull().default('ongoing'),
  statusReason: text('status_reason'),
  metadata: jsonb('metadata').$type<Record<string, any>>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ConversationEvent table
export const conversationEvents = pgTable('conversation_events', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  eventData: jsonb('event_data').notNull().$type<Record<string, any>>(),
  timestamp: timestamp('timestamp').notNull(),
  metadata: jsonb('metadata').$type<Record<string, any>>(),
});

// Admin table
export const admins = pgTable('admins', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  roles: jsonb('roles').notNull().$type<string[]>(),
  password: text('password').notNull(),
  metadata: jsonb('metadata').$type<Record<string, any>>(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Persona table
export const personas = pgTable('personas', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  prompt: text('prompt').notNull(),
  voiceConfig: jsonb('voice_config').$type<{
    voiceProviderId?: string;
    voiceId?: string;
    settings?: Record<string, any>;
  }>(),
  metadata: jsonb('metadata').$type<Record<string, any>>(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Classifier table
export const classifiers = pgTable('classifiers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  prompt: text('prompt').notNull(),
  llmProvider: text('llm_provider'),
  llmProviderConfig: jsonb('llm_provider_config').$type<Record<string, any>>(),
  metadata: jsonb('metadata').$type<Record<string, any>>(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ContextTransformer table
export const contextTransformers = pgTable('context_transformers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  prompt: text('prompt').notNull(),
  contextFields: jsonb('context_fields').$type<string[]>(),
  llmProvider: text('llm_provider'),
  llmProviderConfig: jsonb('llm_provider_config').$type<Record<string, any>>(),
  metadata: jsonb('metadata').$type<Record<string, any>>(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Tool table
export const tools = pgTable('tools', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  prompt: text('prompt').notNull(),
  llmProvider: text('llm_provider'),
  llmProviderConfig: jsonb('llm_provider_config').$type<Record<string, any>>(),
  inputType: text('input_type').notNull(),
  outputType: text('output_type').notNull(),
  metadata: jsonb('metadata').$type<Record<string, any>>(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ConversationStage table
export const conversationStages = pgTable('conversation_stages', {
  stageId: text('stage_id').primaryKey(),
  prompt: text('prompt').notNull(),
  llmProvider: text('llm_provider'),
  llmProviderConfig: jsonb('llm_provider_config').$type<Record<string, any>>(),
  personaId: text('persona_id').notNull().references(() => personas.id),
  enterBehavior: jsonb('enter_behavior').notNull().default({}).$type<Record<string, any>>(),
  useKnowledge: boolean('use_knowledge').notNull().default(false),
  knowledgeSections: jsonb('knowledge_sections').notNull().default([]).$type<string[]>(),
  useGlobalActions: boolean('use_global_actions').notNull().default(true),
  globalActions: jsonb('global_actions').notNull().default([]).$type<string[]>(),
  variables: jsonb('variables').notNull().default({}).$type<Record<string, any>>(),
  actions: jsonb('actions').notNull().default({}).$type<Record<string, any>>(),
  classifierIds: jsonb('classifier_ids').notNull().default([]).$type<string[]>(),
  transformerIds: jsonb('transformer_ids').notNull().default([]).$type<string[]>(),
  metadata: jsonb('metadata').$type<Record<string, any>>(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// KnowledgeSection table
export const knowledgeSections = pgTable('knowledge_sections', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// KnowledgeCategory table
export const knowledgeCategories = pgTable('knowledge_categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  promptTrigger: text('prompt_trigger').notNull(),
  knowledgeSections: jsonb('knowledge_sections').notNull().default([]).$type<string[]>(),
  order: integer('order').notNull().default(0),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// KnowledgeItem table
export const knowledgeItems = pgTable('knowledge_items', {
  id: text('id').primaryKey(),
  categoryId: text('category_id').notNull().references(() => knowledgeCategories.id),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  order: integer('order').notNull().default(0),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// GlobalAction table
export const globalActions = pgTable('global_actions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  condition: text('condition'),
  promptTrigger: text('prompt_trigger').notNull(),
  operations: jsonb('operations').notNull().default([]).$type<string[]>(),
  template: text('template'),
  examples: jsonb('examples').$type<string[]>(),
  metadata: jsonb('metadata').$type<Record<string, any>>(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Issue table
export const issues = pgTable('issues', {
  id: serial('id').primaryKey(),
  environment: text('environment').notNull(),
  buildVersion: text('build_version').notNull(),
  beat: text('beat'),
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
});

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

// AuditLog table
export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  action: text('action').notNull(),
  entityId: text('entity_id').notNull(),
  entityType: text('entity_type').notNull(),
  oldEntity: jsonb('old_entity').$type<Record<string, any>>(),
  newEntity: jsonb('new_entity').$type<Record<string, any>>(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ConversationAsset table
export const conversationAssets = pgTable('conversation_assets', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  data: text('data').notNull(), // Binary data as base64 or use bytea
  mimeType: text('mime_type').notNull(),
  fileSize: integer('file_size').notNull(),
  metadata: jsonb('metadata').$type<Record<string, any>>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  conversations: many(conversations),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  user: one(users, {
    fields: [conversations.userId],
    references: [users.id],
  }),
  events: many(conversationEvents),
  assets: many(conversationAssets),
}));

export const conversationEventsRelations = relations(conversationEvents, ({ one }) => ({
  conversation: one(conversations, {
    fields: [conversationEvents.conversationId],
    references: [conversations.id],
  }),
}));

export const conversationStagesRelations = relations(conversationStages, ({ one }) => ({
  persona: one(personas, {
    fields: [conversationStages.personaId],
    references: [personas.id],
  }),
}));

export const knowledgeItemsRelations = relations(knowledgeItems, ({ one }) => ({
  category: one(knowledgeCategories, {
    fields: [knowledgeItems.categoryId],
    references: [knowledgeCategories.id],
  }),
}));

export const knowledgeCategoriesRelations = relations(knowledgeCategories, ({ many }) => ({
  items: many(knowledgeItems),
}));

export const conversationAssetsRelations = relations(conversationAssets, ({ one }) => ({
  conversation: one(conversations, {
    fields: [conversationAssets.conversationId],
    references: [conversations.id],
  }),
}));

export const adminsRelations = relations(admins, ({ many }) => ({
  auditLogs: many(auditLogs),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  admin: one(admins, {
    fields: [auditLogs.userId],
    references: [admins.id],
  }),
}));
