import OpenAI from 'openai';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { LlmProviderBase } from './LlmProviderBase';
import { ImageContent, LlmContent, LlmGenerationOptions, LlmGenerationResult, LlmMessage, TextContent } from './ILlmProvider';
import { logger } from '../../../utils/logger';

extendZodWithOpenApi(z);

/**
 * Schema for OpenAI-specific configuration
 */
export const openAILlmProviderConfigSchema = z.object({
  apiKey: z.string().describe('OpenAI API key'),
  organizationId: z.string().optional().describe('Optional organization ID'),
  baseUrl: z.string().optional().describe('Optional base URL for OpenAI-compatible APIs'),
});

export type OpenAILlmProviderConfig = z.infer<typeof openAILlmProviderConfigSchema>;

/**
 * Schema for OpenAI LLM settings
 * Used with OpenAI provider using the new Responses API
 */
export const openAILlmSettingsSchema = z.object({
  model: z.string().min(1).describe('Model name (e.g., gpt-4, gpt-3.5-turbo, gpt-5, o1)'),
  defaultMaxTokens: z.number().int().positive().optional().describe('Default maximum output tokens for generation (includes reasoning and output tokens for reasoning models)'),
  defaultTemperature: z.number().min(0).max(2).optional().describe('Default temperature for generation (0-2). Not used with reasoning models - use reasoningEffort instead.'),
  defaultTopP: z.number().min(0).max(1).optional().describe('Default top-p for generation (0-1). Not used with reasoning models - use reasoningEffort instead.'),

  reasoningEffort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional().describe('Reasoning effort for reasoning models (gpt-5, o-series). Controls how many reasoning tokens to generate. low=fast/economical, high=more complete reasoning. Default: medium. gpt-5.1 defaults to none.'),
  reasoningSummary: z.enum(['auto', 'concise', 'detailed']).optional().describe('Generate a summary of reasoning performed by the model. Useful for debugging. Only for reasoning models.'),

  timeout: z.number().int().positive().optional().describe('Request timeout in milliseconds'),
}).openapi('OpenAILlmSettings');

export type OpenAILlmSettings = z.infer<typeof openAILlmSettingsSchema>;

/**
 * OpenAI LLM provider implementation using the new Responses API
 * Supports both streaming and non-streaming generation with multi-modal messages
 */
export class OpenAILlmProvider extends LlmProviderBase<OpenAILlmProviderConfig> {
  private client?: OpenAI;
  private settings: OpenAILlmSettings;

  constructor(config: OpenAILlmProviderConfig, settings: OpenAILlmSettings) {
    super(config);
    this.settings = settings;
  }

  /**
   * Convert message content to Response API input format
   */
  private convertContentToInput(content: string | (TextContent | ImageContent | { type: 'json'; data: Record<string, any> })[]) {
    if (typeof content === 'string') {
      return content;
    }

    // Multi-modal content array
    return content.map((item) => {
      if (item.type === 'text') {
        return {
          type: 'input_text' as const,
          text: (item as TextContent).text,
        };
      }
      if (item.type === 'image') {
        const imageContent = item as ImageContent;
        if (imageContent.source.type === 'url' && imageContent.source.url) {
          return {
            type: 'input_image' as const,
            image_url: imageContent.source.url,
          };
        } else if (imageContent.source.type === 'base64' && imageContent.source.data) {
          const mimeType = imageContent.source.mimeType || 'image/jpeg';
          const dataUrl = `data:${mimeType};base64,${imageContent.source.data}`;
          return {
            type: 'input_image' as const,
            image_url: dataUrl,
          };
        }
        throw new Error('Invalid image content: missing url or data');
      }
      if (item.type === 'json') {
        return {
          type: 'input_text' as const,
          text: JSON.stringify((item as any).data),
        };
      }
      throw new Error(`Unsupported content type: ${(item as any).type}`);
    });
  }

  /**
   * Convert our message format to simple text input (for now)
   * TODO: Support multi-modal input array format
   */
  private convertMessagesToInput(messages: LlmMessage[]): string {
    return messages
      .filter((msg) => msg.role !== 'system')
      .map((msg) => {
        const role = msg.role === 'user' ? 'User' : 'Assistant';
        if (typeof msg.content === 'string') {
          return `${role}: ${msg.content}`;
        }
        // Extract text from multi-modal content
        const text = msg.content.filter((c) => c.type === 'text').map((c) => (c as TextContent).text).join(' ');
        return `${role}: ${text}`;
      })
      .join('\n\n');
  }

