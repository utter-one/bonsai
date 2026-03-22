/**
 * Client Abstraction Layer (CAL) — transport-agnostic message types for live conversation sessions.
 *
 * These types mirror the WebSocket contracts but strip all transport-specific concerns
 * (no requestId, no sessionId, binary audio instead of base64). A communication channel
 * implementation (e.g. a WebSocket adapter) is responsible for translating between CAL
 * types and the wire format.
 *
 * Naming conventions:
 *  - Input types (client → server): `CAL<Action>Message`
 *  - Output result types (server → client, response to a command): `CAL<Action>ResultMessage`
 *  - Output push types (server → client, unsolicited): `CAL<Description>Message`
 */

import { z } from 'zod';
import { parameterValueSchema } from '../types/parameters';
import { llmContentSchema } from '../services/providers/llm/ILlmProvider';
import { audioFormatSchema } from '../types/audio';
import { conversationEventTypeSchema, conversationEventDataSchema } from '../types/conversationEvents';


// Base message schemas

/**
 * Base fields shared by all inbound (input) messages.
 */
export const calBaseInputMessageSchema = z.object({
  /** Identifies the conversation this message belongs to. */
  conversationId: z.string(),
  /** Optional caller-supplied identifier echoed back in the corresponding result message. */
  correlationId: z.string().optional(),
});

/**
 * Base fields shared by all outbound (output) messages.
 */
export const calBaseOutputMessageSchema = z.object({
  /** Identifies the conversation this message belongs to. */
  conversationId: z.string(),
  /** Echoed from the originating input message, when applicable. */
  correlationId: z.string().optional(),
});

// Input message schemas

/**
 * Requests that a new conversation is started for the given user and stage.
 */
export const calStartConversationRequestSchema = calBaseInputMessageSchema.extend({
  type: z.literal('start_conversation'),
  /** Identifier of the user initiating the conversation. */
  userId: z.string(),
  /** Optional agent to use for the conversation. */
  agentId: z.string().optional(),
  /** Stage at which the conversation should begin. */
  stageId: z.string(),
  /** IANA timezone identifier (e.g. America/New_York). Defaults to UTC when absent. */
  timezone: z.string().optional(),
});

/**
 * Requests that a previously paused conversation is resumed.
 */
export const calResumeConversationRequestSchema = calBaseInputMessageSchema.extend({
  type: z.literal('resume_conversation'),
});

/**
 * Requests that the active conversation is ended.
 */
export const calEndConversationRequestSchema = calBaseInputMessageSchema.extend({
  type: z.literal('end_conversation'),
});

/**
 * Signals that the user has started speaking and the channel should begin buffering voice data.
 * Audio chunks are delivered separately via receiveAudioChunk.
 */
export const calStartUserVoiceInputRequestSchema = calBaseInputMessageSchema.extend({
  type: z.literal('start_user_voice_input'),
});

/**
 * Signals that the user has finished speaking and the voice input turn should be finalised.
 */
export const calEndUserVoiceInputRequestSchema = calBaseInputMessageSchema.extend({
  type: z.literal('end_user_voice_input'),
  /** Identifier of the input turn to close, as returned by the corresponding result message. */
  inputTurnId: z.string(),
});

/**
 * Delivers a text message from the user into the conversation.
 */
export const calSendUserTextInputRequestSchema = calBaseInputMessageSchema.extend({
  type: z.literal('send_user_text_input'),
  /** Text content submitted by the user. */
  text: z.string(),
});

/**
 * Instructs the conversation engine to navigate to a specific stage.
 */
export const calGoToStageRequestSchema = calBaseInputMessageSchema.extend({
  type: z.literal('go_to_stage'),
  /** Identifier of the target stage. */
  stageId: z.string(),
});

/**
 * Sets a single variable on a specific stage.
 */
