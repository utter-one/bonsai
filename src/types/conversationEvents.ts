import { z } from 'zod';
import { classificationResultWithClassifierSchema } from "./classification";
import { effectSchema } from "./actions";
import { llmContentSchema } from '../services/providers/llm/ILlmProvider';
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
]);

export type ConversationEventType = z.infer<typeof conversationEventTypeSchema>;

// Event Data Schemas
export const messageEventDataSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  originalText: z.string(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type MessageEventData = z.infer<typeof messageEventDataSchema>;

export const classificationEventDataSchema = z.object({
  classifierId: z.string(),
  input: z.string(),
  actions: z.array(classificationResultWithClassifierSchema),
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

export const actionEventDataSchema = z.object({
  actionName: z.string(),
  stageId: z.string(),
  effects: z.array(effectSchema),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type ActionEventData = z.infer<typeof actionEventDataSchema>;

export const commandEventDataSchema = z.object({
  command: z.string(),
  parameters: z.record(z.string(), parameterValueSchema).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type CommandEventData = z.infer<typeof commandEventDataSchema>;

export const toolCallEventDataSchema = z.object({
  toolId: z.string(),
  toolName: z.string(),
  parameters: z.record(z.string(), parameterValueSchema),
  success: z.boolean(),
  result: z.array(llmContentSchema).optional(),
  error: z.string().optional(),
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
  metadata: z.record(z.string(), z.any()).optional(),
});

export type ConversationEndEventData = z.infer<typeof conversationEndEventDataSchema>;

export const conversationAbortedEventDataSchema = z.object({
  reason: z.string(),
  stageId: z.string(),
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
  categories: z.array(z.string()),
  /** Duration of the moderation API call in milliseconds */
  durationMs: z.number(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type ModerationEventData = z.infer<typeof moderationEventDataSchema>;

export const conversationEventDataSchema = z.union([
  messageEventDataSchema,
  classificationEventDataSchema,
  transformationEventDataSchema,
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
]);

export type ConversationEventData = z.infer<typeof conversationEventDataSchema>;
