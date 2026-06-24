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
  conversationId: z.string().min(1).describe('Unique identifier of the conversation'),
  correlationId: z.string().optional().describe('Optional caller-supplied identifier echoed back in the corresponding result message'),
});

/**
 * Base fields shared by all outbound (output) messages.
 */
export const calBaseOutputMessageSchema = z.object({
  conversationId: z.string().describe('Unique identifier of the conversation'),
  correlationId: z.string().optional().describe('Echoed from the originating input message, when applicable'),
});

// Input message schemas

/**
 * Requests that a new conversation is started for the given user and stage.
 */
export const calStartConversationRequestSchema = calBaseInputMessageSchema.omit({ conversationId: true }).extend({
  type: z.literal('start_conversation'),
  userId: z.string().describe('Identifier of the user initiating the conversation'),
  agentId: z.string().optional().describe('Optional agent identifier to use for the conversation'),
  stageId: z.string().optional().describe('Stage ID to initiate the conversation at a specific stage. When omitted, falls back to the project-level default starting stage.'),
  timezone: z.string().optional().describe('IANA timezone identifier for this conversation (e.g. America/New_York, Europe/Warsaw). Overrides user profile and project timezone settings. Defaults to UTC when not provided by any source.'),
  direction: z.enum(['incoming', 'outgoing']).optional().describe('Direction of the conversation. Defaults to incoming when not specified.'),
  existingConversationId: z.string().optional().describe('When set, the handler attaches to this pre-created conversation instead of creating a new one. Used for outgoing call flows where the conversation record is created at call initiation time.'),
  userProfile: z.record(z.string(), z.unknown()).optional().describe('Optional user profile data to inject and deep-merge into the user\'s existing profile on the users table.'),
  stageVariables: z.record(z.string(), z.unknown()).optional().describe('Optional initial stage variable values to set for the starting stage when the conversation is created. Merged into stageVars for the resolved starting stage.'),
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
  inputTurnId: z.string().describe('Identifier of the input turn to close, as returned by the corresponding result message'),
});

/**
 * Delivers a text message from the user into the conversation.
 */
export const calSendUserTextInputRequestSchema = calBaseInputMessageSchema.extend({
  type: z.literal('send_user_text_input'),
  text: z.string().describe('Text content submitted by the user'),
});

/**
 * Instructs the conversation engine to navigate to a specific stage.
 */
export const calGoToStageRequestSchema = calBaseInputMessageSchema.extend({
  type: z.literal('go_to_stage'),
  stageId: z.string().describe('Identifier of the target stage'),
});

/**
 * Sets a single variable on a specific stage.
 */
export const calSetVarRequestSchema = calBaseInputMessageSchema.extend({
  type: z.literal('set_var'),
  stageId: z.string().describe('Identifier of the stage that owns the variable'),
  variableName: z.string().describe('Name of the variable to set'),
  variableValue: parameterValueSchema.describe('Value to set for the variable (can be string, number, boolean, object, or array)'),
});

/**
 * Retrieves a single variable from a specific stage.
 */
export const calGetVarRequestSchema = calBaseInputMessageSchema.extend({
  type: z.literal('get_var'),
  stageId: z.string().describe('Identifier of the stage that owns the variable'),
  variableName: z.string().describe('Name of the variable to retrieve'),
});

/**
 * Retrieves all variables for a specific stage.
 */
export const calGetAllVarsRequestSchema = calBaseInputMessageSchema.extend({
  type: z.literal('get_all_vars'),
  stageId: z.string().describe('Identifier of the stage whose variables should be retrieved'),
});

/**
 * Triggers execution of a named global action with the supplied parameter values.
 */
export const calRunActionRequestSchema = calBaseInputMessageSchema.extend({
  type: z.literal('run_action'),
  actionName: z.string().describe('Name of the global action to execute'),
  parameters: z.record(z.string(), parameterValueSchema).describe('Map of parameter names to their values'),
});

/**
 * Requests execution of a tool by its identifier with the supplied parameter values.
 */
export const calCallToolRequestSchema = calBaseInputMessageSchema.extend({
  type: z.literal('call_tool'),
  toolId: z.string().describe('Unique identifier of the tool to execute'),
  parameters: z.record(z.string(), parameterValueSchema).describe('Map of parameter names to their values'),
});

/**
 * Signals that the client wishes to abort (barge-in on) an ongoing AI generation.
 * Sent when the user starts speaking while the agent is mid-response during a voice conversation.
 */
