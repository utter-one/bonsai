import type { Conversation } from '../../../types/models';


/**
 * Callback function that is invoked when speech recognition produces text output.
 * This can be for partial recognition results (recognizing) or final results (recognized).
 * @param chunkId Unique identifier for this text chunk
 * @param text The recognized text content
 */
export type TextRecognitionCallback = (chunkId: string, text: string) => void;

/**
 * Callback function that is invoked when an ASR service error occurs
 * This allows the error to be sent to the client through WebSocket
 * @param sessionId The session where the error occurred
 * @param errorMessage Human-readable error description
 */
export type AsrServiceErrorCallback = (sessionId: string, errorMessage: string) => Promise<void>;

/**
 * Represents a chunk of recognized text from speech recognition
 */
export type TextChunk = {
  /** Unique identifier for this text chunk */
  chunkId: string;
  /** The recognized text content */
  text: string;
  /** Timestamp when the text chunk was recognized */
  timestamp: Date;
};

/**
 * Interface for Automatic Speech Recognition (ASR) providers
 * Enables real-time streaming of audio data to speech recognition services
 * and provides callbacks for receiving recognized text output
 */

export interface IAsrProvider {
  /**
   * Initializes the speech recognition session for the given context
   * @param conversation The conversation data containing context and configuration for recognition
   * @returns Promise that resolves when initialization is complete
   */
  init(conversation: Conversation): Promise<void>;

  /**
   * Starts the speech recognition session for the given context
   * @param conversation The conversation data containing context and configuration for recognition
   * @returns Promise that resolves when recognition session is successfully started
   */
  start(conversation: Conversation): Promise<void>;

  /**
   * Stops the speech recognition session for the given context
   * @param conversation The conversation data for which to stop recognition
   * @returns Promise that resolves when recognition session is successfully stopped
   */
  stop(conversation: Conversation): Promise<void>;

  /**
   * Sends audio data to the speech recognition service for processing
   * @param conversation The conversation context for the audio data
   * @param audio Binary audio data buffer to be processed
   * @returns Promise that resolves when audio data is successfully sent
   */
  sendAudio(conversation: Conversation, audio: Buffer): Promise<void>;

  /**
   * Registers a callback for partial speech recognition results
   * This is called when the ASR provider has preliminary text recognition
   * that may still change as more audio is processed
   * @param cb Callback function that receives chunk ID and partial text
   */
  setOnRecognizing(cb: TextRecognitionCallback): void;

  /**
   * Registers a callback for finalized speech recognition results
   * This is called when the ASR provider has completed processing an utterance
   * and provides the final recognized text
   * @param cb Callback function that receives chunk ID and final text
   */
  setOnRecognized(cb: TextRecognitionCallback): void;

  /**
   * Registers a callback for when the speech recognition session is stopped
   * This can occur due to silence detection, explicit stop call, or other reasons
   * @param cb Callback function that is invoked when recognition stops
   */
  setOnRecognitionStopped(cb: () => void): void;

  /**
   * Registers a callback for handling fatal recognition errors
   * This is called when an unrecoverable error occurs during recognition
   * @param cb Callback function that receives the error description
   */
  setOnError(cb: (error: string) => void): void;

  /**
   * Registers a callback for handling service errors that should be sent to the client
   * This allows providers to communicate service-level errors through the WebSocket
   * @param cb Callback function that receives session ID and error message
   */
  setOnServiceError(cb: AsrServiceErrorCallback): void;

  /**
   * Retrieves all text chunks that have been recognized since the last start() call
   * Useful for getting the complete conversation history or for batch processing
   * @returns Array of all recognized text chunks with their metadata
   */
  getAllTextChunks(): TextChunk[];
}
