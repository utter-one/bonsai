import { z } from 'zod';
import { actionClassificationResultWithClassifierSchema } from "./classification";
import { effectSchema, lifecycleContextSchema } from "./actions";
import { parameterValueSchema } from './parameters';

// Conversation State Schema
export const conversationStateSchema = z.enum([
  'initialized', // Conversation has been initialized (not started yet)
  'awaiting_user_input', // Conversation is waiting for user input (text or voice)
  'receiving_user_voice', // Conversation is receiving voice input from user (ASR in progress)
  'processing_user_input', // Conversation is processing user input
  'generating_response', // Conversation is generating a response
  'finished', // Conversation has finished
  'aborted', // Conversation has been aborted by user or system
  'failed', // Conversation has failed due to an error
]);

export type ConversationState = z.infer<typeof conversationStateSchema>;

// Conversation Event Types
export const conversationEventTypeSchema = z.enum([
  'message',
  'classification',
  'transformation',
  'execution_plan',
  /** @deprecated Use 'execution_plan' instead. Retained for backwards compatibility with already-stored events. */
  'action',
  'command',
  'tool_call',
  'conversation_start',
  'conversation_resume',
  'conversation_end',
  'conversation_aborted',
  'conversation_failed',
  'jump_to_stage',
  'moderation',
  'variables_updated',
  'user_profile_updated',
  'user_input_modified',
  'user_banned',
  'visibility_changed',
  'sample_copy_selection',
]);

export type ConversationEventType = z.infer<typeof conversationEventTypeSchema>;

export const messageVisibilitySchema = z.object({
  visibility: z.enum(['always', 'stage', 'never', 'conditional']).describe('Visibility setting for the message: always (always visible), stage (visible only in current stage), never (never visible), conditional (visible based on condition)'),
  condition: z.string().optional().describe('Condition for visibility, evaluated against conversation variables'),
})

export type MessageVisibility = z.infer<typeof messageVisibilitySchema>;

// Event Data Schemas
export const messageEventDataSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  originalText: z.string(),
  visibility: messageVisibilitySchema.optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type MessageEventData = z.infer<typeof messageEventDataSchema>;

