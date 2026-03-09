import OpenAI from 'openai';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { OpenAILegacyLlmProvider, OpenAILegacyLlmSettings } from './OpenAILegacyLlmProvider';
import { logger } from '../../../utils/logger';
import type { LlmModelInfo } from '../ProviderCatalogService';

extendZodWithOpenApi(z);

/**
 * Schema for Fireworks AI-specific provider configuration
 */
export const fireworksAILlmProviderConfigSchema = z.strictObject({
  apiKey: z.string().describe('Fireworks AI API key'),
  baseUrl: z.string().optional().describe('Optional base URL override (defaults to https://api.fireworks.ai/inference/v1)'),
});

export type FireworksAILlmProviderConfig = z.infer<typeof fireworksAILlmProviderConfigSchema>;

/**
 * Schema for Fireworks AI LLM settings
 */
export const fireworksAILlmSettingsSchema = z.object({
  model: z.string().min(1).describe('Model name in Fireworks format (e.g., accounts/fireworks/models/llama-v3p3-70b-instruct)'),
  defaultMaxTokens: z.number().int().positive().optional().describe('Default maximum tokens for generation'),
  defaultTemperature: z.number().min(0).max(2).optional().describe('Default temperature for generation (0-2)'),
  defaultTopP: z.number().min(0).max(1).optional().describe('Default top-p for generation (0-1)'),
  timeout: z.number().int().positive().optional().describe('Request timeout in milliseconds'),
}).openapi('FireworksAILlmSettings');

export type FireworksAILlmSettings = z.infer<typeof fireworksAILlmSettingsSchema>;

/**
 * Fireworks AI LLM provider offering fast open-source model inference via an OpenAI-compatible API.
 * Extends OpenAILegacyLlmProvider, overriding only the client creation and model enumeration.
 */
export class FireworksAILlmProvider extends OpenAILegacyLlmProvider<FireworksAILlmProviderConfig> {
  constructor(config: FireworksAILlmProviderConfig, settings: FireworksAILlmSettings) {
    super(config, settings as OpenAILegacyLlmSettings);
  }

  /**
   * Creates an OpenAI client pointed at the Fireworks AI API endpoint
   */
  protected createClient(): OpenAI {
    return new OpenAI({
      apiKey: this.config!.apiKey,
      baseURL: this.config!.baseUrl ?? 'https://api.fireworks.ai/inference/v1',
      timeout: this.settings.timeout,
    });
  }

  /**
   * Enumerate available models via the Fireworks AI models API.
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
        logger.warn(`Failed to enumerate Fireworks AI models via API: ${error instanceof Error ? error.message : String(error)}, using static list`);
      }
    }
    return FireworksAILlmProvider.getFireworksStaticModels();
  }

  private static getFireworksStaticModels(): LlmModelInfo[] {
    return [
      { id: 'accounts/fireworks/models/llama-v3p3-70b-instruct', displayName: 'Llama 3.3 70B Instruct', recommended: true, description: 'Latest Meta Llama model optimised for fast inference on Fireworks', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, contextWindow: 131072 },
      { id: 'accounts/fireworks/models/llama-v3p1-405b-instruct', displayName: 'Llama 3.1 405B Instruct', description: 'Largest Meta Llama model for complex tasks', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, contextWindow: 131072 },
      { id: 'accounts/fireworks/models/llama-v3p1-8b-instruct', displayName: 'Llama 3.1 8B Instruct', description: 'Fast and cost-efficient small Llama model', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, contextWindow: 131072 },
      { id: 'accounts/fireworks/models/deepseek-r2', displayName: 'DeepSeek R2', description: 'Advanced reasoning model with chain-of-thought capabilities', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsReasoning: true, contextWindow: 65536 },
      { id: 'accounts/fireworks/models/mixtral-8x22b-instruct', displayName: 'Mixtral 8x22B Instruct', description: 'Large Mistral MoE model for complex reasoning', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, contextWindow: 65536 },
      { id: 'accounts/fireworks/models/qwen2p5-72b-instruct', displayName: 'Qwen 2.5 72B Instruct', description: 'Alibaba Qwen 2.5 large model', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, contextWindow: 32768 },
    ];
  }
}