export const calSetVarRequestSchema = calBaseInputMessageSchema.extend({
  type: z.literal('set_var'),
  /** Identifier of the stage that owns the variable. */
  stageId: z.string(),
  /** Name of the variable to set. */
  variableName: z.string(),
  /** New value for the variable. */
  variableValue: parameterValueSchema,
});

/**
 * Retrieves a single variable from a specific stage.
 */
export const calGetVarRequestSchema = calBaseInputMessageSchema.extend({
  type: z.literal('get_var'),
  /** Identifier of the stage that owns the variable. */
  stageId: z.string(),
  /** Name of the variable to retrieve. */
  variableName: z.string(),
});

/**
 * Retrieves all variables for a specific stage.
 */
export const calGetAllVarsRequestSchema = calBaseInputMessageSchema.extend({
  type: z.literal('get_all_vars'),
  /** Identifier of the stage whose variables should be retrieved. */
  stageId: z.string(),
});

/**
 * Triggers execution of a named global action with the supplied parameter values.
 */
export const calRunActionRequestSchema = calBaseInputMessageSchema.extend({
  type: z.literal('run_action'),
  /** Name of the global action to execute. */
  actionName: z.string(),
  /** Parameter values keyed by parameter name. */
  parameters: z.record(z.string(), parameterValueSchema),
});

/**
 * Requests execution of a tool by its identifier with the supplied parameter values.
 */
export const calCallToolRequestSchema = calBaseInputMessageSchema.extend({
  type: z.literal('call_tool'),
  /** Identifier of the tool to execute. */
  toolId: z.string(),
  /** Parameter values keyed by parameter name. */
  parameters: z.record(z.string(), parameterValueSchema),
});

/**
 * Discriminated union of all inbound message types accepted by a communication channel.
 */
export const calInputMessageSchema = z.discriminatedUnion('type', [
  calStartConversationRequestSchema,
  calResumeConversationRequestSchema,
  calEndConversationRequestSchema,
  calStartUserVoiceInputRequestSchema,
  calEndUserVoiceInputRequestSchema,
  calSendUserTextInputRequestSchema,
  calGoToStageRequestSchema,
  calSetVarRequestSchema,
  calGetVarRequestSchema,
  calGetAllVarsRequestSchema,
  calRunActionRequestSchema,
  calCallToolRequestSchema,
]);

// Output result message schemas

/**
 * Result of a start_conversation command.
 */
export const calStartConversationResponseSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('start_conversation'),
  success: z.boolean(),
  error: z.string().optional(),
});

/**
 * Result of a resume_conversation command.
 */
export const calResumeConversationResponseSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('resume_conversation'),
  success: z.boolean(),
  error: z.string().optional(),
});

/**
 * Result of an end_conversation command.
 */
export const calEndConversationResponseSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('end_conversation'),
  success: z.boolean(),
  error: z.string().optional(),
});

/**
 * Result of a start_user_voice_input command.
 * On success, inputTurnId must be supplied to subsequent voice chunks and the end_user_voice_input message.
 */
export const calStartUserVoiceInputResponseSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('start_user_voice_input'),
  success: z.boolean(),
  /** Identifier for the new voice input turn. Present when success is true. */
  inputTurnId: z.string().optional(),
  error: z.string().optional(),
});

/**
 * Result of an end_user_voice_input command.
 */
export const calEndUserVoiceInputResponseSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('end_user_voice_input'),
  success: z.boolean(),
  /** Identifier of the voice input turn that was closed. */
  inputTurnId: z.string(),
  error: z.string().optional(),
});

/**
 * Result of a send_user_text_input command.
 * inputTurnId identifies the turn created for this text input and can be used to correlate
 * the resulting conversation events.
 */
export const calSendUserTextInputResponseSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('send_user_text_input'),
  success: z.boolean(),
  /** Identifier of the input turn created for this text submission. */
  inputTurnId: z.string(),
  error: z.string().optional(),
});

/**
 * Result of a go_to_stage command.
 */
export const calGoToStageResponseSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('go_to_stage'),
  success: z.boolean(),
  error: z.string().optional(),
});

