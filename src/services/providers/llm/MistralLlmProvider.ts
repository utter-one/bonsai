import { Mistral } from '@mistralai/mistralai';
import type { Messages } from '@mistralai/mistralai/models/components/chatcompletionrequest.js';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { LlmProviderBase } from './LlmProviderBase';
import type { ImageContent, LlmContent, LlmGenerationOptions, LlmGenerationResult, LlmMessage, TextContent } from './ILlmProvider';
import { logger } from '../../../utils/logger';
import type { LlmModelInfo } from '../ProviderCatalogService';

extendZodWithOpenApi(z);

/**
 * Schema for Mistral AI-specific provider configuration
 */
export const mistralLlmProviderConfigSchema = z.strictObject({
  apiKey: z.string().describe('Mistral AI API key'),
  baseUrl: z.string().optional().describe('Optional base URL override (defaults to https://api.mistral.ai/v1)'),
});

export type MistralLlmProviderConfig = z.infer<typeof mistralLlmProviderConfigSchema>;

/**
 * Schema for Mistral AI LLM settings
 */
export const mistralLlmSettingsSchema = z.object({
  model: z.string().min(1).describe('Model name (e.g., mistral-large-latest, mistral-small-latest)'),
  defaultMaxTokens: z.number().int().positive().optional().describe('Default maximum tokens for generation'),
  defaultTemperature: z.number().min(0).max(2).optional().describe('Default temperature for generation (0-2)'),
  defaultTopP: z.number().min(0).max(1).optional().describe('Default top-p for generation (0-1)'),
  timeout: z.number().int().positive().optional().describe('Request timeout in milliseconds'),
}).openapi('MistralLlmSettings');

export type MistralLlmSettings = z.infer<typeof mistralLlmSettingsSchema>;

/**
 * Mistral AI LLM provider using the native @mistralai/mistralai SDK.
 * Supports both streaming and non-streaming chat completions.
 */
export class MistralLlmProvider extends LlmProviderBase<MistralLlmProviderConfig> {
  private client?: Mistral;
  private settings: MistralLlmSettings;

  constructor(config: MistralLlmProviderConfig, settings: MistralLlmSettings) {
    super(config);
    this.settings = settings;
  }

  /**
   * Initialize the Mistral provider.
   */
  async init(): Promise<void> {
    await super.init();
    this.client = new Mistral({
      apiKey: this.config!.apiKey,
      serverURL: this.config!.baseUrl,
    });
    logger.info(`Mistral AI LLM provider initialized with model: ${this.settings.model}`);
  }

