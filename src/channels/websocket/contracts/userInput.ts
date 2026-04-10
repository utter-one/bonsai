import { z } from 'zod';
import { sessionInputMessageSchema, sessionOutputMessageSchema } from './common';
import { calToWsInput, calToWsOutput } from './utils';
import {
  calStartUserVoiceInputRequestSchema,
  calStartUserVoiceInputResponseSchema,
  calEndUserVoiceInputRequestSchema,
  calEndUserVoiceInputResponseSchema,
  calSendUserTextInputRequestSchema,
  calSendUserTextInputResponseSchema,
  calUserTranscribedChunkMessageSchema,
} from '../../messages';

/** Request to start voice input from the user. */
export const startUserVoiceInputRequestSchema = calToWsInput(calStartUserVoiceInputRequestSchema);
export type StartUserVoiceInputRequest = z.infer<typeof startUserVoiceInputRequestSchema>;

/** Response to start user voice input request. */
export const startUserVoiceInputResponseSchema = calToWsOutput(calStartUserVoiceInputResponseSchema);
export type StartUserVoiceInputResponse = z.infer<typeof startUserVoiceInputResponseSchema>;

/**
 * Request to send a chunk of user voice input audio data.
 * WebSocket-only: has no CAL equivalent (binary audio is delivered directly to the channel host).
 */
export const sendUserVoiceChunkRequestSchema = sessionInputMessageSchema.extend({
  type: z.literal('send_user_voice_chunk').describe('Message type for sending user voice chunk'),
  conversationId: z.string().describe('Unique identifier of the conversation'),
  audioData: z.string().describe('Base64-encoded audio chunk data'),
  ordinal: z.number().describe('Sequential order of this chunk in the voice input sequence'),
  inputTurnId: z.string().optional().describe('Unique identifier for the input turn. Optional in server VAD mode where the turn ID is managed server-side.'),
});
export type SendUserVoiceChunkRequest = z.infer<typeof sendUserVoiceChunkRequestSchema>;

/**
 * Response to send user voice chunk request.
 * WebSocket-only: has no CAL equivalent.
 */
export const sendUserVoiceChunkResponseSchema = sessionOutputMessageSchema.extend({
  type: z.literal('send_user_voice_chunk').describe('Message type for send user voice chunk response'),
  success: z.boolean().describe('Whether voice chunk was successfully received'),
  error: z.string().optional().describe('Error message if voice chunk processing failed'),
  inputTurnId: z.string().optional().describe('Unique identifier for the input turn'),
});
export type SendUserVoiceChunkResponse = z.infer<typeof sendUserVoiceChunkResponseSchema>;

/** Request to end user voice input and finalize transcription. */
export const endUserVoiceInputRequestSchema = calToWsInput(calEndUserVoiceInputRequestSchema);
export type EndUserVoiceInputRequest = z.infer<typeof endUserVoiceInputRequestSchema>;

/** Response to end user voice input request. */
export const endUserVoiceInputResponseSchema = calToWsOutput(calEndUserVoiceInputResponseSchema);
export type EndUserVoiceInputResponse = z.infer<typeof endUserVoiceInputResponseSchema>;

/** Request to send text input from the user. */
export const sendUserTextInputRequestSchema = calToWsInput(calSendUserTextInputRequestSchema);
export type SendUserTextInputRequest = z.infer<typeof sendUserTextInputRequestSchema>;

/** Response to send user text input request. */
export const sendUserTextInputResponseSchema = calToWsOutput(calSendUserTextInputResponseSchema);
export type SendUserTextInputResponse = z.infer<typeof sendUserTextInputResponseSchema>;

/** Message sent when a user speech chunk has been transcribed. */
export const userTranscribedChunkMessageSchema = calToWsOutput(calUserTranscribedChunkMessageSchema);
export type UserTranscribedChunkMessage = z.infer<typeof userTranscribedChunkMessageSchema>;