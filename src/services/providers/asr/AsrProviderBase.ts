import { logger } from '../../../utils/logger';
import type { Conversation } from '../../../types/models';
import type { ErrorCallback } from '../../../types/callbacks';
import { AsrServiceErrorCallback, IAsrProvider, TextChunk, TextRecognitionCallback } from './IAsrProvider';

/**
 * Abstract base class for ASR provider implementations
 * Provides common functionality and callback management for speech recognition providers
 * @template TConfig The type of provider-specific configuration
 */
export abstract class AsrProviderBase<TConfig = Record<string, any>> implements IAsrProvider {
  /** Current conversation being processed */
  protected currentConversation: Conversation | null = null;

  /** Storage for recognized text chunks */
  protected textChunks: TextChunk[] = [];

  /** Callback for partial recognition results */
  protected onRecognizingCallback?: TextRecognitionCallback;

  /** Callback for finalized recognition results */
  protected onRecognizedCallback?: TextRecognitionCallback;

  /** Callback for recognition stopped event */
  protected onRecognitionStoppedCallback?: () => void;

  /** Callback for fatal errors */
  protected onErrorCallback?: ErrorCallback;

  /** Callback for service errors */
  protected onServiceErrorCallback?: AsrServiceErrorCallback;

  /** Provider-specific configuration */
  protected config: TConfig;

  /**
   * Creates a new ASR provider base instance
   * @param config Provider-specific configuration
   */
  constructor(config: TConfig) {
    this.config = config;
  }

  /**
   * Initializes the speech recognition session
   * Subclasses should override this to perform provider-specific initialization
   * @param conversation The conversation data containing context and configuration
   */
  async init(conversation: Conversation): Promise<void> {
    logger.info(`Initializing ASR provider for conversation ${conversation.id}`);
    this.currentConversation = conversation;
    this.textChunks = [];
  }

  /**
   * Starts the speech recognition session
   * Subclasses must implement this method to start provider-specific recognition
   * @param conversation The conversation data containing context and configuration
   */
  abstract start(conversation: Conversation): Promise<void>;

  /**
   * Stops the speech recognition session
   * Subclasses must implement this method to stop provider-specific recognition
   * @param conversation The conversation data for which to stop recognition
   */
  abstract stop(conversation: Conversation): Promise<void>;

  /**
   * Sends audio data to the speech recognition service
   * Subclasses must implement this method to send audio to the provider
   * @param conversation The conversation context for the audio data
   * @param audio Binary audio data buffer to be processed
   */
  abstract sendAudio(conversation: Conversation, audio: Buffer): Promise<void>;

  /**
   * Registers a callback for partial speech recognition results
   * @param cb Callback function that receives chunk ID and partial text
   */
  setOnRecognizing(cb: TextRecognitionCallback): void {
    this.onRecognizingCallback = cb;
  }

  /**
   * Registers a callback for finalized speech recognition results
   * @param cb Callback function that receives chunk ID and final text
   */
  setOnRecognized(cb: TextRecognitionCallback): void {
    this.onRecognizedCallback = cb;
  }

  /**
   * Registers a callback for when the speech recognition session is stopped
   * @param cb Callback function that is invoked when recognition stops
   */
  setOnRecognitionStopped(cb: () => void): void {
    this.onRecognitionStoppedCallback = cb;
  }

  /**
   * Registers a callback for handling fatal recognition errors
   * @param cb Callback function that receives the error
   */
  setOnError(cb: ErrorCallback): void {
    this.onErrorCallback = cb;
  }

  /**
   * Registers a callback for handling service errors
   * @param cb Callback function that receives conversation ID and error message
   */
  setOnServiceError(cb: AsrServiceErrorCallback): void {
    this.onServiceErrorCallback = cb;
  }

  /**
   * Retrieves all text chunks recognized since the last start() call
   * @returns Array of all recognized text chunks with their metadata
   */
  getAllTextChunks(): TextChunk[] {
    return [...this.textChunks];
  }

  /**
   * Helper method to handle recognizing events (partial results)
   * Called by subclasses when partial recognition results are available
   * @param chunkId Unique identifier for the text chunk
   * @param text The partial recognized text
   */
  protected handleRecognizing(chunkId: string, text: string): void {
    logger.debug(`ASR recognizing for conversation ${this.currentConversation?.id}: chunkId=${chunkId}, text="${text}"`);
    if (this.onRecognizingCallback) {
      this.onRecognizingCallback(chunkId, text);
    }
  }

  /**
   * Helper method to handle recognized events (final results)
   * Called by subclasses when final recognition results are available
   * @param chunkId Unique identifier for the text chunk
   * @param text The final recognized text
   */
  protected handleRecognized(chunkId: string, text: string): void {
    logger.info(`ASR recognized for conversation ${this.currentConversation?.id}: chunkId=${chunkId}, text="${text}"`);
    const chunk: TextChunk = { chunkId, text, timestamp: new Date() };
    this.textChunks.push(chunk);
    if (this.onRecognizedCallback) {
      this.onRecognizedCallback(chunkId, text);
    }
  }

  /**
   * Helper method to handle recognition stopped events
   * Called by subclasses when recognition is stopped
   */
  protected handleRecognitionStopped(): void {
    logger.info(`ASR recognition stopped for conversation ${this.currentConversation?.id}`);
    if (this.onRecognitionStoppedCallback) {
      this.onRecognitionStoppedCallback();
    }
  }

  /**
   * Helper method to handle fatal errors
   * Called by subclasses when an unrecoverable error occurs
   * @param error Error object or error message
   */
  protected async handleError(error: Error | string): Promise<void> {
    const errorObj = typeof error === 'string' ? new Error(error) : error;
    logger.error(`ASR error for conversation ${this.currentConversation?.id}: ${errorObj.message}`);
    if (this.onErrorCallback) {
      await this.onErrorCallback(errorObj);
    }
  }

  /**
   * Helper method to handle service errors that should be sent to the client
   * Called by subclasses when a service-level error occurs
   * @param errorMessage Human-readable error description
   */
  protected async handleServiceError(errorMessage: string): Promise<void> {
    const conversationId = this.currentConversation?.id || 'unknown';
    logger.error(`ASR service error for conversation ${conversationId}: ${errorMessage}`);
    if (this.onServiceErrorCallback) {
      await this.onServiceErrorCallback(conversationId, errorMessage);
    }
  }

  /**
   * Generates a unique chunk ID for text recognition
   * @returns A unique identifier string
   */
  protected generateChunkId(): string {
    return `chunk_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Cleans up resources when the provider is no longer needed
   * Subclasses can override this to perform provider-specific cleanup
   */
  async cleanup(): Promise<void> {
    logger.info(`Cleaning up ASR provider for conversation ${this.currentConversation?.id}`);
    this.currentConversation = null;
    this.textChunks = [];
    this.onRecognizingCallback = undefined;
    this.onRecognizedCallback = undefined;
    this.onRecognitionStoppedCallback = undefined;
    this.onErrorCallback = undefined;
    this.onServiceErrorCallback = undefined;
  }
}
