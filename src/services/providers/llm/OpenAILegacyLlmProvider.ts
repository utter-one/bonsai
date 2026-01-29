import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionContentPart } from 'openai/resources/chat/completions';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { LlmProviderBase } from './LlmProviderBase';
import { ImageContent, LlmGenerationOptions, LlmGenerationResult, LlmMessage, TextContent } from './ILlmProvider';
import { logger } from '../../../utils/logger';

extendZodWithOpenApi(z);

/**
 * Schema for OpenAI-specific configuration for legacy Chat Completions API
 */
export const openAILegacyLlmProviderConfigSchema = z.object({
  apiKey: z.string().describe('OpenAI API key'),
  organizationId: z.string().optional().describe('Optional organization ID'),
  baseUrl: z.string().optional().describe('Optional base URL for OpenAI-compatible APIs'),
});

export type OpenAILegacyLlmProviderConfig = z.infer<typeof openAILegacyLlmProviderConfigSchema>;

/**
 * Schema for OpenAI Legacy LLM settings
 * Used with OpenAI-compatible APIs (OpenAI Legacy, Groq) using Chat Completions API
 */
export const openAILegacyLlmSettingsSchema = z.object({
  model: z.string().min(1).describe('Model name (e.g., gpt-4, gpt-3.5-turbo, gpt-4-turbo)'),
  defaultMaxTokens: z.number().int().positive().optional().describe('Default maximum tokens for generation'),
  defaultTemperature: z.number().min(0).max(2).optional().describe('Default temperature for generation (0-2)'),
  defaultTopP: z.number().min(0).max(1).optional().describe('Default top-p for generation (0-1)'),
  timeout: z.number().int().positive().optional().describe('Request timeout in milliseconds'),
});

export type OpenAILegacyLlmSettings = z.infer<typeof openAILegacyLlmSettingsSchema>;

/**
 * OpenAI LLM provider implementation using the legacy Chat Completions API
 * Supports both streaming and non-streaming generation with multi-modal messages
 * Use this for compatibility with older models or OpenAI-compatible APIs
 */
export class OpenAILegacyLlmProvider extends LlmProviderBase<OpenAILegacyLlmProviderConfig> {
  private client?: OpenAI;
  private settings: OpenAILegacyLlmSettings;

  constructor(config: OpenAILegacyLlmProviderConfig, settings: OpenAILegacyLlmSettings) {
    super(config);
    this.settings = settings;
  }

  /**
   * Initialize the OpenAI legacy provider
   */
  async init(): Promise<void> {
    await super.init();

    this.client = new OpenAI({
      apiKey: this.config!.apiKey,
      organization: this.config!.organizationId,
      baseURL: this.config!.baseUrl,
      timeout: this.settings.timeout,
    });

    logger.info(`OpenAI Legacy LLM provider initialized with model: ${this.settings.model}`);
  }

  /**
   * Generate a non-streaming response using Chat Completions API
   */
  async generate(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<LlmGenerationResult> {
    this.ensureInitialized();
    this.validateMessages(messages);

    if (!this.client) {
      throw new Error('OpenAI client not initialized');
    }

    const mergedOptions = this.applyDefaultOptions(options);
    const openAIMessages = this.convertToOpenAIMessages(messages);

    try {
      logger.info(`Generating OpenAI Chat Completion with model: ${this.settings.model}`);

      const completion = await this.client.chat.completions.create({
        model: this.settings.model,
        messages: openAIMessages,
        max_tokens: mergedOptions.maxTokens,
        temperature: mergedOptions.temperature,
        top_p: mergedOptions.topP,
        stop: mergedOptions.stopSequences,
        frequency_penalty: mergedOptions.frequencyPenalty,
        presence_penalty: mergedOptions.presencePenalty,
        stream: false,
      });

      const choice = completion.choices[0];
      if (!choice || !choice.message) {
        throw new Error('No completion choice returned from OpenAI');
      }

      const result: LlmGenerationResult = {
        id: completion.id,
        content: choice.message.content || '',
        role: 'assistant',
        finishReason: this.mapFinishReason(choice.finish_reason),
        usage: completion.usage ? {
          promptTokens: completion.usage.prompt_tokens,
          completionTokens: completion.usage.completion_tokens,
          totalTokens: completion.usage.total_tokens,
        } : undefined,
        metadata: {
          model: completion.model,
          systemFingerprint: completion.system_fingerprint,
        },
      };

      await this.notifyComplete(result);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`OpenAI Chat Completion error: ${errorMessage}`);
      await this.notifyError(error instanceof Error ? error : new Error(errorMessage));
      throw error;
    }
  }

