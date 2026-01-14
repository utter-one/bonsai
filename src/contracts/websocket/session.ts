import { z } from 'zod';
import { baseInputMessageSchema, baseOutputMessageSchema } from './common';

/** Request to begin a new live session. */
export const beginSessionRequestSchema = baseInputMessageSchema.extend({
  type: z.literal('begin_session').describe('Message type for beginning a new session'),
});

export type BeginSessionRequest = z.infer<typeof beginSessionRequestSchema>;

/** Response to begin session request. */
export const beginSessionResponseSchema = baseOutputMessageSchema.extend({
  type: z.literal('begin_session').describe('Message type for begin session response'),
  success: z.boolean().describe('Whether session was successfully created'),
  sessionId: z.string().optional().describe('Unique identifier for the created session'),
  error: z.string().optional().describe('Error message if session creation failed'),
});

export type BeginSessionResponse = z.infer<typeof beginSessionResponseSchema>;

/** Request to end an active session. */
export const endSessionRequestSchema = baseInputMessageSchema.extend({
  type: z.literal('end_session').describe('Message type for ending a session'),
  sessionId: z.string().describe('Unique identifier of the session to end'),
});

export type EndSessionRequest = z.infer<typeof endSessionRequestSchema>;

/** Response to end session request. */
export const endSessionResponseSchema = baseOutputMessageSchema.extend({
  type: z.literal('end_session').describe('Message type for end session response'),
  success: z.boolean().describe('Whether session was successfully ended'),
  error: z.string().optional().describe('Error message if session termination failed'),
});

export type EndSessionResponse = z.infer<typeof endSessionResponseSchema>;

/** Request to start a new conversation within a session. */
export const startConversationRequestSchema = baseInputMessageSchema.extend({
  type: z.literal('start_conversation').describe('Message type for starting a new conversation'),
  sessionId: z.string().describe('Session ID in which to start the conversation'),
  personaId: z.string().optional().describe('Optional persona ID for the conversation'),
});

export type StartConversationRequest = z.infer<typeof startConversationRequestSchema>;

/** Response to start conversation request. */
export const startConversationResponseSchema = baseOutputMessageSchema.extend({
  type: z.literal('start_conversation').describe('Message type for start conversation response'),
  success: z.boolean().describe('Whether conversation was successfully started'),
  conversationId: z.string().optional().describe('Unique identifier for the created conversation'),
  error: z.string().optional().describe('Error message if conversation creation failed'),
});

export type StartConversationResponse = z.infer<typeof startConversationResponseSchema>;

/** Request to resume an existing conversation. */
export const resumeConversationRequestSchema = baseInputMessageSchema.extend({
  type: z.literal('resume_conversation').describe('Message type for resuming a conversation'),
  sessionId: z.string().describe('Session ID in which to resume the conversation'),
  conversationId: z.string().describe('Unique identifier of the conversation to resume'),
});

export type ResumeConversationRequest = z.infer<typeof resumeConversationRequestSchema>;

/** Response to resume conversation request. */
export const resumeConversationResponseSchema = baseOutputMessageSchema.extend({
  type: z.literal('resume_conversation').describe('Message type for resume conversation response'),
  success: z.boolean().describe('Whether conversation was successfully resumed'),
  conversationId: z.string().optional().describe('Unique identifier of the resumed conversation'),
  error: z.string().optional().describe('Error message if conversation resumption failed'),
});

export type ResumeConversationResponse = z.infer<typeof resumeConversationResponseSchema>;

/** Request to end an active conversation. */
export const endConversationRequestSchema = baseInputMessageSchema.extend({
  type: z.literal('end_conversation').describe('Message type for ending a conversation'),
  sessionId: z.string().describe('Session ID containing the conversation'),
  conversationId: z.string().describe('Unique identifier of the conversation to end'),
});

export type EndConversationRequest = z.infer<typeof endConversationRequestSchema>;

/** Response to end conversation request. */
export const endConversationResponseSchema = baseOutputMessageSchema.extend({
  type: z.literal('end_conversation').describe('Message type for end conversation response'),
  success: z.boolean().describe('Whether conversation was successfully ended'),
  error: z.string().optional().describe('Error message if conversation termination failed'),
});

export type EndConversationResponse = z.infer<typeof endConversationResponseSchema>;
