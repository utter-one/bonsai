import { z } from 'zod';
import type { ErrorCallback, SimpleCallback } from '../../../types/callbacks';

/**
 * Represents the role of a message in a conversation
 */
export const messageRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);
export type MessageRole = z.infer<typeof messageRoleSchema>;

/**
 * Content type for multi-modal messages
 */
export const messageContentTypeSchema = z.enum(['text', 'image', 'json']);
export type MessageContentType = z.infer<typeof messageContentTypeSchema>;

/**
 * Text content block
 */
export const textContentSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});
export type TextContent = z.infer<typeof textContentSchema>;

/**
 * Image content block with support for URLs or base64 data
 */
export const imageContentSchema = z.object({
  type: z.literal('image'),
  source: z.object({
    type: z.enum(['url', 'base64']),
    url: z.string().optional(),
    data: z.string().optional(),
    mimeType: z.string().optional(),
  }),
});
export type ImageContent = z.infer<typeof imageContentSchema>;

/**
 * JSON content block for structured data
 */
export const jsonContentSchema = z.object({
  type: z.literal('json'),
  data: z.record(z.string(), z.any()),
});
export type JsonContent = z.infer<typeof jsonContentSchema>;

/**
 * Multi-modal message content
 */
export const messageContentSchema = z.discriminatedUnion('type', [
  textContentSchema,
  imageContentSchema,
  jsonContentSchema,
]);
export type MessageContent = z.infer<typeof messageContentSchema>;

/**
 * Message in conversation history
 */
export const llmMessageSchema = z.object({
  role: messageRoleSchema,
  content: z.union([z.string(), z.array(messageContentSchema)]),
  name: z.string().optional(),
  toolCallId: z.string().optional(),
});
export type LlmMessage = z.infer<typeof llmMessageSchema>;

/**
 * Token usage information for generation
 */
export const tokenUsageSchema = z.object({
  promptTokens: z.number(),
  completionTokens: z.number(),
  totalTokens: z.number(),
});
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

/**
 * Text content in LLM output
 */
export const llmTextContentSchema = z.object({
  contentType: z.literal('text'),
  text: z.string(),
});
export type LlmTextContent = z.infer<typeof llmTextContentSchema>;

/**
 * Image content in LLM output
 */
export const llmImageContentSchema = z.object({
  contentType: z.literal('image'),
  data: z.string().describe('Base64-encoded image data'),
  mimeType: z.string().describe('MIME type (e.g., image/png, image/jpeg)'),
  metadata: z.object({
    width: z.number().optional(),
    height: z.number().optional(),
  }).catchall(z.any()).optional(),
});
export type LlmImageContent = z.infer<typeof llmImageContentSchema>;

/**
 * Audio content in LLM output
 */
export const llmAudioContentSchema = z.object({
  contentType: z.literal('audio'),
  data: z.string().describe('Base64-encoded audio data'),
  format: z.enum(['pcm', 'mp3', 'wav', 'opus']).describe('Audio format'),
  mimeType: z.string().describe('MIME type (e.g., audio/pcm, audio/mpeg)'),
  metadata: z.object({
    sampleRate: z.number().optional(),
    channels: z.number().optional(),
    bitDepth: z.number().optional(),
  }).catchall(z.any()).optional(),
});
export type LlmAudioContent = z.infer<typeof llmAudioContentSchema>;

/**
 * Multi-modal content block in LLM output
 */
export const llmContentSchema = z.discriminatedUnion('contentType', [
  llmTextContentSchema,
  llmImageContentSchema,
  llmAudioContentSchema,
]);
export type LlmContent = z.infer<typeof llmContentSchema>;

/**
 * Streaming chunk from LLM provider (text-only)
 */
export const llmChunkSchema = z.object({
  id: z.string(),
  content: z.string(),
  role: messageRoleSchema.optional(),
  finishReason: z.enum(['stop', 'length', 'tool_calls', 'content_filter']).nullable().optional(),
  usage: tokenUsageSchema.partial().optional(),
});
export type LlmChunk = z.infer<typeof llmChunkSchema>;

/**
 * Complete generation result with multi-modal support
 */
export const llmGenerationResultSchema = z.object({
  id: z.string(),
  content: z.array(llmContentSchema).describe('Array of content blocks supporting multiple modalities'),
  role: messageRoleSchema,
  finishReason: z.enum(['stop', 'length', 'tool_calls', 'content_filter']),
  usage: tokenUsageSchema.optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});
export type LlmGenerationResult = z.infer<typeof llmGenerationResultSchema>;

/**
 * Generation options for LLM requests
 */
export const llmGenerationOptionsSchema = z.object({
  maxTokens: z.number().describe('Maximum number of tokens to generate').optional(),
  metadata: z.record(z.string(), z.any()).describe('Custom metadata to attach to the request').optional(),
  outputFormat: z.enum(['text', 'json', 'image', 'audio']).describe('Output format for the generation').optional(),
});
export type LlmGenerationOptions = z.infer<typeof llmGenerationOptionsSchema>;

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
// export interface LlmProviderConfig {
//   apiKey: string;
//   baseUrl?: string;
//   model: string;
//   defaultMaxTokens?: number;
//   defaultTemperature?: number;
//   defaultTopP?: number;
//   timeout?: number;
//   [key: string]: any;
// }

/**
 * Interface for LLM provider implementations
 * Supports both streaming and non-streaming generation with multi-modal messages
 */
export interface ILlmProvider {
  /**
   * Initialize the provider with configuration
   * @param config Provider-specific configuration
   */
  init(): Promise<void>;

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
   * Set callback for when provider is ready
   * @param callback Function to call when provider is initialized and ready
   */
  setOnGenerationStarted(callback: SimpleCallback): void;

  /**
   * Set callback for generation completion
   * @param callback Function to call when generation completes
   */
  setOnGenerationCompleted(callback: LlmCompleteCallback): void;

  /**
   * Set callback for fatal errors
   * @param callback Function to call on fatal error
   */
  setOnError(callback: ErrorCallback): void;

  /**
   * Check if provider is initialized
   */
  isInitialized(): boolean;
}
