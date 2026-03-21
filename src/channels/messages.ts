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

import type { ParameterValue } from '../types/parameters';
import type { LlmContent } from '../services/providers/llm/ILlmProvider';
import type { AudioFormat } from '../types/audio';
import type { ConversationEventType, ConversationEventData } from '../types/conversationEvents';


// Base message types

/**
 * Base fields shared by all inbound (input) messages.
 */
export type CALBaseInputMessage = {
  /** Identifies the conversation this message belongs to. */
  conversationId: string;
  /** Optional caller-supplied identifier echoed back in the corresponding result message. */
  correlationId?: string;
};

/**
 * Base fields shared by all outbound (output) messages.
 */
export type CALBaseOutputMessage = {
  /** Identifies the conversation this message belongs to. */
  conversationId: string;
  /** Echoed from the originating input message, when applicable. */
  correlationId?: string;
};

// Input messages

/**
 * Requests that a new conversation is started for the given user and stage.
 */
export type CALStartConversationRequest = CALBaseInputMessage & {
  type: 'start_conversation';
  /** Identifier of the user initiating the conversation. */
  userId: string;
  /** Optional agent to use for the conversation. */
  agentId?: string;
  /** Stage at which the conversation should begin. */
  stageId: string;
  /** IANA timezone identifier (e.g. America/New_York). Defaults to UTC when absent. */
  timezone?: string;
};

/**
 * Requests that a previously paused conversation is resumed.
 */
export type CALResumeConversationRequest = CALBaseInputMessage & {
  type: 'resume_conversation';
};

/**
 * Requests that the active conversation is ended.
 */
export type CALEndConversationRequest = CALBaseInputMessage & {
  type: 'end_conversation';
};

/**
 * Signals that the user has started speaking and the channel should begin buffering voice data.
 * Audio chunks are delivered separately via receiveAudioChunk.
 */
export type CALStartUserVoiceInputRequest = CALBaseInputMessage & {
  type: 'start_user_voice_input';
};

/**
 * Signals that the user has finished speaking and the voice input turn should be finalised.
 */
export type CALEndUserVoiceInputRequest = CALBaseInputMessage & {
  type: 'end_user_voice_input';
  /** Identifier of the input turn to close, as returned by the corresponding result message. */
  inputTurnId: string;
};

/**
 * Delivers a text message from the user into the conversation.
 */
export type CALSendUserTextInputRequest = CALBaseInputMessage & {
  type: 'send_user_text_input';
  /** Text content submitted by the user. */
  text: string;
};

/**
 * Instructs the conversation engine to navigate to a specific stage.
 */
export type CALGoToStageRequest = CALBaseInputMessage & {
  type: 'go_to_stage';
  /** Identifier of the target stage. */
  stageId: string;
};

/**
 * Sets a single variable on a specific stage.
 */
export type CALSetVarRequest = CALBaseInputMessage & {
  type: 'set_var';
  /** Identifier of the stage that owns the variable. */
  stageId: string;
  /** Name of the variable to set. */
  variableName: string;
  /** New value for the variable. */
  variableValue: ParameterValue;
};

/**
 * Retrieves a single variable from a specific stage.
 */
export type CALGetVarRequest = CALBaseInputMessage & {
  type: 'get_var';
  /** Identifier of the stage that owns the variable. */
  stageId: string;
  /** Name of the variable to retrieve. */
  variableName: string;
};

/**
 * Retrieves all variables for a specific stage.
 */
export type CALGetAllVarsRequest = CALBaseInputMessage & {
  type: 'get_all_vars';
  /** Identifier of the stage whose variables should be retrieved. */
  stageId: string;
};

/**
 * Triggers execution of a named global action with the supplied parameter values.
 */
export type CALRunActionRequest = CALBaseInputMessage & {
  type: 'run_action';
  /** Name of the global action to execute. */
  actionName: string;
  /** Parameter values keyed by parameter name. */
  parameters: Record<string, ParameterValue>;
};

/**
 * Requests execution of a tool by its identifier with the supplied parameter values.
 */
export type CALCallToolRequest = CALBaseInputMessage & {
  type: 'call_tool';
  /** Identifier of the tool to execute. */
  toolId: string;
  /** Parameter values keyed by parameter name. */
  parameters: Record<string, ParameterValue>;
};

/**
 * Discriminated union of all inbound message types accepted by a communication channel.
 */
export type CALInputMessage =
  | CALStartConversationRequest
  | CALResumeConversationRequest
  | CALEndConversationRequest
  | CALStartUserVoiceInputRequest
  | CALEndUserVoiceInputRequest
  | CALSendUserTextInputRequest
  | CALGoToStageRequest
  | CALSetVarRequest
  | CALGetVarRequest
  | CALGetAllVarsRequest
  | CALRunActionRequest
  | CALCallToolRequest;

// Output result messages

/**
 * Result of a start_conversation command.
 */
