import OpenAI from 'openai';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { OpenAILegacyLlmProvider, OpenAILegacyLlmSettings } from './OpenAILegacyLlmProvider';
import { logger } from '../../../utils/logger';
import type { LlmModelInfo } from '../ProviderCatalogService';

extendZodWithOpenApi(z);

/**
 * Schema for Together AI-specific provider configuration
 */
export const togetherAILlmProviderConfigSchema = z.strictObject({
  apiKey: z.string().describe('Together AI API key'),
  baseUrl: z.string().optional().describe('Optional base URL override (defaults to https://api.together.xyz/v1)'),
});

export type TogetherAILlmProviderConfig = z.infer<typeof togetherAILlmProviderConfigSchema>;

/**
 * Schema for Together AI LLM settings
 */
export const togetherAILlmSettingsSchema = z.object({
  model: z.string().min(1).describe('Model name (e.g., meta-llama/Llama-3.3-70B-Instruct-Turbo, mistralai/Mixtral-8x22B-Instruct-v0.1)'),
  defaultMaxTokens: z.number().int().positive().optional().describe('Default maximum tokens for generation'),
  defaultTemperature: z.number().min(0).max(2).optional().describe('Default temperature for generation (0-2)'),
  defaultTopP: z.number().min(0).max(1).optional().describe('Default top-p for generation (0-1)'),
  timeout: z.number().int().positive().optional().describe('Request timeout in milliseconds'),
}).openapi('TogetherAILlmSettings');

export type TogetherAILlmSettings = z.infer<typeof togetherAILlmSettingsSchema>;

/**
 * Together AI LLM provider offering open-source models via an OpenAI-compatible API.
 * Extends OpenAILegacyLlmProvider, overriding only the client creation and model enumeration.
 */
export class TogetherAILlmProvider extends OpenAILegacyLlmProvider<TogetherAILlmProviderConfig> {
  constructor(config: TogetherAILlmProviderConfig, settings: TogetherAILlmSettings) {
    super(config, settings as OpenAILegacyLlmSettings);
  }

  /**
   * Creates an OpenAI client pointed at the Together AI API endpoint
   */
  protected createClient(): OpenAI {
    return new OpenAI({
      apiKey: this.config!.apiKey,
      baseURL: this.config!.baseUrl ?? 'https://api.together.xyz/v1',
      timeout: this.settings.timeout,
    });
  }

  /**
   * Enumerate available models via the Together AI models API.
   * Falls back to a static list if the API call fails.
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
        logger.warn(`Failed to enumerate Together AI models via API: ${error instanceof Error ? error.message : String(error)}, using static list`);
      }
    }
    return TogetherAILlmProvider.getTogetherStaticModels();
  }

  private static getTogetherStaticModels(): LlmModelInfo[] {
    return [
      { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', displayName: 'Llama 3.3 70B Instruct Turbo', recommended: true, description: 'Latest Meta Llama model, fast turbo variant', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, contextWindow: 131072 },
      { id: 'meta-llama/Llama-3.1-405B-Instruct-Turbo', displayName: 'Llama 3.1 405B Instruct Turbo', description: 'Largest Meta Llama model for complex tasks', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, contextWindow: 130815 },
      { id: 'meta-llama/Llama-3.1-8B-Instruct-Turbo', displayName: 'Llama 3.1 8B Instruct Turbo', description: 'Fast and cost-efficient small Llama model', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, contextWindow: 131072 },
      { id: 'mistralai/Mixtral-8x22B-Instruct-v0.1', displayName: 'Mixtral 8x22B Instruct', description: 'Large Mistral MoE model for complex reasoning', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, contextWindow: 65536 },
      { id: 'deepseek-ai/DeepSeek-R2', displayName: 'DeepSeek R2', description: 'Advanced reasoning model with chain-of-thought capabilities', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsReasoning: true, contextWindow: 65536 },
      { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo', displayName: 'Qwen 2.5 72B Instruct Turbo', description: 'Alibaba Qwen 2.5 large model', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, contextWindow: 32768 },
    ];
  }
}