/**
 * Result of a set_var command.
 */
export const calSetVarResponseSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('set_var_result'),
  success: z.boolean(),
  error: z.string().optional(),
});

/**
 * Result of a get_var command.
 */
export const calGetVarResponseSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('get_var'),
  success: z.boolean(),
  /** Name of the requested variable, echoed for easy correlation. */
  variableName: z.string(),
  /** Retrieved value. Absent when the variable does not exist or success is false. */
  variableValue: parameterValueSchema.optional(),
  error: z.string().optional(),
});

/**
 * Result of a get_all_vars command.
 */
export const calGetAllVarsResponseSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('get_all_vars'),
  success: z.boolean(),
  /** All stage variables keyed by name. Empty object when none exist. */
  variables: z.record(z.string(), parameterValueSchema),
  error: z.string().optional(),
});

/**
 * Result of a run_action command.
 */
export const calRunActionResponseSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('run_action'),
  success: z.boolean(),
  /** Multi-modal content blocks returned by the action. */
  result: z.array(llmContentSchema).optional(),
  error: z.string().optional(),
});

/**
 * Result of a call_tool command.
 */
export const calCallToolResponseSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('call_tool'),
  success: z.boolean(),
  /** Multi-modal content blocks returned by the tool. */
  result: z.array(llmContentSchema).optional(),
  error: z.string().optional(),
});

// Output push message schemas — AI generation

/**
 * Signals the beginning of an AI response generation turn.
 * Sent before any voice chunks or transcription chunks are emitted.
 */
export const calStartAiGenerationOutputMessageSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('start_ai_generation_output'),
  /** Identifier for this generation turn; used to correlate all subsequent output messages. */
  outputTurnId: z.string(),
  /** Whether the response will include synthesised voice audio. */
  expectVoice: z.boolean(),
});

/**
 * Carries a single chunk of AI-synthesised speech audio.
 * Chunks arrive in order and the final chunk is marked by isFinal.
 */
export const calSendAiVoiceChunkMessageSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('send_ai_voice_chunk'),
  /** Generation turn this chunk belongs to. */
  outputTurnId: z.string(),
  /** Raw audio data. Encoding is the channel adapter's responsibility. */
  audioData: z.instanceof(Buffer),
  /** Encoding of audioData. */
  audioFormat: audioFormatSchema,
  /** Unique identifier for this specific chunk. */
  chunkId: z.string(),
  /** Sequential 0-based position within the output turn's audio stream. */
  ordinal: z.number(),
  /** Whether this is the final audio chunk for this output turn. */
  isFinal: z.boolean(),
  /** Sample rate in Hz (e.g. 24000). */
  sampleRate: z.number().optional(),
  /** Bit rate in bits per second (e.g. 64000). */
  bitRate: z.number().optional(),
});

/**
 * Signals that the AI generation turn has completed.
 */
export const calEndAiGenerationOutputMessageSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('end_ai_generation_output'),
  /** Generation turn that has ended. */
  outputTurnId: z.string(),
  /** Full text that was synthesised to speech (or generated, when voice is disabled). */
  fullText: z.string(),
});

/**
 * Carries an interim or final text transcription chunk of the AI's speech output.
 */
export const calAiTranscribedChunkMessageSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('ai_transcribed_chunk'),
  /** Generation turn this chunk belongs to. */
  outputTurnId: z.string(),
  /** Unique identifier for this chunk. */
  chunkId: z.string(),
  /** Transcribed text content. */
  chunkText: z.string(),
  /** Sequential 0-based position within the transcription stream. */
  ordinal: z.number(),
  /** Whether this is the final transcription chunk for this output turn. */
  isFinal: z.boolean(),
});

// Output push message schemas — user transcription

/**
 * Carries an interim or final ASR transcription chunk of the user's speech input.
 */
export const calUserTranscribedChunkMessageSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('user_transcribed_chunk'),
  /** Input turn this transcription chunk belongs to. */
  inputTurnId: z.string(),
  /** Unique identifier for this chunk. */
  chunkId: z.string(),
  /** Transcribed text content. */
  chunkText: z.string(),
  /** Sequential 0-based position within the transcription stream. */
  ordinal: z.number(),
  /** true once ASR has finalised its transcript for this chunk. */
  isFinal: z.boolean(),
});

// Output push message schemas — multi-modal AI output

/**
 * Carries an AI-generated image block.
 */
export const calSendAiImageOutputMessageSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('send_ai_image_output'),
  /** Generation turn this image belongs to. */
  outputTurnId: z.string(),
  /** Raw image data. Encoding is the channel adapter's responsibility. */
  imageData: z.instanceof(Buffer),
  /** MIME type of imageData (e.g. image/png, image/jpeg). */
  mimeType: z.string(),
  /** 0-based index when multiple images are produced in a single response. */
  sequenceNumber: z.number(),
});

/**
 * Carries a non-TTS AI-generated audio block (e.g. a sound effect or audio file).
 */
export const calSendAiAudioOutputMessageSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('send_ai_audio_output'),
  /** Generation turn this audio belongs to. */
  outputTurnId: z.string(),
  /** Raw audio data. Encoding is the channel adapter's responsibility. */
  audioData: z.instanceof(Buffer),
  /** Encoding of audioData. */
  audioFormat: audioFormatSchema,
  /** MIME type of audioData (e.g. audio/mpeg, audio/wav). */
  mimeType: z.string(),
  /** 0-based index when multiple audio blocks are produced in a single response. */
  sequenceNumber: z.number(),
  /** Optional low-level audio metadata. */
  metadata: z.object({
    /** Sample rate in Hz. */
    sampleRate: z.number().optional(),
    /** Number of audio channels. */
    channels: z.number().optional(),
    /** Bit depth per sample. */
    bitDepth: z.number().optional(),
  }).optional(),
});

// Output push message schemas — conversation events

/**
 * Broadcasts a conversation lifecycle or activity event to the channel.
 * Mirrors the conversation_event WebSocket message but without session/transport fields.
 */
export const calConversationEventMessageSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('conversation_event'),
  /** Identifier of the input turn associated with this event, when applicable. */
  inputTurnId: z.string().optional(),
  /** Identifier of the output turn associated with this event, when applicable. */
  outputTurnId: z.string().optional(),
  /** Discriminator for the event payload. */
  eventType: conversationEventTypeSchema,
  /** Structured data describing the event. */
  eventData: conversationEventDataSchema,
});

/**
 * Broadcasts an update to a previously emitted conversation event.
 * Mirrors the conversation_event_update WebSocket message but without session/transport fields.
 */
export const calConversationEventUpdateMessageSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('conversation_event_update'),
  /** Identifier of the input turn associated with this event, when applicable. */
  inputTurnId: z.string().optional(),
  /** Identifier of the output turn associated with this event, when applicable. */
  outputTurnId: z.string().optional(),
  /** Discriminator for the event payload. */
  eventType: conversationEventTypeSchema,
  /** Updated structured data describing the event. */
  eventData: conversationEventDataSchema,
});

// Output union schema

/**
 * Discriminated union of all outbound message types emitted by a communication channel.
 */
export const calOutputMessageSchema = z.discriminatedUnion('type', [
  calStartConversationResponseSchema,
  calResumeConversationResponseSchema,
  calEndConversationResponseSchema,
  calStartUserVoiceInputResponseSchema,
  calEndUserVoiceInputResponseSchema,
  calSendUserTextInputResponseSchema,
  calGoToStageResponseSchema,
  calSetVarResponseSchema,
  calGetVarResponseSchema,
  calGetAllVarsResponseSchema,
  calRunActionResponseSchema,
  calCallToolResponseSchema,
  calStartAiGenerationOutputMessageSchema,
  calSendAiVoiceChunkMessageSchema,
  calEndAiGenerationOutputMessageSchema,
  calAiTranscribedChunkMessageSchema,
  calUserTranscribedChunkMessageSchema,
  calSendAiImageOutputMessageSchema,
  calSendAiAudioOutputMessageSchema,
  calConversationEventMessageSchema,
  calConversationEventUpdateMessageSchema,
]);