  /**
   * Generate a non-streaming response using the native Mistral SDK.
   */
  async generate(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<LlmGenerationResult> {
    this.ensureInitialized();
    this.validateMessages(messages);

    if (!this.client) {
      throw new Error('Mistral client not initialized');
    }

    const mistralMessages = this.convertToMistralMessages(messages);

    await this.notifyStarted();

    try {
      logger.info(`Generating Mistral completion with model: ${this.settings.model}`);

      const outputFormat = options?.outputFormat || 'text';

      if (outputFormat === 'image' || outputFormat === 'audio') {
        throw new Error(`Output format ${outputFormat} not supported by Mistral provider`);
      }

      const response = await this.client.chat.complete({
        model: this.settings.model,
        messages: mistralMessages,
        maxTokens: options?.maxTokens ?? this.settings.defaultMaxTokens,
        temperature: this.settings.defaultTemperature,
        topP: this.settings.defaultTopP,
        responseFormat: outputFormat === 'json' ? { type: 'json_object' } : undefined,
      });

      const choice = response.choices?.[0];
      if (!choice) {
        throw new Error('No completion choice returned from Mistral');
      }

      const rawContent = choice.message.content;
      const text = typeof rawContent === 'string' ? rawContent : (rawContent?.map(c => (c as any).text ?? '').join('') ?? '');

      if (outputFormat === 'json') {
        try {
          JSON.parse(text);
        } catch (error) {
          logger.error(`Failed to parse JSON output: ${error instanceof Error ? error.message : String(error)}`);
          throw new Error('Failed to parse JSON output from model response');
        }
      }

      const contentArray: LlmContent[] = [{ contentType: 'text', text }];

      const result: LlmGenerationResult = {
        id: response.id,
        content: contentArray,
        role: 'assistant',
        finishReason: this.mapFinishReason(choice.finishReason),
        usage: response.usage ? {
          promptTokens: response.usage.promptTokens ?? 0,
          completionTokens: response.usage.completionTokens ?? 0,
          totalTokens: response.usage.totalTokens ?? 0,
        } : undefined,
        metadata: {
          model: response.model,
        },
      };

      await this.notifyComplete(result);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Mistral generation error: ${errorMessage}`);
      await this.notifyError(error instanceof Error ? error : new Error(errorMessage));
      throw error;
    }
  }

  /**
   * Generate a streaming response using the native Mistral SDK.
   */
  async generateStream(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<void> {
    this.ensureInitialized();
    this.validateMessages(messages);

    if (!this.client) {
      throw new Error('Mistral client not initialized');
    }

    if (options?.outputFormat && options.outputFormat !== 'text') {
      throw new Error(`Output format ${options.outputFormat} not supported for Mistral streaming generation`);
    }

    const mistralMessages = this.convertToMistralMessages(messages);

    // If the last original message is an assistant prefill, Mistral echoes it back at the
    // start of the stream. Track the prefix so we can strip it from the output.
    const lastMsg = messages[messages.length - 1];
    const prefixToStrip = lastMsg?.role === 'assistant'
      ? (typeof lastMsg.content === 'string' ? lastMsg.content : this.extractTextContent([lastMsg]))
      : null;
    let prefixRemaining = prefixToStrip ?? '';

    try {
      logger.info(`Starting Mistral streaming completion with model: ${this.settings.model}`);

      const stream = await this.client.chat.stream({
        model: this.settings.model,
        messages: mistralMessages,
        maxTokens: options?.maxTokens ?? this.settings.defaultMaxTokens,
        temperature: this.settings.defaultTemperature,
        topP: this.settings.defaultTopP,
      });

      let fullContent = '';
      let completionId = '';
      let finalFinishReason: string | null = null;
      let promptTokens = 0;
      let completionTokens = 0;
      let totalTokens = 0;

      for await (const event of stream) {
        const chunk = event.data;
        completionId = chunk.id;

        const choice = chunk.choices[0];
        if (choice) {
          const delta = choice.delta?.content;
          if (typeof delta === 'string' && delta.length > 0) {
            // Strip the echoed prefix from the beginning of the response
            let stripped = delta;
            if (prefixRemaining.length > 0) {
              const overlap = prefixRemaining.length >= stripped.length ? stripped.length : prefixRemaining.length;
              prefixRemaining = prefixRemaining.slice(overlap);
              stripped = stripped.slice(overlap);
            }
            if (stripped.length > 0) {
              fullContent += stripped;
              const mappedFinish = choice.finishReason ? this.mapFinishReason(choice.finishReason) : null;
              await this.notifyChunk(stripped, chunk.id, 'assistant', mappedFinish);
            }
          }

          if (choice.finishReason) {
            finalFinishReason = choice.finishReason;
          }
        }

        if (chunk.usage) {
          promptTokens = chunk.usage.promptTokens ?? 0;
          completionTokens = chunk.usage.completionTokens ?? 0;
          totalTokens = chunk.usage.totalTokens ?? 0;
        }
      }

      const contentArray: LlmContent[] = [{ contentType: 'text', text: fullContent }];

      const result: LlmGenerationResult = {
        id: completionId,
        content: contentArray,
        role: 'assistant',
        finishReason: this.mapFinishReason(finalFinishReason),
        usage: { promptTokens, completionTokens, totalTokens },
        metadata: {
          model: this.settings.model,
        },
      };

      await this.notifyComplete(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Mistral streaming error: ${errorMessage}`);
      await this.notifyError(error instanceof Error ? error : new Error(errorMessage));
      throw error;
    }
  }

