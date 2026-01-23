import type { ErrorCallback, SimpleCallback } from '../../../types/callbacks';

/**
 * Represents the role of a message in a conversation
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * Content type for multi-modal messages
 */
export type MessageContentType = 'text' | 'image' | 'json';

/**
 * Text content block
 */
export interface TextContent {
  type: 'text';
  text: string;
}

/**
 * Image content block with support for URLs or base64 data
 */
export interface ImageContent {
  type: 'image';
  source: {
    type: 'url' | 'base64';
    url?: string;
    data?: string;
    mimeType?: string;
  };
}

/**
 * JSON content block for structured data
 */
export interface JsonContent {
  type: 'json';
  data: Record<string, any>;
}

/**
 * Multi-modal message content
 */
export type MessageContent = TextContent | ImageContent | JsonContent;

/**
 * Message in conversation history
 */
export interface LlmMessage {
  role: MessageRole;
  content: string | MessageContent[];
  name?: string;
  toolCallId?: string;
}

/**
 * Token usage information for generation
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Streaming chunk from LLM provider
 */
export interface LlmChunk {
  id: string;
  content: string;
  role?: MessageRole;
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  usage?: Partial<TokenUsage>;
}

/**
 * Complete generation result
 */
export interface LlmGenerationResult {
  id: string;
  content: string;
  role: MessageRole;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  usage?: TokenUsage;
  metadata?: Record<string, any>;
}

/**
 * Generation options for LLM requests
 */
export interface LlmGenerationOptions {
  /** Maximum number of tokens to generate */
  maxTokens?: number;
  /** Temperature for sampling (0.0 to 2.0, higher = more random) */
  temperature?: number;
  /** Top-p sampling parameter */
  topP?: number;
  /** Stop sequences to end generation */
  stopSequences?: string[];
  /** Frequency penalty (-2.0 to 2.0) */
  frequencyPenalty?: number;
  /** Presence penalty (-2.0 to 2.0) */
  presencePenalty?: number;
  /** Custom metadata to attach to the request */
  metadata?: Record<string, any>;
}

/**
 * Callback for streaming chunks
 */
export type LlmChunkCallback = (chunk: LlmChunk) => Promise<void> | Promise<void>;

/**
 * Callback for complete generation
 */
export type LlmCompleteCallback = (result: LlmGenerationResult) => void | Promise<void>;

/**
 * Base configuration for all LLM providers
 */
export interface LlmProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
  defaultMaxTokens?: number;
  defaultTemperature?: number;
  defaultTopP?: number;
  timeout?: number;
  [key: string]: any;
}

/**
 * Interface for LLM provider implementations
 * Supports both streaming and non-streaming generation with multi-modal messages
 */
export interface ILlmProvider<TConfig extends LlmProviderConfig = LlmProviderConfig> {
  /**
   * Initialize the provider with configuration
   * @param config Provider-specific configuration
   */
  init(config: TConfig): Promise<void>;

  /**
   * Generate a non-streaming response
   * @param messages Message history including multi-modal content
   * @param options Generation options
   * @returns Complete generation result
   */
  generate(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<LlmGenerationResult>;

  /**
   * Generate a streaming response
   * @param messages Message history including multi-modal content
   * @param options Generation options
   * @returns Promise that resolves when streaming is complete
   */
  generateStream(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<void>;

  /**
   * Set callback for streaming chunks
   * @param callback Function to call for each chunk
   */
  setOnChunk(callback: LlmChunkCallback): void;

  /**
   * Set callback for generation completion
   * @param callback Function to call when generation completes
   */
  setOnComplete(callback: LlmCompleteCallback): void;

  /**
   * Set callback for when provider is ready
   * @param callback Function to call when ready
   */
  setOnReady(callback: SimpleCallback): void;

  /**
   * Set callback for fatal errors
   * @param callback Function to call on fatal error
   */
  setOnError(callback: ErrorCallback): void;

  /**
   * Get the current configuration
   */
  getConfig(): TConfig;

  /**
   * Check if provider is initialized
   */
  isInitialized(): boolean;
}
