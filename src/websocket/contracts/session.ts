import { z } from 'zod';
import { calToWsInput, calToWsOutput } from './utils';
import {
  calStartConversationRequestSchema,
  calStartConversationResponseSchema,
  calResumeConversationRequestSchema,
  calResumeConversationResponseSchema,
  calEndConversationRequestSchema,
  calEndConversationResponseSchema,
  calConversationEventMessageSchema,
  calConversationEventUpdateMessageSchema,
} from '../../channels/messages';

/** Request to start a new conversation within a session. */
export const startConversationRequestSchema = calToWsInput(calStartConversationRequestSchema);
export type StartConversationRequest = z.infer<typeof startConversationRequestSchema>;

/** Response to start conversation request. */
export const startConversationResponseSchema = calToWsOutput(calStartConversationResponseSchema);
export type StartConversationResponse = z.infer<typeof startConversationResponseSchema>;

/** Request to resume an existing conversation. */
export const resumeConversationRequestSchema = calToWsInput(calResumeConversationRequestSchema);
export type ResumeConversationRequest = z.infer<typeof resumeConversationRequestSchema>;

/** Response to resume conversation request. */
export const resumeConversationResponseSchema = calToWsOutput(calResumeConversationResponseSchema);
export type ResumeConversationResponse = z.infer<typeof resumeConversationResponseSchema>;

/** Request to end an active conversation. */
export const endConversationRequestSchema = calToWsInput(calEndConversationRequestSchema);
export type EndConversationRequest = z.infer<typeof endConversationRequestSchema>;

/** Response to end conversation request. */
export const endConversationResponseSchema = calToWsOutput(calEndConversationResponseSchema);
export type EndConversationResponse = z.infer<typeof endConversationResponseSchema>;

/** Message sent when a conversation event occurs. */
export const conversationEventMessageSchema = calToWsOutput(calConversationEventMessageSchema);
export type ConversationEventMessage = z.infer<typeof conversationEventMessageSchema>;

/** Message sent when a conversation event is updated. */
export const conversationEventUpdateMessageSchema = calToWsOutput(calConversationEventUpdateMessageSchema);
export type ConversationEventUpdateMessage = z.infer<typeof conversationEventUpdateMessageSchema>;