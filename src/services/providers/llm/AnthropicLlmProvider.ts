import Anthropic from '@anthropic-ai/sdk';
import { LlmProviderBase } from './LlmProviderBase';
import { ImageContent, LlmGenerationOptions, LlmGenerationResult, LlmMessage, LlmProviderConfig, TextContent } from './ILlmProvider';
import { logger } from '../../../utils/logger';

/**
 * Anthropic-specific configuration
 */
export interface AnthropicLlmProviderConfig extends LlmProviderConfig {
  /** Anthropic API key */
  apiKey: string;
  /** Optional base URL for custom endpoints */
  baseUrl?: string;
  /** Model name (e.g., claude-3-5-sonnet-20241022, claude-3-opus-20240229) */
  model: string;
  /** Default max tokens (required by Anthropic) */
  defaultMaxTokens: number;
  /** Default temperature */
  defaultTemperature?: number;
  /** Default top-p */
  defaultTopP?: number;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Anthropic API version */
  anthropicVersion?: string;
}

/**
 * Anthropic LLM provider implementation using Claude models
 * Supports both streaming and non-streaming generation with multi-modal messages
 */
export class AnthropicLlmProvider extends LlmProviderBase<AnthropicLlmProviderConfig> {
  private client?: Anthropic;

  /**
   * Initialize the Anthropic provider
   */
  async init(config: AnthropicLlmProviderConfig): Promise<void> {
    await super.init(config);

    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      timeout: config.timeout,
      defaultHeaders: config.anthropicVersion ? { 'anthropic-version': config.anthropicVersion } : undefined,
    });

    logger.info(`Anthropic LLM provider initialized with model: ${config.model}`);
  }

  /**
   * Generate a non-streaming response
   */
  async generate(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<LlmGenerationResult> {
    this.ensureInitialized();
    this.validateMessages(messages);

    if (!this.client) {
      throw new Error('Anthropic client not initialized');
    }

    const mergedOptions = this.applyDefaultOptions(options);
    const { system, messages: anthropicMessages } = this.convertToAnthropicMessages(messages);

    try {
      logger.info(`Generating Anthropic completion with model: ${this.config!.model}`);

      const response = await this.client.messages.create({
        model: this.config!.model,
        max_tokens: mergedOptions.maxTokens || this.config!.defaultMaxTokens,
        messages: anthropicMessages,
        system: system || undefined,
        temperature: mergedOptions.temperature,
        top_p: mergedOptions.topP,
        stop_sequences: mergedOptions.stopSequences,
        stream: false,
        metadata: mergedOptions.metadata,
      });

      // Extract text from content blocks
      let content = '';
      for (const block of response.content) {
        if (block.type === 'text') {
          content += block.text;
        }
      }

      const result: LlmGenerationResult = {
        id: response.id,
        content,
        role: 'assistant',
        finishReason: this.mapStopReason(response.stop_reason),
        usage: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        },
        metadata: {
          model: response.model,
          stopReason: response.stop_reason,
          stopSequence: response.stop_sequence,
        },
      };

      await this.notifyComplete(result);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Anthropic generation error: ${errorMessage}`);
      await this.notifyError(error instanceof Error ? error : new Error(errorMessage));
      throw error;
    }
  }

  /**
   * Generate a streaming response
   */
  async generateStream(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<void> {
    this.ensureInitialized();
    this.validateMessages(messages);

    if (!this.client) {
      throw new Error('Anthropic client not initialized');
    }

    const mergedOptions = this.applyDefaultOptions(options);
    const { system, messages: anthropicMessages } = this.convertToAnthropicMessages(messages);

    try {
      logger.info(`Starting Anthropic streaming completion with model: ${this.config!.model}`);

      const stream = await this.client.messages.create({
        model: this.config!.model,
        max_tokens: mergedOptions.maxTokens || this.config!.defaultMaxTokens,
        messages: anthropicMessages,
        system: system || undefined,
        temperature: mergedOptions.temperature,
        top_p: mergedOptions.topP,
        stop_sequences: mergedOptions.stopSequences,
        stream: true,
        metadata: mergedOptions.metadata,
      });

      let fullContent = '';
      let messageId = '';
      let finalStopReason: string | null = null;
      let inputTokens = 0;
      let outputTokens = 0;

      for await (const event of stream) {
        if (event.type === 'message_start') {
          messageId = event.message.id;
          inputTokens = event.message.usage.input_tokens;
          outputTokens = event.message.usage.output_tokens;
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            fullContent += event.delta.text;
            await this.notifyChunk(event.delta.text, messageId, 'assistant', null);
          }
        } else if (event.type === 'message_delta') {
          finalStopReason = event.delta.stop_reason || finalStopReason;
          outputTokens = event.usage.output_tokens;
        }
      }

      // Notify completion
      const result: LlmGenerationResult = {
        id: messageId,
        content: fullContent,
        role: 'assistant',
        finishReason: this.mapStopReason(finalStopReason),
        usage: {
          promptTokens: inputTokens,
          completionTokens: outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
        metadata: {
          model: this.config!.model,
          stopReason: finalStopReason,
        },
      };

      await this.notifyComplete(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Anthropic streaming error: ${errorMessage}`);
      await this.notifyError(error instanceof Error ? error : new Error(errorMessage));
      throw error;
    }
  }

  /**
   * Convert our message format to Anthropic's format
   * Anthropic requires system prompt to be separate from messages
   */
  private convertToAnthropicMessages(messages: LlmMessage[]): { system: string | null; messages: Anthropic.MessageParam[] } {
    let system: string | null = null;
    const anthropicMessages: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      // Extract system message separately
      if (msg.role === 'system') {
        const systemContent = typeof msg.content === 'string' ? msg.content : this.extractTextContent([msg]);
        system = system ? `${system}\n\n${systemContent}` : systemContent;
        continue;
      }

      // Tool role is not supported in Anthropic, skip or handle differently
      if (msg.role === 'tool') {
        continue;
      }

      // Convert content
      if (typeof msg.content === 'string') {
        anthropicMessages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content,
        });
      } else {
        // Multi-modal content
        const contentBlocks: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> = [];

        for (const content of msg.content) {
          if (content.type === 'text') {
            contentBlocks.push({
              type: 'text',
              text: (content as TextContent).text,
            });
          } else if (content.type === 'image') {
            const imageContent = content as ImageContent;
            if (imageContent.source.type === 'url') {
              // Anthropic doesn't support image URLs directly, need to fetch and convert to base64
              // For now, skip URL images or throw an error
              logger.warn('Anthropic does not support image URLs directly. Image will be skipped.');
              continue;
            } else if (imageContent.source.type === 'base64' && imageContent.source.data) {
              const mediaType = this.getAnthropicMediaType(imageContent.source.mimeType);
              contentBlocks.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: imageContent.source.data,
                },
              });
            }
          } else if (content.type === 'json') {
            // Convert JSON to text
            contentBlocks.push({
              type: 'text',
              text: JSON.stringify((content as any).data),
            });
          }
        }

        anthropicMessages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: contentBlocks,
        });
      }
    }

    return { system, messages: anthropicMessages };
  }

  /**
   * Get Anthropic media type from MIME type
   */
  private getAnthropicMediaType(mimeType?: string): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
    switch (mimeType) {
      case 'image/jpeg':
      case 'image/jpg':
        return 'image/jpeg';
      case 'image/png':
        return 'image/png';
      case 'image/gif':
        return 'image/gif';
      case 'image/webp':
        return 'image/webp';
      default:
        return 'image/jpeg';
    }
  }

  /**
   * Map Anthropic's stop reason to our finish reason format
   */
  private mapStopReason(reason: string | null): 'stop' | 'length' | 'tool_calls' | 'content_filter' {
    switch (reason) {
      case 'end_turn':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'tool_use':
        return 'tool_calls';
      case 'stop_sequence':
        return 'stop';
      default:
        return 'stop';
    }
  }
}
