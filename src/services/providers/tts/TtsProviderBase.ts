import { logger } from '../../../utils/logger';
import type { Conversation } from '../../../types/models';
import type { SimpleCallback, ErrorCallback } from '../../../types/callbacks';
import { GeneratedAudioChunk, ITtsProvider, SpeechGenerationCallback, TtsServiceErrorCallback } from './ITtsProvider';

/**
 * Abstract base class for TTS provider implementations
 * Provides common functionality and callback management for text-to-speech providers
 * @template TConfig The type of provider-specific configuration
 */
export abstract class TtsProviderBase<TConfig = Record<string, any>> implements ITtsProvider {
  /** Current conversation being processed */
  protected currentConversation: Conversation | null = null;

  /** Current voice ID being used */
  protected currentVoiceId: string | null = null;

  /** Current speech speed being used */
  protected currentSpeed: number = 1.0;

  /** Counter for generating sequential ordinals for audio chunks */
  protected chunkOrdinal: number = 0;

  /** Callback for generation started event */
  protected onGenerationStartedCallback?: SimpleCallback;

  /** Callback for generation ended event */
  protected onGenerationEndedCallback?: SimpleCallback;

  /** Callback for fatal errors */
  protected onErrorCallback?: ErrorCallback;

  /** Callback for generated audio chunks */
  protected onSpeechGeneratingCallback?: SpeechGenerationCallback;

  /** Callback for service errors */
  protected onServiceErrorCallback?: TtsServiceErrorCallback;

  /** Provider-specific configuration */
  protected config: TConfig;

  /**
   * Creates a new TTS provider base instance
   * @param config Provider-specific configuration
   */
  constructor(config: TConfig) {
    this.config = config;
  }

  /**
   * Initializes and starts the speech generation session
   * Subclasses must implement this method to start provider-specific generation
   * @param conversation The conversation data containing context and configuration
   * @param voiceId Optional voice ID to override the default voice
   * @param speed Optional speech speed to override the default speed
   */
  abstract start(conversation: Conversation, voiceId?: string | null, speed?: number | null): Promise<void>;

  /**
   * Stops and finalizes the speech generation session
   * Subclasses must implement this method to stop provider-specific generation
   * @param conversation The conversation data for which to stop generation
   */
  abstract end(conversation: Conversation): Promise<void>;

  /**
   * Sends text to the speech generation service
   * Subclasses must implement this method to send text to the provider
   * @param conversation The conversation context for the text-to-speech conversion
   * @param text The text content to be converted to speech
   */
  abstract sendText(conversation: Conversation, text: string): Promise<void>;

  /**
   * Registers a callback for when speech generation begins
   * @param cb Callback function that is invoked when generation starts
   */
  setOnGenerationStarted(cb: SimpleCallback): void {
    this.onGenerationStartedCallback = cb;
  }

  /**
   * Registers a callback for when speech generation is completed
   * @param cb Callback function that is invoked when generation ends
   */
  setOnGenerationEnded(cb: SimpleCallback): void {
    this.onGenerationEndedCallback = cb;
  }

  /**
   * Registers a callback for handling speech generation errors
   * @param cb Callback function that receives the error
   */
  setOnError(cb: ErrorCallback): void {
    this.onErrorCallback = cb;
  }

  /**
   * Registers a callback for receiving generated audio chunks
   * @param cb Callback function that receives and processes each generated audio chunk
   */
  setOnSpeechGenerating(cb: SpeechGenerationCallback): void {
    this.onSpeechGeneratingCallback = cb;
  }

  /**
   * Registers a callback for handling service errors
   * @param cb Callback function that receives conversation ID and error message
   */
  setOnServiceError(cb: TtsServiceErrorCallback): void {
    this.onServiceErrorCallback = cb;
  }

  /**
   * Helper method to handle generation started events
   * Called by subclasses when speech generation begins
   */
  protected handleGenerationStarted(): void {
    logger.info(`TTS generation started for conversation ${this.currentConversation?.id}`);
    if (this.onGenerationStartedCallback) {
      this.onGenerationStartedCallback();
    }
  }

  /**
   * Helper method to handle generation ended events
   * Called by subclasses when speech generation is completed
   */
  protected handleGenerationEnded(): void {
    logger.info(`TTS generation ended for conversation ${this.currentConversation?.id}`);
    if (this.onGenerationEndedCallback) {
      this.onGenerationEndedCallback();
    }
  }

  /**
   * Helper method to handle fatal errors
   * Called by subclasses when an unrecoverable error occurs
   * @param error Error object or error message
   */
  protected async handleError(error: Error | string): Promise<void> {
    const errorObj = typeof error === 'string' ? new Error(error) : error;
    logger.error(`TTS error for conversation ${this.currentConversation?.id}: ${errorObj.message}`);
    if (this.onErrorCallback) {
      await this.onErrorCallback(errorObj);
    }
  }

  /**
   * Helper method to handle speech generating events
   * Called by subclasses when audio chunks are generated
   * @param chunk The generated audio chunk
   */
  protected async handleSpeechGenerating(chunk: GeneratedAudioChunk): Promise<void> {
    logger.debug(`TTS generating for conversation ${this.currentConversation?.id}: chunkId=${chunk.chunkId}, ordinal=${chunk.ordinal}, isFinal=${chunk.isFinal}`);
    if (this.onSpeechGeneratingCallback) {
      await this.onSpeechGeneratingCallback(chunk);
    }
  }

  /**
   * Helper method to handle service errors that should be sent to the client
   * Called by subclasses when a service-level error occurs
   * @param errorMessage Human-readable error description
   */
  protected async handleServiceError(errorMessage: string): Promise<void> {
    const conversationId = this.currentConversation?.id || 'unknown';
    logger.error(`TTS service error for conversation ${conversationId}: ${errorMessage}`);
    if (this.onServiceErrorCallback) {
      await this.onServiceErrorCallback(conversationId, errorMessage);
    }
  }

  /**
   * Generates a unique chunk ID for audio generation
   * @returns A unique identifier string
   */
  protected generateChunkId(): string {
    return `chunk_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Gets the next ordinal number for audio chunks
   * @returns Sequential ordinal number
   */
  protected getNextOrdinal(): number {
    return this.chunkOrdinal++;
  }

  /**
   * Resets the chunk ordinal counter
   * Should be called when starting a new generation session
   */
  protected resetOrdinal(): void {
    this.chunkOrdinal = 0;
  }

  /**
   * Cleans up resources when the provider is no longer needed
   * Subclasses can override this to perform provider-specific cleanup
   */
  async cleanup(): Promise<void> {
    logger.info(`Cleaning up TTS provider for conversation ${this.currentConversation?.id}`);
    this.currentConversation = null;
    this.currentVoiceId = null;
    this.currentSpeed = 1.0;
    this.chunkOrdinal = 0;
    this.onGenerationStartedCallback = undefined;
    this.onGenerationEndedCallback = undefined;
    this.onErrorCallback = undefined;
    this.onSpeechGeneratingCallback = undefined;
    this.onServiceErrorCallback = undefined;
  }
}
