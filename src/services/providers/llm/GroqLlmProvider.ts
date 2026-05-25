import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { OpenAILegacyLlmProvider, OpenAILegacyLlmSettings } from './OpenAILegacyLlmProvider';
import { logger } from '../../../utils/logger';
import type { LlmModelInfo } from '../ProviderCatalogService';
import type { LlmContent, LlmGenerationOptions, LlmGenerationResult, LlmMessage } from './ILlmProvider';

extendZodWithOpenApi(z);

/**
 * Schema for Groq-specific provider configuration
 */
export const groqLlmProviderConfigSchema = z.strictObject({
  apiKey: z.string().describe('Groq API key'),
  baseUrl: z.string().optional().describe('Optional base URL override (defaults to https://api.groq.com/openai/v1)'),
});

export type GroqLlmProviderConfig = z.infer<typeof groqLlmProviderConfigSchema>;

/**
 * Schema for Groq LLM settings
 */
export const groqLlmSettingsSchema = z.object({
  model: z.string().min(1).describe('Model name (e.g., llama-3.3-70b-versatile, openai/gpt-oss-120b)'),
  defaultMaxTokens: z.number().int().positive().optional().describe('Default maximum tokens for generation'),
  defaultTemperature: z.number().min(0).max(2).optional().describe('Default temperature for generation (0-2)'),
  defaultTopP: z.number().min(0).max(1).optional().describe('Default top-p for generation (0-1)'),
  timeout: z.number().int().positive().optional().describe('Request timeout in milliseconds'),
  reasoningFormat: z.enum(['parsed', 'raw', 'hidden']).optional().describe('Controls how reasoning is presented in the response. "parsed" separates reasoning into a dedicated message.reasoning field, "raw" includes reasoning within <think> tags in the main text content, "hidden" returns only the final answer without reasoning. Not supported for GPT-OSS models — use includeReasoning instead. Mutually exclusive with includeReasoning.'),
  reasoningEffort: z.enum(['none', 'default', 'low', 'medium', 'high']).optional().describe('Controls the level of reasoning effort. For Qwen 3 32B: "none" disables reasoning, "default" enables it. For GPT-OSS 20B and 120B: "low", "medium", or "high" controls the number of reasoning tokens used.'),
  includeReasoning: z.boolean().optional().describe('Whether to include reasoning in the response. Only supported by GPT-OSS models (openai/gpt-oss-20b, openai/gpt-oss-120b). Mutually exclusive with reasoningFormat.'),
}).openapi('GroqLlmSettings');

export type GroqLlmSettings = z.infer<typeof groqLlmSettingsSchema>;

/**
 * Groq LLM provider using ultra-fast Groq inference via the OpenAI-compatible API.
 * Extends OpenAILegacyLlmProvider, overriding only the client creation and model enumeration.
 */
export class GroqLlmProvider extends OpenAILegacyLlmProvider<GroqLlmProviderConfig> {
  private readonly groqSettings: GroqLlmSettings;

  constructor(config: GroqLlmProviderConfig, settings: GroqLlmSettings) {
    super(config, settings as OpenAILegacyLlmSettings);
    this.groqSettings = settings;
  }

  /**
   * Creates an OpenAI client pointed at the Groq inference endpoint
   */
  protected createClient(): OpenAI {
    return new OpenAI({
      apiKey: this.config!.apiKey,
      baseURL: this.config!.baseUrl ?? 'https://api.groq.com/openai/v1',
      timeout: this.settings.timeout,
    });
  }

