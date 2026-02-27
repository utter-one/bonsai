import { z } from 'zod';
import { sessionInputMessageSchema, sessionOutputMessageSchema } from './common';
import { conversationEventDataSchema, conversationEventTypeSchema } from '../../types/conversationEvents';

/** Request to start a new conversation within a session. */
export const startConversationRequestSchema = sessionInputMessageSchema.extend({
  type: z.literal('start_conversation').describe('Message type for starting a new conversation'),
  sessionId: z.string().describe('Session ID in which to start the conversation'),
  userId: z.string().describe('User ID initiating the conversation'),
  personaId: z.string().optional().describe('Optional persona ID for the conversation'),
  stageId: z.string().describe('Stage ID to initiate the conversation at a specific stage'),
  timezone: z.string().optional().describe('IANA timezone identifier for this conversation (e.g. America/New_York, Europe/Warsaw). Overrides user profile and project timezone settings. Defaults to UTC when not provided by any source.'),
});

export type StartConversationRequest = z.infer<typeof startConversationRequestSchema>;

/** Response to start conversation request. */
export const startConversationResponseSchema = sessionOutputMessageSchema.extend({
  type: z.literal('start_conversation').describe('Message type for start conversation response'),
  success: z.boolean().describe('Whether conversation was successfully started'),
  conversationId: z.string().optional().describe('Unique identifier for the created conversation'),
  error: z.string().optional().describe('Error message if conversation creation failed'),
});

export type StartConversationResponse = z.infer<typeof startConversationResponseSchema>;

/** Request to resume an existing conversation. */
export const resumeConversationRequestSchema = sessionInputMessageSchema.extend({
  type: z.literal('resume_conversation').describe('Message type for resuming a conversation'),
  sessionId: z.string().describe('Session ID in which to resume the conversation'),
  conversationId: z.string().describe('Unique identifier of the conversation to resume'),
});

export type ResumeConversationRequest = z.infer<typeof resumeConversationRequestSchema>;

/** Response to resume conversation request. */
export const resumeConversationResponseSchema = sessionOutputMessageSchema.extend({
  type: z.literal('resume_conversation').describe('Message type for resume conversation response'),
  success: z.boolean().describe('Whether conversation was successfully resumed'),
  conversationId: z.string().optional().describe('Unique identifier of the resumed conversation'),
  error: z.string().optional().describe('Error message if conversation resumption failed'),
});

export type ResumeConversationResponse = z.infer<typeof resumeConversationResponseSchema>;

/** Request to end an active conversation. */
export const endConversationRequestSchema = sessionInputMessageSchema.extend({
  type: z.literal('end_conversation').describe('Message type for ending a conversation'),
  sessionId: z.string().describe('Session ID containing the conversation'),
  conversationId: z.string().describe('Unique identifier of the conversation to end'),
});

export type EndConversationRequest = z.infer<typeof endConversationRequestSchema>;

/** Response to end conversation request. */
export const endConversationResponseSchema = sessionOutputMessageSchema.extend({
  type: z.literal('end_conversation').describe('Message type for end conversation response'),
  success: z.boolean().describe('Whether conversation was successfully ended'),
  error: z.string().optional().describe('Error message if conversation termination failed'),
});

export type EndConversationResponse = z.infer<typeof endConversationResponseSchema>;

/** Message sent when a conversation event occurs. */
export const conversationEventMessageSchema = sessionOutputMessageSchema.extend({
  type: z.literal('conversation_event').describe('Message type for conversation events'),
  sessionId: z.string().describe('Session ID containing the conversation'),
  conversationId: z.string().describe('Unique identifier of the conversation'),
  inputTurnId: z.string().optional().describe('Identifier of the input turn associated with the event, if applicable'),
  outputTurnId: z.string().optional().describe('Identifier of the output turn associated with the event, if applicable'),
  eventType: conversationEventTypeSchema.describe('Type of the conversation event'),
  eventData: conversationEventDataSchema.describe('Data associated with the conversation event'),
});

export type ConversationEventMessage = z.infer<typeof conversationEventMessageSchema>;  