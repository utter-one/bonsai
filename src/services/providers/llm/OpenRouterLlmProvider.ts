import OpenAI from 'openai';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { OpenAILegacyLlmProvider, OpenAILegacyLlmSettings } from './OpenAILegacyLlmProvider';
import { logger } from '../../../utils/logger';
import type { LlmModelInfo } from '../ProviderCatalogService';

extendZodWithOpenApi(z);

/**
 * Schema for OpenRouter-specific provider configuration
 */
export const openRouterLlmProviderConfigSchema = z.strictObject({
  apiKey: z.string().describe('OpenRouter API key'),
  baseUrl: z.string().optional().describe('Optional base URL override (defaults to https://openrouter.ai/api/v1)'),
  httpReferer: z.string().optional().describe('Optional HTTP Referer header for OpenRouter rankings'),
  xTitle: z.string().optional().describe('Optional X-Title header for OpenRouter rankings'),
});

export type OpenRouterLlmProviderConfig = z.infer<typeof openRouterLlmProviderConfigSchema>;

/**
 * Schema for OpenRouter LLM settings
 */
export const openRouterLlmSettingsSchema = z.object({
  model: z.string().min(1).describe('Model name in OpenRouter format (e.g., openai/gpt-4o, anthropic/claude-3-5-sonnet, meta-llama/llama-3.3-70b-instruct)'),
  defaultMaxTokens: z.number().int().positive().optional().describe('Default maximum tokens for generation'),
  defaultTemperature: z.number().min(0).max(2).optional().describe('Default temperature for generation (0-2)'),
  defaultTopP: z.number().min(0).max(1).optional().describe('Default top-p for generation (0-1)'),
  timeout: z.number().int().positive().optional().describe('Request timeout in milliseconds'),
}).openapi('OpenRouterLlmSettings');

export type OpenRouterLlmSettings = z.infer<typeof openRouterLlmSettingsSchema>;

/**
 * OpenRouter LLM provider giving access to hundreds of models via a single OpenAI-compatible API.
 * Extends OpenAILegacyLlmProvider, overriding only the client creation and model enumeration.
 */
export class OpenRouterLlmProvider extends OpenAILegacyLlmProvider<OpenRouterLlmProviderConfig> {
  constructor(config: OpenRouterLlmProviderConfig, settings: OpenRouterLlmSettings) {
    super(config, settings as OpenAILegacyLlmSettings);
  }

  /**
   * Creates an OpenAI client pointed at the OpenRouter API endpoint
   */
  protected createClient(): OpenAI {
    const defaultHeaders: Record<string, string> = {};
    if (this.config!.httpReferer) defaultHeaders['HTTP-Referer'] = this.config!.httpReferer;
    if (this.config!.xTitle) defaultHeaders['X-Title'] = this.config!.xTitle;

    return new OpenAI({
      apiKey: this.config!.apiKey,
      baseURL: this.config!.baseUrl ?? 'https://openrouter.ai/api/v1',
      defaultHeaders,
      timeout: this.settings.timeout,
    });
  }

  /**
   * Enumerate available models via the OpenRouter models API.
   * Falls back to a static list of popular models if the API call fails.
   */
  async enumerateModels(): Promise<LlmModelInfo[]> {
    if (this.client) {
      try {
        const page = await this.client.models.list();
        if (page.data.length > 0) {
          return page.data.map(m => ({
            id: m.id,
            displayName: m.id,
            supportsToolCalling: true,
            supportsJsonOutput: true,
            supportsStreaming: true,
          }));
        }
      } catch (error) {
        logger.warn(`Failed to enumerate OpenRouter models via API: ${error instanceof Error ? error.message : String(error)}, using static list`);
      }
    }
    return OpenRouterLlmProvider.getOpenRouterStaticModels();
  }

  private static getOpenRouterStaticModels(): LlmModelInfo[] {
    return [
      { id: 'openai/gpt-4.1', displayName: 'OpenAI GPT-4.1', recommended: true, description: 'Latest OpenAI model via OpenRouter', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: true, contextWindow: 1047576 },
      { id: 'openai/o3', displayName: 'OpenAI o3', description: 'OpenAI reasoning model via OpenRouter', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsReasoning: true, contextWindow: 200000 },
      { id: 'anthropic/claude-opus-4-6', displayName: 'Anthropic Claude Opus 4.6', description: 'Most intelligent Claude model via OpenRouter', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: true, supportsReasoning: true, contextWindow: 200000 },
      { id: 'anthropic/claude-sonnet-4-6', displayName: 'Anthropic Claude Sonnet 4.6', description: 'Fast and capable Claude model via OpenRouter', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: true, supportsReasoning: true, contextWindow: 200000 },
      { id: 'google/gemini-2.5-pro', displayName: 'Google Gemini 2.5 Pro', description: 'Google flagship model via OpenRouter', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: true, supportsReasoning: true, contextWindow: 2000000 },
      { id: 'meta-llama/llama-3.3-70b-instruct', displayName: 'Meta Llama 3.3 70B Instruct', description: 'Latest Meta Llama model via OpenRouter', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, contextWindow: 131072 },
      { id: 'deepseek/deepseek-r2', displayName: 'DeepSeek R2', description: 'DeepSeek reasoning model via OpenRouter', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsReasoning: true, contextWindow: 65536 },
      { id: 'mistralai/mistral-large', displayName: 'Mistral Large', description: 'Mistral flagship model via OpenRouter', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: true, contextWindow: 131072 },
    ];
  }
}
