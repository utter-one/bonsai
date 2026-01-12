import type { ErrorCallback, SimpleCallback } from '../../../types/callbacks';
import { ILlmProvider, LlmChunkCallback, LlmCompleteCallback, LlmGenerationOptions, LlmGenerationResult, LlmMessage, LlmProviderConfig, LlmServiceErrorCallback } from './ILlmProvider';
import { logger } from '../../../utils/logger';

/**
 * Abstract base class for LLM provider implementations
 * Provides common functionality for callback management, lifecycle, and error handling
 */
export abstract class LlmProviderBase<TConfig extends LlmProviderConfig = LlmProviderConfig> implements ILlmProvider<TConfig> {
  protected config?: TConfig;
  protected initialized: boolean = false;
  protected onChunkCallback?: LlmChunkCallback;
  protected onCompleteCallback?: LlmCompleteCallback;
  protected onReadyCallback?: SimpleCallback;
  protected onErrorCallback?: ErrorCallback;
  protected onServiceErrorCallback?: LlmServiceErrorCallback;

  /**
   * Initialize the provider with configuration
   * Subclasses should override this and call super.init() first
   */
  async init(config: TConfig): Promise<void> {
    this.config = config;
    logger.info(`Initializing LLM provider with model: ${config.model}`);
    this.initialized = true;
    await this.notifyReady();
  }

  /**
   * Generate a non-streaming response
   * Must be implemented by subclasses
   */
  abstract generate(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<LlmGenerationResult>;

  /**
   * Generate a streaming response
   * Must be implemented by subclasses
   */
  abstract generateStream(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<void>;

  /**
   * Set callback for streaming chunks
   */
  setOnChunk(callback: LlmChunkCallback): void {
    this.onChunkCallback = callback;
  }

  /**
   * Set callback for generation completion
   */
  setOnComplete(callback: LlmCompleteCallback): void {
    this.onCompleteCallback = callback;
  }

  /**
   * Set callback for when provider is ready
   */
  setOnReady(callback: SimpleCallback): void {
    this.onReadyCallback = callback;
  }

  /**
   * Set callback for fatal errors
   */
  setOnError(callback: ErrorCallback): void {
    this.onErrorCallback = callback;
  }

  /**
   * Set callback for service errors (recoverable)
   */
  setOnServiceError(callback: LlmServiceErrorCallback): void {
    this.onServiceErrorCallback = callback;
  }

  /**
   * Get the current configuration
   */
  getConfig(): TConfig {
    if (!this.config) {
      throw new Error('Provider not initialized - config is undefined');
    }
    return this.config;
  }

  /**
   * Check if provider is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Notify that provider is ready
   */
  protected async notifyReady(): Promise<void> {
    if (this.onReadyCallback) {
      try {
        await this.onReadyCallback();
      } catch (error) {
        logger.error(`Error in ready callback: ${error}`);
      }
    }
  }

  /**
   * Notify about a streaming chunk
   */
  protected async notifyChunk(content: string, id: string, role?: 'assistant', finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null, usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }): Promise<void> {
    if (this.onChunkCallback) {
      try {
        await this.onChunkCallback({ id, content, role, finishReason, usage });
      } catch (error) {
        logger.error(`Error in chunk callback: ${error}`);
      }
    }
  }

  /**
   * Notify about generation completion
   */
  protected async notifyComplete(result: LlmGenerationResult): Promise<void> {
    if (this.onCompleteCallback) {
      try {
        await this.onCompleteCallback(result);
      } catch (error) {
        logger.error(`Error in complete callback: ${error}`);
      }
    }
  }

  /**
   * Notify about a fatal error
   */
  protected async notifyError(error: Error): Promise<void> {
    logger.error(`LLM provider fatal error: ${error.message}`);
    if (this.onErrorCallback) {
      try {
        await this.onErrorCallback(error);
      } catch (callbackError) {
        logger.error(`Error in error callback: ${callbackError}`);
      }
    }
  }

  /**
   * Notify about a service error (recoverable)
   */
  protected async notifyServiceError(errorMessage: string): Promise<void> {
    logger.warn(`LLM provider service error: ${errorMessage}`);
    if (this.onServiceErrorCallback) {
      try {
        await this.onServiceErrorCallback(errorMessage);
      } catch (callbackError) {
        logger.error(`Error in service error callback: ${callbackError}`);
      }
    }
  }

  /**
   * Ensure provider is initialized before operations
   */
  protected ensureInitialized(): void {
    if (!this.initialized || !this.config) {
      throw new Error('Provider must be initialized before use');
    }
  }

  /**
   * Apply default options from config
   */
  protected applyDefaultOptions(options?: LlmGenerationOptions): LlmGenerationOptions {
    return {
      maxTokens: options?.maxTokens ?? this.config?.defaultMaxTokens,
      temperature: options?.temperature ?? this.config?.defaultTemperature ?? 0.7,
      topP: options?.topP ?? this.config?.defaultTopP ?? 1.0,
      stopSequences: options?.stopSequences,
      frequencyPenalty: options?.frequencyPenalty,
      presencePenalty: options?.presencePenalty,
      metadata: options?.metadata,
    };
  }

  /**
   * Validate messages before sending to provider
   */
  protected validateMessages(messages: LlmMessage[]): void {
    if (!messages || messages.length === 0) {
      throw new Error('Messages array cannot be empty');
    }

    for (const message of messages) {
      if (!message.role) {
        throw new Error('Message role is required');
      }
      if (!message.content || (typeof message.content === 'string' && message.content.length === 0) || (Array.isArray(message.content) && message.content.length === 0)) {
        throw new Error('Message content cannot be empty');
      }
    }
  }

  /**
   * Extract text content from message (helper for simple text extraction)
   */
  protected extractTextContent(messages: LlmMessage[]): string {
    return messages.map((msg) => {
      if (typeof msg.content === 'string') {
        return msg.content;
      }
      return msg.content.filter((c) => c.type === 'text').map((c) => (c as any).text).join(' ');
    }).join('\n');
  }
}