  /**
   * Enumerate available models using the native Mistral SDK.
   * Falls back to a static list if the API call fails.
   */
  async enumerateModels(): Promise<LlmModelInfo[]> {
    if (this.client) {
      try {
        const modelList = await this.client.models.list();
        const chatModels = (modelList.data ?? []).filter(m => m.capabilities.completionChat);
        if (chatModels.length > 0) {
          return chatModels.map(m => ({
            id: m.id,
            displayName: m.name ?? m.id,
            description: m.description ?? undefined,
            supportsToolCalling: m.capabilities.functionCalling ?? false,
            supportsJsonOutput: true,
            supportsStreaming: true,
            supportsVision: m.capabilities.vision ?? false,
            contextWindow: m.maxContextLength,
          }));
        }
      } catch (error) {
        logger.warn(`Failed to enumerate Mistral models via API: ${error instanceof Error ? error.message : String(error)}, using static list`);
      }
    }
    return MistralLlmProvider.getMistralStaticModels();
  }

  /**
   * Moderate user input using the Mistral moderation API.
   * Uses the mistral-moderation-latest model to detect policy violations.
   * @param input - User input text to moderate
   * @returns Flagged status and list of violated categories
   */
  async moderateUserInput(input: string): Promise<{ flagged: boolean; categories: string[] }> {
    this.ensureInitialized();
    const response = await this.client!.classifiers.moderate({ model: 'mistral-moderation-latest', inputs: [input] });
    const result = response.results[0];
    const categories = Object.entries(result.categories ?? {}).filter(([, v]) => v).map(([k]) => k);
    return { flagged: categories.length > 0, categories };
  }

  /**
   * Convert our internal LlmMessage format to Mistral SDK Messages format.
   * If the last message has role "assistant", it is treated as a prefill by setting `prefix: true`,
   * which is required by Mistral when the conversation ends with an assistant turn.
   */
  private convertToMistralMessages(messages: LlmMessage[]): Messages[] {
    const result: Messages[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        const text = typeof msg.content === 'string' ? msg.content : this.extractTextContent([msg]);
        result.push({ role: 'system', content: text });
      } else if (msg.role === 'user') {
        if (typeof msg.content === 'string') {
          result.push({ role: 'user', content: msg.content });
        } else {
          const text = msg.content
            .map(c => {
              if (c.type === 'text') return (c as TextContent).text;
              if (c.type === 'image') {
                const img = c as ImageContent;
                if (img.source.type === 'url' && img.source.url) return `[Image: ${img.source.url}]`;
                logger.warn('Mistral does not support base64 image input. Image skipped.');
                return '';
              }
              if (c.type === 'json') return JSON.stringify((c as any).data);
              return '';
            })
            .join('');
          result.push({ role: 'user', content: text });
        }
      } else if (msg.role === 'assistant') {
        const text = typeof msg.content === 'string' ? msg.content : this.extractTextContent([msg]);
        result.push({ role: 'assistant', content: text });
      } else if (msg.role === 'tool') {
        logger.warn('Tool role messages are not yet supported by MistralLlmProvider and will be skipped.');
      }
    }

    // Mistral requires that if the last message has role "assistant", it must have prefix: true
    const last = result[result.length - 1];
    if (last && last.role === 'assistant') {
      (last as any).prefix = true;
    }

    return result;
  }

  /**
   * Map Mistral's finish reason to our unified finish reason format.
   */
  private mapFinishReason(reason: string | null | undefined): 'stop' | 'length' | 'tool_calls' | 'content_filter' {
    switch (reason) {
      case 'stop':
      case 'model_length':
        return 'stop';
      case 'length':
        return 'length';
      case 'tool_calls':
        return 'tool_calls';
      case 'error':
        return 'content_filter';
      default:
        return 'stop';
    }
  }

  private static getMistralStaticModels(): LlmModelInfo[] {
    return [
      { id: 'mistral-large-latest', displayName: 'Mistral Large', recommended: true, description: 'Top-tier reasoning model for sophisticated tasks', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: true, contextWindow: 131072 },
      { id: 'mistral-small-latest', displayName: 'Mistral Small', description: 'Cost-efficient model for simple tasks', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: true, contextWindow: 131072 },
      { id: 'codestral-latest', displayName: 'Codestral', description: 'Specialized model for code generation and completion', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, contextWindow: 262144 },
      { id: 'mistral-saba-latest', displayName: 'Mistral Saba', description: 'High-performance model for Middle Eastern and South Asian languages', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, contextWindow: 32768 },
      { id: 'open-mistral-nemo', displayName: 'Mistral NeMo', description: 'Open-source model with a 128k context window', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, contextWindow: 131072 },
    ];
  }
}
