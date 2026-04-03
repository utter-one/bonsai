import z from "zod";
import { AudioFormat } from "../types/audio";
import { ApiKeyChannel } from "../apiKeyFeatures";

export type ChannelCaps = {
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
   * Optional array of supported audio formats for voice input/output, e.g. ['pcm', 'wav', 'ogg']. Must be specified for voice channels.
   */
  supportedAudioFormats?: AudioFormat[];
}

/**
 * Interface that all communication skill implementations must adhere to.
 */
export interface ICommunicationSkill {
  /** Unique identifier for the channel type, e.g. 'websocket' or 'webrtc'. */
  getType(): ApiKeyChannel;

  /** Human-friendly name for the channel type, e.g. 'WebSocket' or 'WebRTC'. */
  getName(): string;

  /** Gets the Zod schema for validating the channel configuration. */
  getConfigSchema(): z.ZodObject<any>;

  /** Returns the channel capabilities */
  getCapabilities(): ChannelCaps;
}