import { z } from 'zod';
import { classificationResultWithClassifierSchema } from "./classification";
import { effectSchema } from "./actions";

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
  'action',
  'command',
  'conversation_start',
  'conversation_resume',
  'conversation_end',
  'conversation_aborted',
  'conversation_failed',
  'jump_to_stage',
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

export const actionEventDataSchema = z.object({
  actionName: z.string(),
  stageId: z.string(),
  effects: z.array(effectSchema),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type ActionEventData = z.infer<typeof actionEventDataSchema>;

export const commandEventDataSchema = z.object({
  command: z.string(),
  parameters: z.record(z.string(), z.any()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type CommandEventData = z.infer<typeof commandEventDataSchema>;

export const conversationStartEventDataSchema = z.object({
  stageId: z.string(),
  initialVariables: z.record(z.string(), z.any()).optional(),
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

export const conversationEventDataSchema = z.union([
  messageEventDataSchema,
  classificationEventDataSchema,
  actionEventDataSchema,
  commandEventDataSchema,
  conversationStartEventDataSchema,
  conversationResumeEventDataSchema,
  conversationEndEventDataSchema,
  conversationAbortedEventDataSchema,
  conversationFailedEventDataSchema,
  jumpToStageEventDataSchema,
]);

export type ConversationEventData = z.infer<typeof conversationEventDataSchema>;