// Types inferred from schemas

export type CALBaseInputMessage = z.infer<typeof calBaseInputMessageSchema>;
export type CALBaseOutputMessage = z.infer<typeof calBaseOutputMessageSchema>;

export type CALStartConversationRequest = z.infer<typeof calStartConversationRequestSchema>;
export type CALResumeConversationRequest = z.infer<typeof calResumeConversationRequestSchema>;
export type CALEndConversationRequest = z.infer<typeof calEndConversationRequestSchema>;
export type CALStartUserVoiceInputRequest = z.infer<typeof calStartUserVoiceInputRequestSchema>;
export type CALEndUserVoiceInputRequest = z.infer<typeof calEndUserVoiceInputRequestSchema>;
export type CALSendUserTextInputRequest = z.infer<typeof calSendUserTextInputRequestSchema>;
export type CALGoToStageRequest = z.infer<typeof calGoToStageRequestSchema>;
export type CALSetVarRequest = z.infer<typeof calSetVarRequestSchema>;
export type CALGetVarRequest = z.infer<typeof calGetVarRequestSchema>;
export type CALGetAllVarsRequest = z.infer<typeof calGetAllVarsRequestSchema>;
export type CALRunActionRequest = z.infer<typeof calRunActionRequestSchema>;
export type CALCallToolRequest = z.infer<typeof calCallToolRequestSchema>;
export type CALInputMessage = z.infer<typeof calInputMessageSchema>;

export type CALStartConversationResponse = z.infer<typeof calStartConversationResponseSchema>;
export type CALResumeConversationResponse = z.infer<typeof calResumeConversationResponseSchema>;
export type CALEndConversationResponse = z.infer<typeof calEndConversationResponseSchema>;
export type CALStartUserVoiceInputResponse = z.infer<typeof calStartUserVoiceInputResponseSchema>;
export type CALEndUserVoiceInputResponse = z.infer<typeof calEndUserVoiceInputResponseSchema>;
export type CALSendUserTextInputResponse = z.infer<typeof calSendUserTextInputResponseSchema>;
export type CALGoToStageResponse = z.infer<typeof calGoToStageResponseSchema>;
export type CALSetVarResponse = z.infer<typeof calSetVarResponseSchema>;
export type CALGetVarResponse = z.infer<typeof calGetVarResponseSchema>;
export type CALGetAllVarsResponse = z.infer<typeof calGetAllVarsResponseSchema>;
export type CALRunActionResponse = z.infer<typeof calRunActionResponseSchema>;
export type CALCallToolResponse = z.infer<typeof calCallToolResponseSchema>;

export type CALStartAiGenerationOutputMessage = z.infer<typeof calStartAiGenerationOutputMessageSchema>;
export type CALSendAiVoiceChunkMessage = z.infer<typeof calSendAiVoiceChunkMessageSchema>;
export type CALEndAiGenerationOutputMessage = z.infer<typeof calEndAiGenerationOutputMessageSchema>;
export type CALAiTranscribedChunkMessage = z.infer<typeof calAiTranscribedChunkMessageSchema>;
export type CALUserTranscribedChunkMessage = z.infer<typeof calUserTranscribedChunkMessageSchema>;
export type CALSendAiImageOutputMessage = z.infer<typeof calSendAiImageOutputMessageSchema>;
export type CALSendAiAudioOutputMessage = z.infer<typeof calSendAiAudioOutputMessageSchema>;
export type CALConversationEventMessage = z.infer<typeof calConversationEventMessageSchema>;
export type CALConversationEventUpdateMessage = z.infer<typeof calConversationEventUpdateMessageSchema>;
export type CALOutputMessage = z.infer<typeof calOutputMessageSchema>;
