import { z } from 'zod';
import { sessionInputMessageSchema, sessionOutputMessageSchema } from './common';

/** Request to start voice input from the user. */
export const startUserVoiceInputRequestSchema = sessionInputMessageSchema.extend({
  type: z.literal('start_user_voice_input').describe('Message type for starting user voice input'),
  conversationId: z.string().describe('Unique identifier of the conversation'),
});

export type StartUserVoiceInputRequest = z.infer<typeof startUserVoiceInputRequestSchema>;

/** Response to start user voice input request. */
export const startUserVoiceInputResponseSchema = sessionOutputMessageSchema.extend({
  type: z.literal('start_user_voice_input').describe('Message type for start user voice input response'),
  success: z.boolean().describe('Whether voice input was successfully started'),
  error: z.string().optional().describe('Error message if voice input start failed'),
});

export type StartUserVoiceInputResponse = z.infer<typeof startUserVoiceInputResponseSchema>;

/** Request to send a chunk of user voice input audio data. */
export const sendUserVoiceChunkRequestSchema = sessionInputMessageSchema.extend({
  type: z.literal('send_user_voice_chunk').describe('Message type for sending user voice chunk'),
  conversationId: z.string().describe('Unique identifier of the conversation'),
  audioData: z.string().describe('Base64-encoded audio chunk data'),
});

export type SendUserVoiceChunkRequest = z.infer<typeof sendUserVoiceChunkRequestSchema>;

/** Response to send user voice chunk request. */
export const sendUserVoiceChunkResponseSchema = sessionOutputMessageSchema.extend({
  type: z.literal('send_user_voice_chunk').describe('Message type for send user voice chunk response'),
  success: z.boolean().describe('Whether voice chunk was successfully received'),
  error: z.string().optional().describe('Error message if voice chunk processing failed'),
});

export type SendUserVoiceChunkResponse = z.infer<typeof sendUserVoiceChunkResponseSchema>;

/** Request to end user voice input and finalize transcription. */
export const endUserVoiceInputRequestSchema = sessionInputMessageSchema.extend({
  type: z.literal('end_user_voice_input').describe('Message type for ending user voice input'),
  conversationId: z.string().describe('Unique identifier of the conversation'),
});

export type EndUserVoiceInputRequest = z.infer<typeof endUserVoiceInputRequestSchema>;

/** Response to end user voice input request. */
export const endUserVoiceInputResponseSchema = sessionOutputMessageSchema.extend({
  type: z.literal('end_user_voice_input').describe('Message type for end user voice input response'),
  success: z.boolean().describe('Whether voice input was successfully ended'),
  error: z.string().optional().describe('Error message if voice input ending failed'),
});

export type EndUserVoiceInputResponse = z.infer<typeof endUserVoiceInputResponseSchema>;

/** Request to send text input from the user. */
export const sendUserTextInputRequestSchema = sessionInputMessageSchema.extend({
  type: z.literal('send_user_text_input').describe('Message type for sending user text input'),
  conversationId: z.string().describe('Unique identifier of the conversation'),
  text: z.string().describe('Text content from the user'),
});

export type SendUserTextInputRequest = z.infer<typeof sendUserTextInputRequestSchema>;

/** Response to send user text input request. */
export const sendUserTextInputResponseSchema = sessionOutputMessageSchema.extend({
  type: z.literal('send_user_text_input').describe('Message type for send user text input response'),
  success: z.boolean().describe('Whether text input was successfully received'),
  error: z.string().optional().describe('Error message if text input processing failed'),
});

export type SendUserTextInputResponse = z.infer<typeof sendUserTextInputResponseSchema>;
