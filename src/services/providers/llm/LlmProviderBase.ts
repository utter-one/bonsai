import type { ErrorCallback, SimpleCallback } from '../../../types/callbacks';
import { ILlmProvider, LlmChunkCallback, LlmCompleteCallback, LlmGenerationOptions, LlmGenerationResult, LlmMessage } from './ILlmProvider';
import { logger } from '../../../utils/logger';
import { log } from 'handlebars';
import { LlmModelInfo } from '../ProviderCatalogService';

/**
 * Abstract base class for LLM provider implementations
 * Provides common functionality for callback management, lifecycle, and error handling
 */
export abstract class LlmProviderBase<TConfig> implements ILlmProvider {
  protected config?: TConfig;
  protected initialized: boolean = false;
  protected onChunkCallback?: LlmChunkCallback;
  protected onGenerationCompletedCallback?: LlmCompleteCallback;
  protected onGenerationStartedCallback?: SimpleCallback;
  protected onErrorCallback?: ErrorCallback;

  constructor(config: TConfig) {
    this.config = config;
  }

  /**
   * Initialize the provider with configuration
   * Subclasses should override this and call super.init() first
   */
  async init(): Promise<void> {
    logger.info('Initializing LLM provider...');
    this.initialized = true;
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
  setOnGenerationCompleted(callback: LlmCompleteCallback): void {
    this.onGenerationCompletedCallback = callback;
  }

  /**
   * Set callback for when provider is ready
   */
  setOnGenerationStarted(callback: SimpleCallback): void {
    this.onGenerationStartedCallback = callback;
  }

  /**
   * Set callback for fatal errors
   */
  setOnError(callback: ErrorCallback): void {
    this.onErrorCallback = callback;
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
  protected async notifyStarted(): Promise<void> {
    if (this.onGenerationStartedCallback) {
      try {
        await this.onGenerationStartedCallback();
      } catch (error) {
        logger.error(`Error in generation started callback: ${error}`);
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
    if (this.onGenerationCompletedCallback) {
      try {
        await this.onGenerationCompletedCallback(result);
      } catch (error) {
        logger.error(`Error in generation completed callback: ${error}`);
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
   * Releases all resources held by the provider.
   * Subclasses can override this to perform provider-specific cleanup.
   */
  async cleanup(): Promise<void> {
    this.onChunkCallback = undefined;
    this.onGenerationCompletedCallback = undefined;
    this.onGenerationStartedCallback = undefined;
    this.onErrorCallback = undefined;
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
      maxTokens: options?.maxTokens ?? 1024,
      metadata: options?.metadata,
      outputFormat: options?.outputFormat ?? 'text',
    };
  }

  /**
   * Validate messages before sending to provider
   */
  protected validateMessages(messages: LlmMessage[]): void {
    if (!messages || messages.length === 0) {
      throw new Error('Messages array cannot be empty');
    }

    if (messages[0].role !== 'system') {
      throw new Error('First message must have role "system"');
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

  /**
   * Enumerate available models from the provider, returning an array of model information.
   * Must be implemented by subclasses to return provider-specific model details.
   */
   abstract enumerateModels(): Promise<LlmModelInfo[]>;

    /**
     * Moderate user input for content policy violations. Returns whether the input was flagged and any applicable categories.
     * By default, this method throws an error indicating that moderation is not supported. Subclasses can override this to provide actual moderation functionality if supported by the provider.
     * @param input User input to moderate
     * @returns Object containing flagged status and categories of violation
     */
    async moderateUserInput(input: string): Promise<{ flagged: boolean; categories: string[]; }> {
     throw new Error('Moderation is not supported by this provider');
   }
}