export type CALStartConversationResponse = CALBaseOutputMessage & {
  type: 'start_conversation';
  success: boolean;
  error?: string;
};

/**
 * Result of a resume_conversation command.
 */
export type CALResumeConversationResponse = CALBaseOutputMessage & {
  type: 'resume_conversation';
  success: boolean;
  error?: string;
};

/**
 * Result of an end_conversation command.
 */
export type CALEndConversationResponse = CALBaseOutputMessage & {
  type: 'end_conversation';
  success: boolean;
  error?: string;
};

/**
 * Result of a start_user_voice_input command.
 * On success, inputTurnId must be supplied to subsequent voice chunks and the end_user_voice_input message.
 */
export type CALStartUserVoiceInputResponse = CALBaseOutputMessage & {
  type: 'start_user_voice_input';
  success: boolean;
  /** Identifier for the new voice input turn. Present when success is true. */
  inputTurnId?: string;
  error?: string;
};

/**
 * Result of an end_user_voice_input command.
 */
export type CALEndUserVoiceInputResponse = CALBaseOutputMessage & {
  type: 'end_user_voice_input';
  success: boolean;
  /** Identifier of the voice input turn that was closed. */
  inputTurnId: string;
  error?: string;
};

/**
 * Result of a send_user_text_input command.
 * inputTurnId identifies the turn created for this text input and can be used to correlate
 * the resulting conversation events.
 */
export type CALSendUserTextInputResponse = CALBaseOutputMessage & {
  type: 'send_user_text_input';
  success: boolean;
  /** Identifier of the input turn created for this text submission. */
  inputTurnId: string;
  error?: string;
};

/**
 * Result of a go_to_stage command.
 */
export type CALGoToStageResponse = CALBaseOutputMessage & {
  type: 'go_to_stage';
  success: boolean;
  error?: string;
};

/**
 * Result of a set_var command.
 */
export type CALSetVarResponse = CALBaseOutputMessage & {
  type: 'set_var_result';
  success: boolean;
  error?: string;
};

/**
 * Result of a get_var command.
 */
export type CALGetVarResponse = CALBaseOutputMessage & {
  type: 'get_var';
  success: boolean;
  /** Name of the requested variable, echoed for easy correlation. */
  variableName: string;
  /** Retrieved value. Absent when the variable does not exist or success is false. */
  variableValue?: ParameterValue;
  error?: string;
};

/**
 * Result of a get_all_vars command.
 */
export type CALGetAllVarsResponse = CALBaseOutputMessage & {
  type: 'get_all_vars';
  success: boolean;
  /** All stage variables keyed by name. Empty object when none exist. */
  variables: Record<string, ParameterValue>;
  error?: string;
};

/**
 * Result of a run_action command.
 */
export type CALRunActionResponse = CALBaseOutputMessage & {
  type: 'run_action';
  success: boolean;
  /** Multi-modal content blocks returned by the action. */
  result?: LlmContent[];
  error?: string;
};

/**
 * Result of a call_tool command.
 */
export type CALCallToolResponse = CALBaseOutputMessage & {
  type: 'call_tool';
  success: boolean;
  /** Multi-modal content blocks returned by the tool. */
  result?: LlmContent[];
  error?: string;
};

// Output push messages — AI generation

/**
 * Signals the beginning of an AI response generation turn.
 * Sent before any voice chunks or transcription chunks are emitted.
 */
export type CALStartAiGenerationOutputMessage = CALBaseOutputMessage & {
  type: 'start_ai_generation_output';
  /** Identifier for this generation turn; used to correlate all subsequent output messages. */
  outputTurnId: string;
  /** Whether the response will include synthesised voice audio. */
  expectVoice: boolean;
};

/**
 * Carries a single chunk of AI-synthesised speech audio.
 * Chunks arrive in order and the final chunk is marked by isFinal.
 */
export type CALSendAiVoiceChunkMessage = CALBaseOutputMessage & {
  type: 'send_ai_voice_chunk';
  /** Generation turn this chunk belongs to. */
  outputTurnId: string;
  /** Raw audio data. Encoding is the channel adapter's responsibility. */
  audioData: Buffer;
  /** Encoding of audioData. */
  audioFormat: AudioFormat;
  /** Unique identifier for this specific chunk. */
  chunkId: string;
  /** Sequential 0-based position within the output turn's audio stream. */
  ordinal: number;
  /** Whether this is the final audio chunk for this output turn. */
  isFinal: boolean;
  /** Sample rate in Hz (e.g. 24000). */
  sampleRate?: number;
  /** Bit rate in bits per second (e.g. 64000). */
  bitRate?: number;
};

/**
 * Signals that the AI generation turn has completed.
 */
export type CALEndAiGenerationOutputMessage = CALBaseOutputMessage & {
  type: 'end_ai_generation_output';
  /** Generation turn that has ended. */
  outputTurnId: string;
  /** Full text that was synthesised to speech (or generated, when voice is disabled). */
  fullText: string;
};