  /**
   * Generate a streaming response using Chat Completions API
   */
  async generateStream(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<void> {
    this.ensureInitialized();
    this.validateMessages(messages);

    if (!this.client) {
      throw new Error('OpenAI client not initialized');
    }

    const mergedOptions = this.applyDefaultOptions(options);
    const openAIMessages = this.convertToOpenAIMessages(messages);

    try {
      logger.info(`Starting OpenAI Chat Completion streaming with model: ${this.settings.model}`);

      const stream = await this.client.chat.completions.create({
        model: this.settings.model,
        messages: openAIMessages,
        max_tokens: mergedOptions.maxTokens,
        temperature: mergedOptions.temperature,
        top_p: mergedOptions.topP,
        stop: mergedOptions.stopSequences,
        frequency_penalty: mergedOptions.frequencyPenalty,
        presence_penalty: mergedOptions.presencePenalty,
        stream: true,
        stream_options: { include_usage: true },
      });

      let fullContent = '';
      let completionId = '';
      let finalFinishReason: string | null = null;
      let finalUsage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined;

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        completionId = chunk.id;

        // Handle content delta
        if (choice.delta?.content) {
          fullContent += choice.delta.content;
          const mappedFinishReason = choice.finish_reason ? this.mapFinishReason(choice.finish_reason) : null;
          await this.notifyChunk(choice.delta.content, chunk.id, 'assistant', mappedFinishReason);
        }

        // Track finish reason
        if (choice.finish_reason) {
          finalFinishReason = choice.finish_reason;
        }

        // Track usage (OpenAI sends this in the final chunk)
        if (chunk.usage) {
          finalUsage = {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
          };
        }
      }

      // Notify completion
      const result: LlmGenerationResult = {
        id: completionId,
        content: fullContent,
        role: 'assistant',
        finishReason: this.mapFinishReason(finalFinishReason),
        usage: finalUsage ? {
          promptTokens: finalUsage.promptTokens || 0,
          completionTokens: finalUsage.completionTokens || 0,
          totalTokens: finalUsage.totalTokens || 0,
        } : undefined,
        metadata: {
          model: this.settings.model,
        },
      };

      await this.notifyComplete(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`OpenAI Chat Completion streaming error: ${errorMessage}`);
      await this.notifyError(error instanceof Error ? error : new Error(errorMessage));
      throw error;
    }
  }

  /**
   * Convert our message format to OpenAI Chat Completions format
   */
  private convertToOpenAIMessages(messages: LlmMessage[]): ChatCompletionMessageParam[] {
    return messages.map((msg) => {
      // Simple text message
      if (typeof msg.content === 'string') {
        return {
          role: msg.role,
          content: msg.content,
          ...(msg.name && { name: msg.name }),
        } as ChatCompletionMessageParam;
      }

      // Multi-modal message with content array
      const contentParts: ChatCompletionContentPart[] = msg.content.map((content) => {
        if (content.type === 'text') {
          return {
            type: 'text',
            text: (content as TextContent).text,
          };
        }

        if (content.type === 'image') {
          const imageContent = content as ImageContent;
          if (imageContent.source.type === 'url' && imageContent.source.url) {
            return {
              type: 'image_url',
              image_url: {
                url: imageContent.source.url,
              },
            };
          } else if (imageContent.source.type === 'base64' && imageContent.source.data) {
            // OpenAI expects data URLs for base64 images
            const mimeType = imageContent.source.mimeType || 'image/jpeg';
            const dataUrl = `data:${mimeType};base64,${imageContent.source.data}`;
            return {
              type: 'image_url',
              image_url: {
                url: dataUrl,
              },
            };
          }
          throw new Error('Invalid image content: missing url or data');
        }

        if (content.type === 'json') {
          // Chat Completions doesn't have native JSON content type, convert to text
          return {
            type: 'text',
            text: JSON.stringify((content as any).data),
          };
        }

        throw new Error(`Unsupported content type: ${(content as any).type}`);
      });

      return {
        role: msg.role,
        content: contentParts,
        ...(msg.name && { name: msg.name }),
      } as ChatCompletionMessageParam;
    });
  }

  /**
   * Map OpenAI's finish reason to our format
   */
  private mapFinishReason(reason: string | null): 'stop' | 'length' | 'tool_calls' | 'content_filter' {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      case 'tool_calls':
      case 'function_call':
        return 'tool_calls';
      case 'content_filter':
        return 'content_filter';
      default:
        return 'stop';
    }
  }
}
