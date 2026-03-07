import type { ErrorCallback } from '../../../types/callbacks';
import type { AudioFormat } from '../../../types/audio';

/**
 * Callback function that is invoked when speech recognition produces text output.
 * This can be for partial recognition results (recognizing) or final results (recognized).
 * @param chunkId Unique identifier for this text chunk
 * @param text The recognized text content
 */
export type TextRecognitionCallback = (chunkId: string, text: string) => void;

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
   * Gets the list of supported audio input formats for this provider
   * @returns Array of supported audio format identifiers
   */
  getSupportedInputFormats(): AudioFormat[];
  /**
   * Initializes the speech recognition session for the given context
   * @returns Promise that resolves when initialization is complete
   */
  init(): Promise<void>;

  /**
   * Starts the speech recognition session for the given context
   * @returns Promise that resolves when recognition session is successfully started
   */
  start(): Promise<void>;

  /**
   * Stops the speech recognition session for the given context
   * @returns Promise that resolves when recognition session is successfully stopped
   */
  stop(): Promise<void>;

  /**
   * Sends audio data to the speech recognition service for processing
   * @param audio Binary audio data buffer to be processed
   * @returns Promise that resolves when audio data is successfully sent
   */
  sendAudio(audio: Buffer, format?: AudioFormat): Promise<void>;

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
   * Registers a callback for when the speech recognition session is started
   * This is called when the ASR provider successfully begins recognition
   * @param cb Callback function that is invoked when recognition starts
   */
  setOnRecognitionStarted(cb: () => void): void;

  /**
   * Registers a callback for handling fatal recognition errors
   * This is called when an unrecoverable error occurs during recognition
   * @param cb Callback function that receives the error
   */
  setOnError(cb: ErrorCallback): void;

  /**
   * Retrieves all text chunks that have been recognized since the last start() call
   * Useful for getting the complete recognition history or for batch processing
   * @returns Array of all recognized text chunks with their metadata
   */
  getAllTextChunks(): TextChunk[];

  /**
   * Releases all resources held by the provider.
   * Must be called when the provider is no longer needed (e.g. on client disconnect).
   */
  cleanup(): Promise<void>;
}
