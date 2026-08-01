import { z } from 'zod';
import { calToWsOutput } from './utils';
import {
  calStartAiGenerationOutputMessageSchema,
  calSendAiVoiceChunkMessageSchema,
  calAbortAiGenerationOutputMessageSchema,
  calEndAiGenerationOutputMessageSchema,
  calAiTranscribedChunkMessageSchema,
  calUserSpeakingStartedMessageSchema,
  calSendAiImageOutputMessageSchema,
  calSendAiAudioOutputMessageSchema,
  calAttachFileOutputMessageSchema,
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

/**
 * Message indicating that AI generation was aborted due to user barge-in.
 */
export const abortAiGenerationOutputMessageSchema = calToWsOutput(calAbortAiGenerationOutputMessageSchema);
export type AbortAiGenerationOutputMessage = z.infer<typeof abortAiGenerationOutputMessageSchema>;

/** Message indicating the end of AI voice output. */
export const endAiGenerationOutputMessageSchema = calToWsOutput(calEndAiGenerationOutputMessageSchema);
export type EndAiGenerationOutputMessage = z.infer<typeof endAiGenerationOutputMessageSchema>;

/** Message sent when an AI speech chunk has been transcribed. */
export const aiTranscribedChunkMessageSchema = calToWsOutput(calAiTranscribedChunkMessageSchema);
export type AiTranscribedChunkMessage = z.infer<typeof aiTranscribedChunkMessageSchema>;

/** Message signalling that VAD detected the user started speaking during AI generation (barge-in). */
export const userSpeakingStartedMessageSchema = calToWsOutput(calUserSpeakingStartedMessageSchema);
export type UserSpeakingStartedMessage = z.infer<typeof userSpeakingStartedMessageSchema>;

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

/**
 * Message containing a file attachment staged by an attach_file effect.
 * Delivered after text/voice output within the same generation turn.
 */
export const attachFileOutputMessageSchema = calToWsOutput(calAttachFileOutputMessageSchema);
export type AttachFileOutputMessage = z.infer<typeof attachFileOutputMessageSchema>;
