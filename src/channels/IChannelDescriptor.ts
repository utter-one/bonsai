import z from "zod";
import { AudioFormat } from "../types/audio";
import { ApiKeyChannel } from "../apiKeyFeatures";

export type ChannelCapabilities = {
  /**
   * Whether the channel supports voice input (e.g. receiving audio from the user).
   */
  supportsVoiceInput: boolean;

  /**
   * Whether the channel supports text input (e.g. receiving text messages from the user).
   */
  supportsTextInput: boolean;

  /**
   * Whether the channel supports voice output (e.g. sending audio messages to the user).
   */
  supportsVoiceOutput: boolean;

  /**
   * Whether the channel supports text output (e.g. sending text messages to the user).
   */
  supportsTextOutput: boolean;

  /**
   * Whether the channel supports commands (e.g. executing actions sent by clients).
   */
  supportsCommands: boolean;

  /**
   * Whether the channel supports events (e.g. receiving event notifications by clients).
   */
  supportsEvents: boolean;

  /**
   * Whether the channel can accept user-initiated sessions (e.g. a client opening a WebSocket connection or a user calling a Twilio number).
   */
  supportsIncomingConnections: boolean;

  /**
   * Whether the channel can initiate sessions to users (e.g. placing an outbound Twilio call or sending a proactive SMS).
   */
  supportsOutgoingConnections: boolean;

  /**
   * Optional array of supported audio formats for voice input/output, e.g. ['pcm', 'wav', 'ogg']. Must be specified for voice channels.
   */
  supportedAudioFormats?: AudioFormat[];
}

/**
 * Interface that all communication channel implementations must adhere to.
 */
export interface ICommunicationChannel {
  /** Unique identifier for the channel type, e.g. 'websocket' or 'webrtc'. */
  getType(): ApiKeyChannel;

  /** Human-friendly name for the channel type, e.g. 'WebSocket' or 'WebRTC'. */
  getName(): string;

  /** Gets the Zod schema for validating the channel configuration. */
  getConfigSchema(): z.ZodObject<any>;

  /** Returns the channel capabilities */
  getCapabilities(): ChannelCapabilities;
}