  /**
   * Generates a text-based response, injecting Groq reasoning parameters when configured.
   */
  protected override async generateTextBasedResponse(openAIMessages: ChatCompletionMessageParam[], options?: LlmGenerationOptions): Promise<LlmGenerationResult> {
    const reasoningParams = this.buildGroqReasoningParams();
    if (Object.keys(reasoningParams).length === 0) {
      return super.generateTextBasedResponse(openAIMessages, options);
    }

    if (!this.client) {
      throw new Error('OpenAI client not initialized');
    }

    const outputFormat = options?.outputFormat || 'text';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const completion = await (this.client.chat.completions.create as any)({
      model: this.settings.model,
      messages: openAIMessages,
      max_tokens: options?.maxTokens ?? this.settings.defaultMaxTokens ?? 4096,
      temperature: this.settings.defaultTemperature,
      top_p: this.settings.defaultTopP,
      stream: false,
      ...reasoningParams,
    });

    const choice = completion.choices[0];
    if (!choice || !choice.message) {
      throw new Error('No completion choice returned from Groq');
    }

    const content = choice.message.content || '';

    if (outputFormat === 'json') {
      try {
        JSON.parse(content);
      } catch (error) {
        logger.error(`Failed to parse JSON output: ${error instanceof Error ? error.message : String(error)}`);
        throw new Error('Failed to parse JSON output from model response');
      }
    }

    const contentArray: LlmContent[] = [{ contentType: 'text', text: content }];

    return {
      id: completion.id,
      content: contentArray,
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
  }

  /**
   * Generates a streaming response, injecting Groq reasoning parameters when configured.
   */
  override async generateStream(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<void> {
    const reasoningParams = this.buildGroqReasoningParams();
    if (Object.keys(reasoningParams).length === 0) {
      return super.generateStream(messages, options);
    }

    this.ensureInitialized();
    this.validateMessages(messages);

    if (!this.client) {
      throw new Error('OpenAI client not initialized');
    }

    if (options?.outputFormat && options.outputFormat !== 'text') {
      throw new Error(`Output format ${options.outputFormat} not supported for streaming generation`);
    }

    const openAIMessages = this.convertToOpenAIMessages(messages);

    try {
      logger.info(`Starting Groq Chat Completion streaming with model: ${this.settings.model}`);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = await (this.client.chat.completions.create as any)({
        model: this.settings.model,
        messages: openAIMessages,
        max_tokens: options?.maxTokens ?? this.settings.defaultMaxTokens ?? 4096,
        temperature: this.settings.defaultTemperature,
        top_p: this.settings.defaultTopP,
        stream: true,
        stream_options: { include_usage: true },
        ...reasoningParams,
      });

      let fullContent = '';
      let completionId = '';
      let finalFinishReason: string | null = null;
      let finalUsage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined;

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        completionId = chunk.id;

        if (choice.delta?.content) {
          fullContent += choice.delta.content;
          const mappedFinishReason = choice.finish_reason ? this.mapFinishReason(choice.finish_reason) : null;
          await this.notifyChunk(choice.delta.content, chunk.id, 'assistant', mappedFinishReason);
        }

        if (choice.finish_reason) {
          finalFinishReason = choice.finish_reason;
        }

        if (chunk.usage) {
          finalUsage = {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
          };
        }
      }

      const contentArray: LlmContent[] = [{ contentType: 'text', text: fullContent }];

      const result: LlmGenerationResult = {
        id: completionId,
        content: contentArray,
        role: 'assistant',
        finishReason: this.mapFinishReason(finalFinishReason),
        usage: finalUsage ? {
          promptTokens: finalUsage.promptTokens || 0,
          completionTokens: finalUsage.completionTokens || 0,
          totalTokens: finalUsage.totalTokens || 0,
        } : undefined,
        metadata: { model: this.settings.model },
      };

      await this.notifyComplete(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Groq Chat Completion streaming error: ${errorMessage}`);
      await this.notifyError(error instanceof Error ? error : new Error(errorMessage));
      throw error;
    }
  }

  /**
   * Enumerate available models via the Groq models API.
   * Falls back to a static list if the API call fails.
   */
  async enumerateModels(): Promise<LlmModelInfo[]> {
    if (this.client) {
      try {
        const page = await this.client.models.list();
        if (page.data.length > 0) {
          return page.data.map(m => ({ id: m.id, displayName: m.id, supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true }));
        }
      } catch (error) {
        logger.warn(`Failed to enumerate Groq models via API: ${error instanceof Error ? error.message : String(error)}, using static list`);
      }
    }
    return GroqLlmProvider.getGroqStaticModels();
  }

  /**
   * Builds Groq-specific reasoning parameters from settings.
   * Returns an empty object when no reasoning settings are configured.
   */
  private buildGroqReasoningParams(): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    if (this.groqSettings.reasoningFormat !== undefined) {
      params['reasoning_format'] = this.groqSettings.reasoningFormat;
    }
    if (this.groqSettings.reasoningEffort !== undefined) {
      params['reasoning_effort'] = this.groqSettings.reasoningEffort;
    }
    if (this.groqSettings.includeReasoning !== undefined) {
      params['include_reasoning'] = this.groqSettings.includeReasoning;
    }
    return params;
  }

  private static getGroqStaticModels(): LlmModelInfo[] {
    return [
      { id: 'openai/gpt-oss-120b', displayName: 'OpenAI GPT-OSS 120B', recommended: true, description: 'OpenAI flagship open-weight model with built-in browser search and code execution. Supports reasoning_effort (low/medium/high) and include_reasoning.', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, supportsReasoning: true, contextWindow: 131072 },
      { id: 'openai/gpt-oss-20b', displayName: 'OpenAI GPT-OSS 20B', description: 'Medium-sized open-weight model for low latency. Supports reasoning_effort (low/medium/high) and include_reasoning.', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, supportsReasoning: true, contextWindow: 131072 },
      { id: 'openai/gpt-oss-safeguard-20b', displayName: 'OpenAI GPT-OSS Safeguard 20B', description: 'Safety-focused open-weight model. Supports reasoning_effort (low/medium/high) and include_reasoning.', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, supportsReasoning: true, contextWindow: 131072 },
      { id: 'qwen/qwen3-32b', displayName: 'Qwen 3 32B', description: 'Qwen 3 model with reasoning capabilities. Supports reasoning_format (parsed/raw/hidden) and reasoning_effort (none/default).', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, supportsReasoning: true, contextWindow: 131072 },
      { id: 'llama-3.3-70b-versatile', displayName: 'Llama 3.3 70B Versatile', description: 'Latest Llama model with balanced capabilities', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, contextWindow: 131072 },
      { id: 'llama-3.1-70b-versatile', displayName: 'Llama 3.1 70B Versatile', description: 'Large model for complex tasks', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, contextWindow: 131072 },
      { id: 'llama-3.1-8b-instant', displayName: 'Llama 3.1 8B Instant', description: 'Ultra-fast model for simple tasks', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, contextWindow: 131072 },
      { id: 'gemma2-9b-it', displayName: 'Gemma 2 9B Instruct', description: 'Google Gemma 2 model for instruction following', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, contextWindow: 8192 },
    ];
  }
}