export const calAbortAiGenerationRequestSchema = calBaseInputMessageSchema.extend({
  type: z.literal('abort_ai_generation'),
  stageId: z.string().describe('Identifier of the stage whose generation should be aborted'),
});

/**
 * Signals that the client has finished playing back the AI's audio output.
 * Used to trigger the silence timer after the user has fully heard the response.
 */
export const calAudioPlaybackEndedRequestSchema = calBaseInputMessageSchema.extend({
  type: z.literal('audio_playback_ended'),
  outputTurnId: z.string().optional().describe('Identifier of the output turn whose playback has completed'),
});

/**
 * Result of an abort_ai_generation command.
 */
export const calAbortAiGenerationResponseSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('abort_ai_generation'),
  success: z.boolean().describe('Whether the AI generation was successfully aborted'),
  error: z.string().optional().describe('Error message if abort failed'),
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
  calAbortAiGenerationRequestSchema,
  calAudioPlaybackEndedRequestSchema,
]);

// Output result message schemas

/**
 * Result of a start_conversation command.
 */
export const calStartConversationResponseSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('start_conversation'),
  success: z.boolean().describe('Whether conversation was successfully started'),
  error: z.string().optional().describe('Error message if conversation creation failed'),
});

/**
 * Result of a resume_conversation command.
 */
export const calResumeConversationResponseSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('resume_conversation'),
  success: z.boolean().describe('Whether conversation was successfully resumed'),
  error: z.string().optional().describe('Error message if conversation resumption failed'),
});

/**
 * Result of an end_conversation command.
 */
export const calEndConversationResponseSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('end_conversation'),
  success: z.boolean().describe('Whether conversation was successfully ended'),
  error: z.string().optional().describe('Error message if conversation termination failed'),
});

/**
 * Result of a start_user_voice_input command.
 * On success, inputTurnId must be supplied to subsequent voice chunks and the end_user_voice_input message.
 */
export const calStartUserVoiceInputResponseSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('start_user_voice_input'),
  success: z.boolean().describe('Whether voice input was successfully started'),
  inputTurnId: z.string().optional().describe('Identifier for the new voice input turn. Present when success is true'),
  error: z.string().optional().describe('Error message if voice input start failed'),
});

/**
 * Result of an end_user_voice_input command.
 */
export const calEndUserVoiceInputResponseSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('end_user_voice_input'),
  success: z.boolean().describe('Whether voice input was successfully ended'),
  inputTurnId: z.string().describe('Identifier of the voice input turn that was closed'),
  error: z.string().optional().describe('Error message if voice input ending failed'),
});

/**
 * Result of a send_user_text_input command.
 * inputTurnId identifies the turn created for this text input and can be used to correlate
 * the resulting conversation events.
 */
export const calSendUserTextInputResponseSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('send_user_text_input'),
  success: z.boolean().describe('Whether text input was successfully received'),
  inputTurnId: z.string().describe('Identifier of the input turn created for this text submission, can be used to correlate with conversation events'),
  error: z.string().optional().describe('Error message if text input processing failed'),
});

/**
 * Result of a go_to_stage command.
 */
export const calGoToStageResponseSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('go_to_stage'),
  success: z.boolean().describe('Whether navigation to the stage was successful'),
  error: z.string().optional().describe('Error message if navigation failed'),
});

/**
 * Result of a set_var command.
 */
export const calSetVarResponseSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('set_var'),
  success: z.boolean().describe('Whether the variable was successfully set'),
  error: z.string().optional().describe('Error message if setting the variable failed'),
});

/**
 * Result of a get_var command.
 */
export const calGetVarResponseSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('get_var'),
  success: z.boolean().describe('Whether the variable was successfully retrieved'),
  variableName: z.string().describe('Name of the retrieved variable'),
  variableValue: parameterValueSchema.optional().describe('Value of the variable (absent when not found or success is false)'),
  error: z.string().optional().describe('Error message if retrieving the variable failed'),
});

/**
 * Result of a get_all_vars command.
 */
export const calGetAllVarsResponseSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('get_all_vars'),
  success: z.boolean().describe('Whether the variables were successfully retrieved'),
  variables: z.record(z.string(), parameterValueSchema).describe('Map of variable names to their values'),
  error: z.string().optional().describe('Error message if retrieving variables failed'),
});

/**
 * Result of a run_action command.
 */
export const calRunActionResponseSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('run_action'),
  success: z.boolean().describe('Whether the action was successfully executed'),
  result: z.array(llmContentSchema).optional().describe('Result returned by the action as array of multi-modal content blocks (text, image, or audio)'),
  error: z.string().optional().describe('Error message if action execution failed'),
});