export const classificationEventDataSchema = z.object({
  classifierId: z.string(),
  input: z.string(),
  actions: z.array(actionClassificationResultWithClassifierSchema),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type ClassificationEventData = z.infer<typeof classificationEventDataSchema>;

/**
 * Schema for context transformer execution event data.
 * Recorded once per transformer after it runs and writes fields to stage variables.
 */
export const transformationEventDataSchema = z.object({
  /** ID of the context transformer that was executed */
  transformerId: z.string(),
  /** The user input that triggered the transformer */
  input: z.string(),
  /** Names of the stage variable fields that were written by this transformer */
  appliedFields: z.array(z.string()),
  /** Optional metadata including transformer name, rendered prompt, LLM settings, and updated variable snapshot */
  metadata: z.record(z.string(), z.any()).optional(),
});

export type TransformationEventData = z.infer<typeof transformationEventDataSchema>;

/**
 * Schema for a single effect entry in the execution plan, including its source action name.
 */
export const executionPlanEffectSchema = z.object({
  /** Name of the action this effect originates from */
  actionName: z.string().describe('Name of the action this effect originates from'),
  /** The effect to be executed */
  effect: effectSchema.describe('The effect to be executed'),
});

export type ExecutionPlanEffect = z.infer<typeof executionPlanEffectSchema>;

/**
 * Schema for the execution plan event data.
 * Emitted once per executeActions() call BEFORE any effects run, capturing the
 * final priority-sorted, lifecycle-filtered, conflict-resolved list of effects
 * across all matched actions.
 */
export const actionsExecutionPlanEventDataSchema = z.object({
  /** ID of the stage where execution is taking place */
  stageId: z.string().describe('ID of the stage where execution is taking place'),
  /** Names of all matched actions in original order */
  actions: z.array(z.string()).describe('Names of all matched actions in original order'),
  /** Final ordered list of effects after filtering, sorting, and conflict resolution */
  effects: z.array(executionPlanEffectSchema).describe('Final ordered list of effects after filtering, sorting, and conflict resolution'),
  /** Lifecycle context in which execution is taking place; null for user-input-triggered executions */
  lifecycleContext: lifecycleContextSchema.describe('Lifecycle context in which execution is taking place; null for user-input-triggered executions'),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type ActionsExecutionPlanEventData = z.infer<typeof actionsExecutionPlanEventDataSchema>;

/**
 * @deprecated Use actionsExecutionPlanEventDataSchema instead.
 * Retained for backwards compatibility with already-stored 'action' events.
 */
export const actionEventDataSchema = z.object({
  actionName: z.string(),
  stageId: z.string(),
  effects: z.array(effectSchema),
  metadata: z.record(z.string(), z.any()).optional(),
});

/** @deprecated Use ActionsExecutionPlanEventData instead. */
export type ActionEventData = z.infer<typeof actionEventDataSchema>;

export const commandTypeSchema = z.enum(['go_to_stage', 'set_var', 'get_var', 'get_all_vars', 'run_action', 'call_tool']);

export type CommandType = z.infer<typeof commandTypeSchema>;

export const commandEventDataSchema = z.object({
  command: commandTypeSchema,
  parameters: z.record(z.string(), parameterValueSchema).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type CommandEventData = z.infer<typeof commandEventDataSchema>;

export const toolCallEventDataSchema = z.object({
  toolId: z.string(),
  toolName: z.string(),
  toolType: z.enum(['smart_function', 'webhook', 'script']).optional(),
  parameters: z.record(z.string(), parameterValueSchema),
  success: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  /** Name of the action that triggered this tool call, if triggered by an action effect */
  sourceActionName: z.string().optional().describe('Name of the action that triggered this tool call, if triggered by an action effect'),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type ToolCallEventData = z.infer<typeof toolCallEventDataSchema>;

export const conversationStartEventDataSchema = z.object({
  stageId: z.string(),
  initialVariables: z.record(z.string(), parameterValueSchema).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type ConversationStartEventData = z.infer<typeof conversationStartEventDataSchema>;

export const jumpToStageEventDataSchema = z.object({
  fromStageId: z.string(),
  toStageId: z.string(),
  /** Name of the action that triggered this stage jump, if triggered by an action effect */
  sourceActionName: z.string().optional().describe('Name of the action that triggered this stage jump, if triggered by an action effect'),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type JumpToStageEventData = z.infer<typeof jumpToStageEventDataSchema>;

export const conversationResumeEventDataSchema = z.object({
  previousStatus: conversationStateSchema,
  stageId: z.string(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type ConversationResumeEventData = z.infer<typeof conversationResumeEventDataSchema>;

export const conversationEndEventDataSchema = z.object({
  reason: z.string().optional(),
  stageId: z.string(),
  /** Name of the action that triggered conversation end, if triggered by an action effect */
  sourceActionName: z.string().optional().describe('Name of the action that triggered conversation end, if triggered by an action effect'),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type ConversationEndEventData = z.infer<typeof conversationEndEventDataSchema>;

export const conversationAbortedEventDataSchema = z.object({
  reason: z.string(),
  stageId: z.string(),
  /** Name of the action that triggered conversation abort, if triggered by an action effect */
  sourceActionName: z.string().optional().describe('Name of the action that triggered conversation abort, if triggered by an action effect'),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type ConversationAbortedEventData = z.infer<typeof conversationAbortedEventDataSchema>;

export const conversationFailedEventDataSchema = z.object({
  reason: z.string(),
  stageId: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type ConversationFailedEventData = z.infer<typeof conversationFailedEventDataSchema>;

/**
 * Schema for content moderation event data.
 * Recorded when moderation is enabled and the user input is checked.
 */
export const moderationEventDataSchema = z.object({
  /** The user input that was moderated */
  input: z.string(),
  /** Whether the input was flagged as violating content policy */
  flagged: z.boolean(),
  /** Moderation categories that were violated (empty when not flagged) */
  blockingCategories: z.array(z.string()),
  /** All detected moderation categories, regardless of whether they are blocking */
  detectedCategories: z.array(z.string()),
  /** Duration of the moderation API call in milliseconds */
  durationMs: z.number(),
  /** Unix timestamp (ms) when the moderation API call started */
  startMs: z.number(),
  /** Unix timestamp (ms) when the moderation API call completed */
  endMs: z.number(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type ModerationEventData = z.infer<typeof moderationEventDataSchema>;

/**
 * Schema for variables updated event data.
 * Emitted when an action's modify_variables effect updates conversation variables.
 */
export const variablesUpdatedEventDataSchema = z.object({
  /** Name of the action that triggered this variable update */
  sourceActionName: z.string().describe('Name of the action that triggered this variable update'),
  /** Snapshot of all conversation variables after the update */
  variables: z.record(z.string(), parameterValueSchema).describe('Snapshot of all conversation variables after the update'),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type VariablesUpdatedEventData = z.infer<typeof variablesUpdatedEventDataSchema>;

/**
 * Schema for user profile updated event data.
 * Emitted when an action's modify_user_profile effect updates the user's profile.
 */
export const userProfileUpdatedEventDataSchema = z.object({
  /** Name of the action that triggered this profile update */
  sourceActionName: z.string().describe('Name of the action that triggered this profile update'),
  /** Updated user profile data */
  profile: z.record(z.string(), parameterValueSchema).describe('Updated user profile data'),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type UserProfileUpdatedEventData = z.infer<typeof userProfileUpdatedEventDataSchema>;

/**
 * Schema for user input modified event data.
 * Emitted when an action's modify_user_input effect transforms the user's input.
 */
export const userInputModifiedEventDataSchema = z.object({
  /** Name of the action that triggered this input modification */
  sourceActionName: z.string().describe('Name of the action that triggered this input modification'),
  /** The modified user input after template rendering */
  modifiedInput: z.string().describe('The modified user input after template rendering'),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type UserInputModifiedEventData = z.infer<typeof userInputModifiedEventDataSchema>;

/**
 * Schema for user banned event data.
 * Emitted when an action's ban_user effect bans the current user.
 */
export const userBannedEventDataSchema = z.object({
  /** Name of the action that triggered the ban */
  sourceActionName: z.string().describe('Name of the action that triggered the ban'),
  /** Optional reason for the ban */
  reason: z.string().optional().describe('Optional reason for the ban'),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type UserBannedEventData = z.infer<typeof userBannedEventDataSchema>;

/**
 * Schema for visibility changed event data.
 * Emitted when an action's change_visibility effect updates the message visibility for the current turn.
 */
export const visibilityChangedEventDataSchema = z.object({
  /** Name of the action that triggered this visibility change */
  sourceActionName: z.string().describe('Name of the action that triggered this visibility change'),
  /** The new visibility settings for current turn messages */
  visibility: messageVisibilitySchema.describe('The new visibility settings for current turn messages'),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type VisibilityChangedEventData = z.infer<typeof visibilityChangedEventDataSchema>;

/**
 * Schema for sample copy selection event data.
 * Emitted when the sample copy classifier selects a sample copy for the current turn.
 */
export const sampleCopySelectionEventDataSchema = z.object({
  /** ID of the classifier that performed the selection */
  classifierId: z.string().describe('ID of the classifier that performed the selection'),
  /** The user input that triggered the selection */
  input: z.string().describe('The user input that triggered the selection'),
  /** ID of the selected sample copy, or null if none was selected */
  sampleCopy: z.string().nullable().describe('Identifier of selected sample copy, or null if none was selected'),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type SampleCopySelectionEventData = z.infer<typeof sampleCopySelectionEventDataSchema>;

export const conversationEventDataSchema = z.union([
  messageEventDataSchema,
  classificationEventDataSchema,
  transformationEventDataSchema,
  actionsExecutionPlanEventDataSchema,
  actionEventDataSchema,
  commandEventDataSchema,
  toolCallEventDataSchema,
  conversationStartEventDataSchema,
  conversationResumeEventDataSchema,
  conversationEndEventDataSchema,
  conversationAbortedEventDataSchema,
  conversationFailedEventDataSchema,
  jumpToStageEventDataSchema,
  moderationEventDataSchema,
  variablesUpdatedEventDataSchema,
  userProfileUpdatedEventDataSchema,
  userInputModifiedEventDataSchema,
  userBannedEventDataSchema,
  visibilityChangedEventDataSchema,
  sampleCopySelectionEventDataSchema,
]);

export type ConversationEventData = z.infer<typeof conversationEventDataSchema>;
