import { z } from 'zod';
import { sessionOutputMessageSchema } from './common';
import { audioFormatValues } from '../../types/audio';

/** Message indicating the start of AI voice output. */
export const startAiGenerationOutputMessageSchema = sessionOutputMessageSchema.extend({
  type: z.literal('start_ai_generation_output').describe('Message type for starting AI voice output'),
  conversationId: z.string().describe('Unique identifier of the conversation'),
  outputTurnId: z.string().describe('Unique identifier for this voice output sequence for correlation'),
  expectVoice: z.boolean().describe('Whether the AI response will include voice output'),
});

export type StartAiGenerationOutputMessage = z.infer<typeof startAiGenerationOutputMessageSchema>;

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
  sampleRate: z.number().optional().describe('Sample rate of the audio chunk (e.g., 24000)'),
  bitRate: z.number().optional().describe('Bit rate of the audio chunk in bits per second (e.g., 64000)'),
});

export type SendAiVoiceChunkMessage = z.infer<typeof sendAiVoiceChunkMessageSchema>;

/** Message indicating the end of AI voice output. */
export const endAiGenerationOutputMessageSchema = sessionOutputMessageSchema.extend({
  type: z.literal('end_ai_generation_output').describe('Message type for ending AI voice output'),
  conversationId: z.string().describe('Unique identifier of the conversation'),
  outputTurnId: z.string().describe('Unique identifier for this voice output sequence for correlation'),
  fullText: z.string().describe('The full text that was converted to speech, if available'),
});

export type EndAiGenerationOutputMessage = z.infer<typeof endAiGenerationOutputMessageSchema>;

export const aiTranscribedChunkMessageSchema = sessionOutputMessageSchema.extend({
  type: z.literal('ai_transcribed_chunk').describe('Message type for AI transcribed text chunk'),
  conversationId: z.string().describe('Unique identifier of the conversation'),
  outputTurnId: z.string().describe('Unique identifier for the output turn this chunk belongs to'),
  chunkId: z.string().describe('Unique identifier for this text chunk'),
  chunkText: z.string().describe('Chunk of transcribed text output from the AI'),
  ordinal: z.number().describe('Sequential order of this chunk in the transcription sequence'),
  isFinal: z.boolean().describe('Whether this is the final chunk of text output'),
});

export type AiTranscribedChunkMessage = z.infer<typeof aiTranscribedChunkMessageSchema>;

/** Message containing AI-generated image output. */
export const sendAiImageOutputMessageSchema = sessionOutputMessageSchema.extend({
  type: z.literal('send_ai_image_output').describe('Message type for sending AI-generated image'),
  conversationId: z.string().describe('Unique identifier of the conversation'),
  outputTurnId: z.string().describe('Unique identifier for this output sequence for correlation'),
  imageData: z.string().describe('Base64-encoded image data'),
  mimeType: z.string().describe('MIME type of the image (e.g., image/png, image/jpeg)'),
  sequenceNumber: z.number().describe('Sequence number if multiple images in response'),
});

export type SendAiImageOutputMessage = z.infer<typeof sendAiImageOutputMessageSchema>;

/** Message containing AI-generated audio output (non-TTS). */
export const sendAiAudioOutputMessageSchema = sessionOutputMessageSchema.extend({
  type: z.literal('send_ai_audio_output').describe('Message type for sending AI-generated audio'),
  conversationId: z.string().describe('Unique identifier of the conversation'),
  outputTurnId: z.string().describe('Unique identifier for this output sequence for correlation'),
  audioData: z.string().describe('Base64-encoded audio data'),
  audioFormat: z.enum(['pcm', 'mp3', 'wav', 'opus']).describe('Audio format identifier'),
  mimeType: z.string().describe('MIME type of the audio (e.g., audio/pcm, audio/mpeg)'),
  sequenceNumber: z.number().describe('Sequence number if multiple audio blocks in response'),
  metadata: z.object({
    sampleRate: z.number().optional().describe('Sample rate in Hz'),
    channels: z.number().optional().describe('Number of audio channels'),
    bitDepth: z.number().optional().describe('Bit depth per sample'),
  }).optional().describe('Audio metadata'),
});

export type SendAiAudioOutputMessage = z.infer<typeof sendAiAudioOutputMessageSchema>;