  /**
   * Initialize the OpenAI provider
   */
  async init(): Promise<void> {
    await super.init();
    this.client = new OpenAI({
      apiKey: this.config!.apiKey,
      organization: this.config!.organizationId,
      baseURL: this.config!.baseUrl,
      timeout: this.settings.timeout,
    });

    logger.info(`OpenAI LLM provider initialized with model: ${this.settings.model}`);
  }

  /**
   * Generate a non-streaming response using the Responses API
   */
  protected async generateResponse(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<LlmGenerationResult> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized');
    }

    const input = this.convertMessagesToInput(messages);
    const systemMessage = messages.find((m) => m.role === 'system');

    logger.info(`Generating OpenAI response with model: ${this.settings.model}`);

    const outputFormat = options?.outputFormat || 'text';

    if (outputFormat === 'text' || outputFormat === 'json') {
      return this.generateTextBasedResponse(input, systemMessage, options);
    } else if (outputFormat === 'image') {
      return this.generateImageBasedResponse(input, systemMessage, options);
    } else if (outputFormat === 'audio') {
      return this.generateAudioBasedResponse(input, systemMessage, options);
    }

    throw new Error(`Unsupported output format: ${outputFormat}`);
  }

  /**
   * Generate an image-based response using the image_generation tool.
   * The image is returned as base64-encoded data in the result field.
   */
  private async generateImageBasedResponse(input: string, systemMessage: LlmMessage | undefined, options?: LlmGenerationOptions): Promise<LlmGenerationResult> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized');
    }

    const response = await this.client.responses.create({
      model: this.settings.model,
      input,
      instructions: systemMessage ? (typeof systemMessage.content === 'string' ? systemMessage.content : this.extractTextContent([systemMessage])) : undefined,
      max_output_tokens: options?.maxTokens ?? this.settings.defaultMaxTokens,
      temperature: this.settings.reasoningEffort ? undefined : this.settings.defaultTemperature,
      top_p: this.settings.reasoningEffort ? undefined : this.settings.defaultTopP,
      reasoning: this.settings.reasoningEffort || this.settings.reasoningSummary ? { effort: this.settings.reasoningEffort, summary: this.settings.reasoningSummary } : undefined,
      tools: [{ type: 'image_generation' }],
      stream: false,
      metadata: options?.metadata,
    });

    if (response.status === 'failed') {
      throw new Error(response.error?.message || 'Image generation failed');
    }

    // Extract base64-encoded image from image_generation_call output items
    let imageData = '';
    for (const item of response.output || []) {
      if ((item as any).type === 'image_generation_call' && (item as any).result) {
        imageData = (item as any).result;
        break;
      }
    }

    if (!imageData) {
      throw new Error('No image data returned from image generation');
    }

    // Return the base64-encoded image data as LlmImageContent
    const content: LlmContent[] = [
      {
        contentType: 'image',
        data: imageData,
        mimeType: 'image/png', // OpenAI image generation returns PNG
      },
    ];

    const result: LlmGenerationResult = {
      id: response.id,
      content,
      role: 'assistant',
      finishReason: response.status === 'completed' ? 'stop' : 'length',
      usage: response.usage ? {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.total_tokens,
      } : undefined,
      metadata: {
        model: response.model,
        status: response.status,
        outputFormat: 'image',
      },
    };

    return result;
  }

  /**
   * Generate an audio-based response.
   * Audio generation is not yet supported in the Responses API.
   */
  private async generateAudioBasedResponse(input: string, systemMessage: LlmMessage | undefined, options?: LlmGenerationOptions): Promise<LlmGenerationResult> {
    // Audio generation is not yet supported in the OpenAI Responses API
    // According to the documentation: "Audio is not yet supported in the Responses API"
    throw new Error('Audio-based response generation not supported in Responses API');
  }

  /**
   * Generate a text-based response and handle JSON output verification for JSON output format.
   * This is done by OpenAI's Responses API.
   */
  private async generateTextBasedResponse(input: string, systemMessage: LlmMessage | undefined, options?: LlmGenerationOptions): Promise<LlmGenerationResult> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized');
    }

    const response = await this.client.responses.create({
      model: this.settings.model,
      input,
      instructions: systemMessage ? (typeof systemMessage.content === 'string' ? systemMessage.content : this.extractTextContent([systemMessage])) : undefined,
      max_output_tokens: options?.maxTokens ?? this.settings.defaultMaxTokens,
      temperature: this.settings.reasoningEffort ? undefined : this.settings.defaultTemperature,
      top_p: this.settings.reasoningEffort ? undefined : this.settings.defaultTopP,
      reasoning: this.settings.reasoningEffort || this.settings.reasoningSummary ? { effort: this.settings.reasoningEffort, summary: this.settings.reasoningSummary } : undefined,
      stream: false,
      metadata: options?.metadata,
    });

    if (response.status === 'failed') {
      throw new Error(response.error?.message || 'Response generation failed');
    }

    // Extract text from output items
    let content = '';
    for (const item of response.output || []) {
      if (item.type === 'message' && item.role === 'assistant') {
        for (const contentItem of item.content || []) {
          if (contentItem.type === 'output_text') {
            content += contentItem.text;
          }
        }
      }
    }

    // Check if output format is JSON and attempt to parse it, throwing an error if parsing fails
    if (options?.outputFormat === 'json') {
      try {
        JSON.parse(content);
      } catch (error) {
        logger.error(`Failed to parse JSON output: ${error instanceof Error ? error.message : String(error)}`);
        throw new Error('Failed to parse JSON output from model response');
      }
    }

    // Construct the generation result with text content as LlmTextContent
    const contentArray: LlmContent[] = [
      {
        contentType: 'text',
        text: content,
      },
    ];

    const result: LlmGenerationResult = {
      id: response.id,
      content: contentArray,
      role: 'assistant',
      finishReason: response.status === 'completed' ? 'stop' : 'length',
      usage: response.usage ? {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.total_tokens,
      } : undefined,
      metadata: {
        model: response.model,
        status: response.status,
      },
    };

    return result;
  }

  /**
   * Generate a streaming response using the Responses API
   */
  async generateStream(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<void> {
    this.ensureInitialized();
    this.validateMessages(messages);

    if (!this.client) {
      throw new Error('OpenAI client not initialized');
    }

    if (options?.outputFormat && options.outputFormat !== 'text') {
      throw new Error(`Output format ${options.outputFormat} not supported for streaming generation`);
    }

    const input = this.convertMessagesToInput(messages);
    const systemMessage = messages.find((m) => m.role === 'system');

    try {
      logger.info(`Starting OpenAI streaming response with model: ${this.settings.model}`);

      const stream = await this.client.responses.create({
        model: this.settings.model,
        input,
        instructions: systemMessage ? (typeof systemMessage.content === 'string' ? systemMessage.content : this.extractTextContent([systemMessage])) : undefined,
        max_output_tokens: options?.maxTokens ?? this.settings.defaultMaxTokens,
        temperature: this.settings.reasoningEffort ? undefined : this.settings.defaultTemperature,
        top_p: this.settings.reasoningEffort ? undefined : this.settings.defaultTopP,
        reasoning: this.settings.reasoningEffort || this.settings.reasoningSummary ? { effort: this.settings.reasoningEffort, summary: this.settings.reasoningSummary } : undefined,
        stream: true,
        metadata: options?.metadata,
      });

      let fullContent = '';
      let responseId = '';
      let finalStatus = 'in_progress';
      let finalUsage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined;

      for await (const event of stream) {
        if (event.type === 'response.created') {
          responseId = event.response?.id || '';
        } else if (event.type === 'response.output_text.delta') {
          fullContent += event.delta;
          await this.notifyChunk(event.delta, responseId, 'assistant', null);
        } else if (event.type === 'response.completed') {
          const response = event.response;
          responseId = response?.id || responseId;
          finalStatus = response?.status || finalStatus;

          if (response?.usage) {
            finalUsage = {
              promptTokens: response.usage.input_tokens,
              completionTokens: response.usage.output_tokens,
              totalTokens: response.usage.total_tokens,
            };
          }
        }
      }

      // Notify completion with text content as LlmTextContent
      const contentArray: LlmContent[] = [
        {
          contentType: 'text',
          text: fullContent,
        },
      ];

      const result: LlmGenerationResult = {
        id: responseId,
        content: contentArray,
        role: 'assistant',
        finishReason: finalStatus === 'completed' ? 'stop' : finalStatus === 'incomplete' ? 'length' : 'stop',
        usage: finalUsage ? {
          promptTokens: finalUsage.promptTokens || 0,
          completionTokens: finalUsage.completionTokens || 0,
          totalTokens: finalUsage.totalTokens || 0,
        } : undefined,
        metadata: {
          model: this.settings.model,
          status: finalStatus,
        },
      };

      await this.notifyComplete(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`OpenAI streaming error: ${errorMessage}`);
      await this.notifyError(error instanceof Error ? error : new Error(errorMessage));
      throw error;
    }
  }


}
