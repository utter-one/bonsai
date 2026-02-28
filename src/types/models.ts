import type { InferSelectModel } from 'drizzle-orm';
import {
  users,
  conversations,
  conversationEvents,
  admins,
  agents,
  classifiers,
  contextTransformers,
  tools,
  stages,
  knowledgeCategories,
  knowledgeItems,
  globalActions,
  issues,
  environments,
  auditLogs,
  conversationArtifacts,
  providers,
  projects,
} from '../db/schema';


// Inferred select models from Drizzle schema
export type User = InferSelectModel<typeof users>;
export type Conversation = InferSelectModel<typeof conversations>;
export type ConversationEvent = InferSelectModel<typeof conversationEvents>;
export type Admin = InferSelectModel<typeof admins>;
export type Agent = InferSelectModel<typeof agents>;
export type Classifier = InferSelectModel<typeof classifiers>;
export type ContextTransformer = InferSelectModel<typeof contextTransformers>;
export type Tool = InferSelectModel<typeof tools>;
export type Stage = InferSelectModel<typeof stages>;
export type KnowledgeCategory = InferSelectModel<typeof knowledgeCategories>;
export type KnowledgeItem = InferSelectModel<typeof knowledgeItems>;
export type GlobalAction = InferSelectModel<typeof globalActions>;
export type Issue = InferSelectModel<typeof issues>;
export type Environment = InferSelectModel<typeof environments>;
export type AuditLog = InferSelectModel<typeof auditLogs>;
export type ConversationArtifact = InferSelectModel<typeof conversationArtifacts>;
export type Provider = InferSelectModel<typeof providers>;
export type Project = InferSelectModel<typeof projects>;

