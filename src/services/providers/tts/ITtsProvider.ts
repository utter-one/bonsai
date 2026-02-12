import type { AudioFormat } from '../../../types/audio';
import type { SimpleCallback, ErrorCallback } from '../../../types/callbacks';

/**
 * Callback function that is invoked when the TTS provider generates audio chunks.
 * This is called for each audio chunk as it becomes available during speech synthesis.
 * @param chunk The generated audio chunk with metadata
 * @returns Promise that resolves when the chunk has been processed
 */
export type SpeechGenerationCallback = (chunk: GeneratedAudioChunk) => Promise<void>;

/**
 * Represents a chunk of generated audio from text-to-speech synthesis
 */
export type GeneratedAudioChunk = {
  /** Unique identifier for this audio chunk */
  chunkId: string;
  /** Sequential order of this chunk in the overall speech generation */
  ordinal: number;
  /** Binary audio data buffer containing the synthesized speech */
  audio: Buffer;
  /** Audio format for this chunk */
  format: AudioFormat;
  /** Original text that was converted to speech for this chunk (not all TTS providers provide this) */
  text?: string;
  /** Duration of this audio chunk in milliseconds (may be undefined if not provided by the TTS provider) */
  durationMs?: number;
  /** Start time offset of this chunk within the complete speech in milliseconds (may be undefined if not provided by the TTS provider) */
  startMs?: number;
  /** End time offset of this chunk within the complete speech in milliseconds (may be undefined if not provided by the TTS provider) */
  endMs?: number;
  /** Whether this is the final chunk in the speech generation sequence */
  isFinal: boolean;
};

/**
 * Represents markers used to identify sections of text that should not be spoken
 * Useful for excluding stage directions, metadata, or other non-speech content
 */
export type NoSpeechMarker = {
  /** Text marker that indicates the start of a no-speech section */
  start: string;
  /** Text marker that indicates the end of a no-speech section */
  end: string;
};

/**
 * Interface for Text-to-Speech (TTS) providers
 * Enables real-time streaming of text to speech synthesis services
 * and provides callbacks for receiving generated audio chunks as they become available
 */
export interface ITtsProvider {
  /**
   * Gets the list of supported audio output formats for this provider
   * @returns Array of supported audio format identifiers
   */
  getSupportedFormats(): AudioFormat[];

  /**
   * Initializes the speech generation session
   * Prepares the TTS provider for text-to-speech synthesis
   * @returns Promise that resolves when initialization is complete
   */
  init(): Promise<void>;

  /**
   * Starts the speech generation session for the given context
   * Prepares the TTS provider to receive text input and generate audio output
   * @returns Promise that resolves when the generation session is successfully started
   */
  start(): Promise<void>;

  /**
   * Stops and finalizes the speech generation session for the given context
   * Ensures all pending audio generation is completed and resources are cleaned up
   * @returns Promise that resolves when the generation session is successfully ended
   */
  end(): Promise<void>;

  /**
   * Sends text to the speech generation service for real-time speech synthesis
   * The text will be converted to audio and delivered via the registered callbacks
   * @param text The text content to be converted to speech
   * @returns Promise that resolves when text has been successfully submitted for generation
   */
  sendText(text: string): Promise<void>;

  /**
   * Registers a callback for when speech generation begins
   * This is called at the start of the synthesis process, before any audio chunks are generated
   * @param cb Callback function that is invoked when generation starts
   */
  setOnGenerationStarted(cb: SimpleCallback): void;

  /**
   * Registers a callback for when speech generation is completed
   * This is called after all audio chunks have been generated and the synthesis is finished
   * @param cb Callback function that is invoked when generation ends
   */
  setOnGenerationEnded(cb: SimpleCallback): void;

  /**
   * Registers a callback for handling speech generation errors
   * This is called when an error occurs during the text-to-speech process
   * @param cb Callback function that receives the error and handles it appropriately
   */
  setOnError(cb: ErrorCallback): void;

  /**
   * Registers a callback for receiving generated audio chunks
   * This is called for each audio chunk as it becomes available during synthesis
   * Chunks are delivered in sequential order and can be played or processed immediately
   * @param cb Callback function that receives and processes each generated audio chunk
   */
  setOnSpeechGenerating(cb: SpeechGenerationCallback): void;
}
