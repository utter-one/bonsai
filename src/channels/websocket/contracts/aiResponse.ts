import { z } from 'zod';
import { calToWsOutput } from './utils';
import {
  calStartAiGenerationOutputMessageSchema,
  calSendAiVoiceChunkMessageSchema,
  calEndAiGenerationOutputMessageSchema,
  calAiTranscribedChunkMessageSchema,
  calSendAiImageOutputMessageSchema,
  calSendAiAudioOutputMessageSchema,
} from '../../messages';

/** Message indicating the start of AI voice output. */
export const startAiGenerationOutputMessageSchema = calToWsOutput(calStartAiGenerationOutputMessageSchema);
export type StartAiGenerationOutputMessage = z.infer<typeof startAiGenerationOutputMessageSchema>;

/**
 * Message containing a chunk of AI voice output audio data.
 * audioData is base64-encoded on the wire (the CAL layer carries a raw Buffer).
 */
export const sendAiVoiceChunkMessageSchema = calToWsOutput(calSendAiVoiceChunkMessageSchema).extend({
  audioData: z.string().describe('Base64-encoded audio chunk data'),
});
export type SendAiVoiceChunkMessage = z.infer<typeof sendAiVoiceChunkMessageSchema>;

/** Message indicating the end of AI voice output. */
export const endAiGenerationOutputMessageSchema = calToWsOutput(calEndAiGenerationOutputMessageSchema);
export type EndAiGenerationOutputMessage = z.infer<typeof endAiGenerationOutputMessageSchema>;

/** Message sent when an AI speech chunk has been transcribed. */
export const aiTranscribedChunkMessageSchema = calToWsOutput(calAiTranscribedChunkMessageSchema);
export type AiTranscribedChunkMessage = z.infer<typeof aiTranscribedChunkMessageSchema>;

/**
 * Message containing AI-generated image output.
 * imageData is base64-encoded on the wire (the CAL layer carries a raw Buffer).
 */
export const sendAiImageOutputMessageSchema = calToWsOutput(calSendAiImageOutputMessageSchema).extend({
  imageData: z.string().describe('Base64-encoded image data'),
});
export type SendAiImageOutputMessage = z.infer<typeof sendAiImageOutputMessageSchema>;

/**
 * Message containing AI-generated audio output (non-TTS).
 * audioData is base64-encoded on the wire (the CAL layer carries a raw Buffer).
 */
export const sendAiAudioOutputMessageSchema = calToWsOutput(calSendAiAudioOutputMessageSchema).extend({
  audioData: z.string().describe('Base64-encoded audio data'),
});
export type SendAiAudioOutputMessage = z.infer<typeof sendAiAudioOutputMessageSchema>;