/**
 * Result of a call_tool command.
 */
export const calCallToolResponseSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('call_tool'),
  success: z.boolean().describe('Whether the tool was successfully executed'),
  result: z.array(llmContentSchema).optional().describe('Result returned by the tool execution as array of multi-modal content blocks (text, image, or audio)'),
  error: z.string().optional().describe('Error message if tool execution failed'),
});

// Output push message schemas — AI generation

/**
 * Signals the beginning of an AI response generation turn.
 * Sent before any voice chunks or transcription chunks are emitted.
 */
export const calStartAiGenerationOutputMessageSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('start_ai_generation_output'),
  outputTurnId: z.string().describe('Unique identifier for this generation turn; used to correlate all subsequent output messages'),
  expectVoice: z.boolean().describe('Whether the response will include synthesised voice audio'),
  flushBuffer: z.boolean().optional().describe('Whether the channel adapter should flush any buffered audio from a previous turn before delivering this turn. Set to false for filler delivery on non-barge-in turns to avoid unnecessary silence.'),
});

/**
 * Carries a single chunk of AI-synthesised speech audio.
 * Chunks arrive in order and the final chunk is marked by isFinal.
 */
export const calSendAiVoiceChunkMessageSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('send_ai_voice_chunk'),
  outputTurnId: z.string().describe('Generation turn this chunk belongs to'),
  audioData: z.instanceof(Buffer).describe('Raw audio data (encoding is the channel adapter\'s responsibility)'),
  audioFormat: audioFormatSchema.describe('Encoding of audioData'),
  chunkId: z.string().describe('Unique identifier for this specific chunk'),
  ordinal: z.number().describe('Sequential 0-based position within the output turn\'s audio stream'),
  isFinal: z.boolean().describe('Whether this is the final audio chunk for this output turn'),
  sampleRate: z.number().optional().describe('Sample rate in Hz (e.g. 24000)'),
  bitRate: z.number().optional().describe('Bit rate in bits per second (e.g. 64000)'),
});

/**
 * Signals that the AI generation was aborted due to user barge-in (voice interruption).
 * Sent by the server when it receives a voice interruption during agent speech synthesis.
 */
export const calAbortAiGenerationOutputMessageSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('abort_ai_generation_output'),
  outputTurnId: z.string().describe('Generation turn that was aborted'),
  accumulatedText: z.string().describe('Full text generated and sent to TTS before the barge-in occurred'),
  abortTimestampMs: z.number().describe('Unix timestamp in milliseconds when the generation was aborted'),
});

/**
 * Signals that the AI generation turn has completed.
 */
export const calEndAiGenerationOutputMessageSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('end_ai_generation_output'),
  outputTurnId: z.string().describe('Generation turn that has ended'),
  fullText: z.string().describe('Full text that was synthesised to speech (or generated, when voice is disabled)'),
});

/**
 * Carries an interim or final text transcription chunk of the AI's speech output.
 */
export const calAiTranscribedChunkMessageSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('ai_transcribed_chunk'),
  outputTurnId: z.string().describe('Generation turn this chunk belongs to'),
  chunkId: z.string().describe('Unique identifier for this chunk'),
  chunkText: z.string().describe('Transcribed text content'),
  ordinal: z.number().describe('Sequential 0-based position within the transcription stream'),
  isFinal: z.boolean().describe('Whether this is the final transcription chunk for this output turn'),
});

/**
 * Signals that VAD detected the user started speaking while AI was generating a response.
 * Sent immediately so the UI can stop AI audio playback and switch to listening state.
 */
export const calUserSpeakingStartedMessageSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('user_speaking_started'),
  inputTurnId: z.string().describe('Input turn that was assigned for this user utterance'),
});

// Output push message schemas — user transcription

/**
 * Carries an interim or final ASR transcription chunk of the user's speech input.
 */
export const calUserTranscribedChunkMessageSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('user_transcribed_chunk'),
  inputTurnId: z.string().describe('Input turn this transcription chunk belongs to'),
  chunkId: z.string().describe('Unique identifier for this chunk'),
  chunkText: z.string().describe('Transcribed text content'),
  ordinal: z.number().describe('Sequential 0-based position within the transcription stream'),
  isFinal: z.boolean().describe('True once ASR has finalised its transcript for this chunk'),
});

// Output push message schemas — multi-modal AI output

/**
 * Carries an AI-generated image block.
 */
export const calSendAiImageOutputMessageSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('send_ai_image_output'),
  outputTurnId: z.string().describe('Generation turn this image belongs to'),
  imageData: z.instanceof(Buffer).describe('Raw image data (encoding is the channel adapter\'s responsibility)'),
  mimeType: z.string().describe('MIME type of imageData (e.g. image/png, image/jpeg)'),
  sequenceNumber: z.number().describe('0-based index when multiple images are produced in a single response'),
});

/**
 * Carries a non-TTS AI-generated audio block (e.g. a sound effect or audio file).
 */
export const calSendAiAudioOutputMessageSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('send_ai_audio_output'),
  outputTurnId: z.string().describe('Generation turn this audio belongs to'),
  audioData: z.instanceof(Buffer).describe('Raw audio data (encoding is the channel adapter\'s responsibility)'),
  audioFormat: audioFormatSchema.describe('Encoding of audioData'),
  mimeType: z.string().describe('MIME type of audioData (e.g. audio/mpeg, audio/wav)'),
  sequenceNumber: z.number().describe('0-based index when multiple audio blocks are produced in a single response'),
  metadata: z.object({
    sampleRate: z.number().optional().describe('Sample rate in Hz'),
    channels: z.number().optional().describe('Number of audio channels'),
    bitDepth: z.number().optional().describe('Bit depth per sample'),
  }).optional().describe('Optional low-level audio metadata'),
});

// Output push message schemas — conversation events

/**
 * Broadcasts a conversation lifecycle or activity event to the channel.
 * Mirrors the conversation_event WebSocket message but without session/transport fields.
 */
export const calConversationEventMessageSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('conversation_event'),
  inputTurnId: z.string().optional().describe('Identifier of the input turn associated with this event, when applicable'),
  outputTurnId: z.string().optional().describe('Identifier of the output turn associated with this event, when applicable'),
  eventType: conversationEventTypeSchema.describe('Type of the conversation event'),
  eventData: conversationEventDataSchema.describe('Data associated with the conversation event'),
});

/**
 * Broadcasts an update to a previously emitted conversation event.
 * Mirrors the conversation_event_update WebSocket message but without session/transport fields.
 */
export const calConversationEventUpdateMessageSchema = calBaseOutputMessageSchema.extend({
  type: z.literal('conversation_event_update'),
  inputTurnId: z.string().optional().describe('Identifier of the input turn associated with this event, when applicable'),
  outputTurnId: z.string().optional().describe('Identifier of the output turn associated with this event, when applicable'),
  eventType: conversationEventTypeSchema.describe('Type of the conversation event'),
  eventData: conversationEventDataSchema.describe('Updated data for the conversation event'),
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
  calAbortAiGenerationResponseSchema,
  calStartAiGenerationOutputMessageSchema,
  calSendAiVoiceChunkMessageSchema,
  calAbortAiGenerationOutputMessageSchema,
  calEndAiGenerationOutputMessageSchema,
  calAiTranscribedChunkMessageSchema,
  calUserSpeakingStartedMessageSchema,
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
export type CALAbortAiGenerationRequest = z.infer<typeof calAbortAiGenerationRequestSchema>;
export type CALAudioPlaybackEndedRequest = z.infer<typeof calAudioPlaybackEndedRequestSchema>;
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
export type CALAbortAiGenerationResponse = z.infer<typeof calAbortAiGenerationResponseSchema>;

export type CALStartAiGenerationOutputMessage = z.infer<typeof calStartAiGenerationOutputMessageSchema>;
export type CALSendAiVoiceChunkMessage = z.infer<typeof calSendAiVoiceChunkMessageSchema>;
export type CALAbortAiGenerationOutputMessage = z.infer<typeof calAbortAiGenerationOutputMessageSchema>;
export type CALEndAiGenerationOutputMessage = z.infer<typeof calEndAiGenerationOutputMessageSchema>;
export type CALAiTranscribedChunkMessage = z.infer<typeof calAiTranscribedChunkMessageSchema>;
export type CALUserSpeakingStartedMessage = z.infer<typeof calUserSpeakingStartedMessageSchema>;
export type CALUserTranscribedChunkMessage = z.infer<typeof calUserTranscribedChunkMessageSchema>;
export type CALSendAiImageOutputMessage = z.infer<typeof calSendAiImageOutputMessageSchema>;
export type CALSendAiAudioOutputMessage = z.infer<typeof calSendAiAudioOutputMessageSchema>;
export type CALConversationEventMessage = z.infer<typeof calConversationEventMessageSchema>;
export type CALConversationEventUpdateMessage = z.infer<typeof calConversationEventUpdateMessageSchema>;
export type CALOutputMessage = z.infer<typeof calOutputMessageSchema>;
