import { z } from 'zod';
import { sessionOutputMessageSchema } from './common';
import { audioFormatValues } from '../../types/audio';

/** Message indicating the start of AI voice output. */
export const startAiVoiceOutputMessageSchema = sessionOutputMessageSchema.extend({
  type: z.literal('start_ai_voice_output').describe('Message type for starting AI voice output'),
  conversationId: z.string().describe('Unique identifier of the conversation'),
  outputTurnId: z.string().describe('Unique identifier for this voice output sequence for correlation'),
});

export type StartAiVoiceOutputMessage = z.infer<typeof startAiVoiceOutputMessageSchema>;

/** Message containing a chunk of AI voice output audio data. */
export const sendAiVoiceChunkMessageSchema = sessionOutputMessageSchema.extend({
  type: z.literal('send_ai_voice_chunk').describe('Message type for sending AI voice chunk'),
  conversationId: z.string().describe('Unique identifier of the conversation'),
  outputTurnId: z.string().describe('Unique identifier for this voice output sequence for correlation'),
  audioData: z.string().describe('Base64-encoded audio chunk data'),
  audioFormat: z.enum(audioFormatValues).describe('Audio format of the chunk data'),
  chunkId: z.string().describe('Unique identifier for this specific audio chunk'),
  ordinal: z.number().describe('Sequential order of this chunk in the voice output sequence'),
  isFinal: z.boolean().describe('Whether this is the final chunk in the voice output sequence'),
});

export type SendAiVoiceChunkMessage = z.infer<typeof sendAiVoiceChunkMessageSchema>;

/** Message indicating the end of AI voice output. */
export const endAiVoiceOutputMessageSchema = sessionOutputMessageSchema.extend({
  type: z.literal('end_ai_voice_output').describe('Message type for ending AI voice output'),
  conversationId: z.string().describe('Unique identifier of the conversation'),
  outputTurnId: z.string().describe('Unique identifier for this voice output sequence for correlation'),
  fullText: z.string().describe('The full text that was converted to speech, if available'),
});

export type EndAiVoiceOutputMessage = z.infer<typeof endAiVoiceOutputMessageSchema>;

export const aiTranscribedChunkMessageSchema = z.object({
  type: z.literal('ai_transcribed_chunk').describe('Message type for AI transcribed text chunk'),
  conversationId: z.string().describe('Unique identifier of the conversation'),
  chunkId: z.string().describe('Unique identifier for this text chunk'),
  chunkText: z.string().describe('Chunk of transcribed text output from the AI'),
  isFinal: z.boolean().describe('Whether this is the final chunk of text output'),
});

export type AiTranscribedChunkMessage = z.infer<typeof aiTranscribedChunkMessageSchema>;