/**
 * Carries an interim or final text transcription chunk of the AI's speech output.
 */
export type CALAiTranscribedChunkMessage = CALBaseOutputMessage & {
  type: 'ai_transcribed_chunk';
  /** Generation turn this chunk belongs to. */
  outputTurnId: string;
  /** Unique identifier for this chunk. */
  chunkId: string;
  /** Transcribed text content. */
  chunkText: string;
  /** Sequential 0-based position within the transcription stream. */
  ordinal: number;
  /** Whether this is the final transcription chunk for this output turn. */
  isFinal: boolean;
};

// Output push messages — user transcription

/**
 * Carries an interim or final ASR transcription chunk of the user's speech input.
 */
export type CALUserTranscribedChunkMessage = CALBaseOutputMessage & {
  type: 'user_transcribed_chunk';
  /** Input turn this transcription chunk belongs to. */
  inputTurnId: string;
  /** Unique identifier for this chunk. */
  chunkId: string;
  /** Transcribed text content. */
  chunkText: string;
  /** Sequential 0-based position within the transcription stream. */
  ordinal: number;
  /** true once ASR has finalised its transcript for this chunk. */
  isFinal: boolean;
};

// Output push messages — multi-modal AI output

/**
 * Carries an AI-generated image block.
 */
export type CALSendAiImageOutputMessage = CALBaseOutputMessage & {
  type: 'send_ai_image_output';
  /** Generation turn this image belongs to. */
  outputTurnId: string;
  /** Raw image data. Encoding is the channel adapter's responsibility. */
  imageData: Buffer;
  /** MIME type of imageData (e.g. image/png, image/jpeg). */
  mimeType: string;
  /** 0-based index when multiple images are produced in a single response. */
  sequenceNumber: number;
};

/**
 * Carries a non-TTS AI-generated audio block (e.g. a sound effect or audio file).
 */
export type CALSendAiAudioOutputMessage = CALBaseOutputMessage & {
  type: 'send_ai_audio_output';
  /** Generation turn this audio belongs to. */
  outputTurnId: string;
  /** Raw audio data. Encoding is the channel adapter's responsibility. */
  audioData: Buffer;
  /** Encoding of audioData. */
  audioFormat: AudioFormat;
  /** MIME type of audioData (e.g. audio/mpeg, audio/wav). */
  mimeType: string;
  /** 0-based index when multiple audio blocks are produced in a single response. */
  sequenceNumber: number;
  /** Optional low-level audio metadata. */
  metadata?: {
    /** Sample rate in Hz. */
    sampleRate?: number;
    /** Number of audio channels. */
    channels?: number;
    /** Bit depth per sample. */
    bitDepth?: number;
  };
};

// Output push messages — conversation events

/**
 * Broadcasts a conversation lifecycle or activity event to the channel.
 * Mirrors the conversation_event WebSocket message but without session/transport fields.
 */
export type CALConversationEventMessage = CALBaseOutputMessage & {
  type: 'conversation_event';
  /** Identifier of the input turn associated with this event, when applicable. */
  inputTurnId?: string;
  /** Identifier of the output turn associated with this event, when applicable. */
  outputTurnId?: string;
  /** Discriminator for the event payload. */
  eventType: ConversationEventType;
  /** Structured data describing the event. */
  eventData: ConversationEventData;
};

/**
 * Broadcasts an update to a previously emitted conversation event.
 * Mirrors the conversation_event_update WebSocket message but without session/transport fields.
 */
export type CALConversationEventUpdateMessage = CALBaseOutputMessage & {
  type: 'conversation_event_update';
  /** Identifier of the input turn associated with this event, when applicable. */
  inputTurnId?: string;
  /** Identifier of the output turn associated with this event, when applicable. */
  outputTurnId?: string;
  /** Discriminator for the event payload. */
  eventType: ConversationEventType;
  /** Updated structured data describing the event. */
  eventData: ConversationEventData;
};

// Output union

/**
 * Discriminated union of all outbound message types emitted by a communication channel.
 */
export type CALOutputMessage =
  | CALStartConversationResponse
  | CALResumeConversationResponse
  | CALEndConversationResponse
  | CALStartUserVoiceInputResponse
  | CALEndUserVoiceInputResponse
  | CALSendUserTextInputResponse
  | CALGoToStageResponse
  | CALSetVarResponse
  | CALGetVarResponse
  | CALGetAllVarsResponse
  | CALRunActionResponse
  | CALCallToolResponse
  | CALStartAiGenerationOutputMessage
  | CALSendAiVoiceChunkMessage
  | CALEndAiGenerationOutputMessage
  | CALAiTranscribedChunkMessage
  | CALUserTranscribedChunkMessage
  | CALSendAiImageOutputMessage
  | CALSendAiAudioOutputMessage
  | CALConversationEventMessage
  | CALConversationEventUpdateMessage;
