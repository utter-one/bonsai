import type { InferSelectModel } from 'drizzle-orm';
import {
  users,
  conversations,
  conversationEvents,
  admins,
  personas,
  classifiers,
  contextTransformers,
  tools,
  stages,
  knowledgeSections,
  knowledgeCategories,
  knowledgeItems,
  globalActions,
  issues,
  environments,
  auditLogs,
  conversationAssets,
  providers,
  projects,
} from '../db/schema';

// Re-export conversation event types from schema
export type {
  ConversationEventType,
  ConversationEventData,
  MessageEventData,
  ClassificationEventData,
  ActionEventData,
  CommandEventData,
  ConversationStartEventData,
  ConversationResumeEventData,
  ConversationEndEventData,
  ConversationAbortedEventData,
  ConversationFailedEventData,
} from '../db/schema';

// Inferred select models from Drizzle schema
export type User = InferSelectModel<typeof users>;
export type Conversation = InferSelectModel<typeof conversations>;
export type ConversationEvent = InferSelectModel<typeof conversationEvents>;
export type Admin = InferSelectModel<typeof admins>;
export type Persona = InferSelectModel<typeof personas>;
export type Classifier = InferSelectModel<typeof classifiers>;
export type ContextTransformer = InferSelectModel<typeof contextTransformers>;
export type Tool = InferSelectModel<typeof tools>;
export type Stage = InferSelectModel<typeof stages>;
export type KnowledgeSection = InferSelectModel<typeof knowledgeSections>;
export type KnowledgeCategory = InferSelectModel<typeof knowledgeCategories>;
export type KnowledgeItem = InferSelectModel<typeof knowledgeItems>;
export type GlobalAction = InferSelectModel<typeof globalActions>;
export type Issue = InferSelectModel<typeof issues>;
export type Environment = InferSelectModel<typeof environments>;
export type AuditLog = InferSelectModel<typeof auditLogs>;
export type ConversationAsset = InferSelectModel<typeof conversationAssets>;
export type Provider = InferSelectModel<typeof providers>;
export type Project = InferSelectModel<typeof projects>;

// Operation types for stage actions and global actions

/** Operation: End Conversation - Gracefully ends conversation with an AI response */
export type EndConversationOperation = {
  type: 'end_conversation';
  reason?: string;
};

/** Operation: Abort Conversation - Immediately ends conversation without AI response */
export type AbortConversationOperation = {
  type: 'abort_conversation';
  reason?: string;
};

/** Operation: Go To Stage - Switches the conversation to a different stage */
export type GoToStageOperation = {
  type: 'go_to_stage';
  stageId: string;
};

/** Operation: Run Script - Runs isolated JavaScript code that can modify stage state and variables */
export type RunScriptOperation = {
  type: 'run_script';
  code: string;
};

/** Operation: Modify User Input - Changes user input contents using a template */
export type ModifyUserInputOperation = {
  type: 'modify_user_input';
  template: string;
};

/** Definition of a single variable modification operation */
export type VariableOperation = {
  variableName: string;
  operation: 'set' | 'reset' | 'add' | 'remove'; // 'add' and 'remove' are for array variables
  value: unknown;
};

/** Operation: Modify Variables - Updates stage variables using specific operations */
export type ModifyVariablesOperation = {
  type: 'modify_variables';
  modifications: VariableOperation[];
};

/** Operation: Call Tool - Calls a selected tool with parameters and puts result in context */
export type CallToolOperation = {
  type: 'call_tool';
  toolId: string;
  parameters: Record<string, unknown>;
};

/** Discriminated union of all operation types */
export type Operation =
  | EndConversationOperation
  | AbortConversationOperation
  | GoToStageOperation
  | RunScriptOperation
  | ModifyUserInputOperation
  | ModifyVariablesOperation
  | CallToolOperation;

/** Definition of a single action within a stage */
export type StageAction = {
  name: string;
  condition?: string | null;
  promptTrigger: string;
  operations: Operation[];
  template?: string | null;
  examples?: string[] | null;
  metadata?: Record<string, unknown> | null;
};