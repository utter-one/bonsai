import OpenAI from 'openai';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { OpenAILegacyLlmProvider, OpenAILegacyLlmSettings } from './OpenAILegacyLlmProvider';
import { logger } from '../../../utils/logger';
import type { LlmModelInfo } from '../ProviderCatalogService';

extendZodWithOpenApi(z);

/**
 * Schema for DeepSeek-specific provider configuration
 */
export const deepSeekLlmProviderConfigSchema = z.strictObject({
  apiKey: z.string().describe('DeepSeek API key'),
  baseUrl: z.string().optional().describe('Optional base URL override (defaults to https://api.deepseek.com/v1)'),
});

export type DeepSeekLlmProviderConfig = z.infer<typeof deepSeekLlmProviderConfigSchema>;

/**
 * Schema for DeepSeek LLM settings
 */
export const deepSeekLlmSettingsSchema = z.object({
  model: z.string().min(1).describe('Model name (e.g., deepseek-chat, deepseek-reasoner)'),
  defaultMaxTokens: z.number().int().positive().optional().describe('Default maximum tokens for generation'),
  defaultTemperature: z.number().min(0).max(2).optional().describe('Default temperature for generation (0-2)'),
  defaultTopP: z.number().min(0).max(1).optional().describe('Default top-p for generation (0-1)'),
  timeout: z.number().int().positive().optional().describe('Request timeout in milliseconds'),
}).openapi('DeepSeekLlmSettings');

export type DeepSeekLlmSettings = z.infer<typeof deepSeekLlmSettingsSchema>;

/**
 * DeepSeek LLM provider using the OpenAI-compatible DeepSeek API.
 * Extends OpenAILegacyLlmProvider, overriding only the client creation and model enumeration.
 */
export class DeepSeekLlmProvider extends OpenAILegacyLlmProvider<DeepSeekLlmProviderConfig> {
  constructor(config: DeepSeekLlmProviderConfig, settings: DeepSeekLlmSettings) {
    super(config, settings as OpenAILegacyLlmSettings);
  }

  /**
   * Creates an OpenAI client pointed at the DeepSeek API endpoint
   */
  protected createClient(): OpenAI {
    return new OpenAI({
      apiKey: this.config!.apiKey,
      baseURL: this.config!.baseUrl ?? 'https://api.deepseek.com/v1',
      timeout: this.settings.timeout,
    });
  }

  /**
   * Enumerate available models via the DeepSeek OpenAI-compatible models API.
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
            supportsReasoning: m.id.includes('reasoner'),
          }));
        }
      } catch (error) {
        logger.warn(`Failed to enumerate DeepSeek models via API: ${error instanceof Error ? error.message : String(error)}, using static list`);
      }
    }
    return DeepSeekLlmProvider.getDeepSeekStaticModels();
  }

  private static getDeepSeekStaticModels(): LlmModelInfo[] {
    return [
      { id: 'deepseek-chat', displayName: 'DeepSeek V3', recommended: true, description: 'Flagship chat model (DeepSeek-V3) with strong coding and reasoning capabilities', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsReasoning: false, contextWindow: 65536 },
      { id: 'deepseek-reasoner', displayName: 'DeepSeek R2', description: 'Advanced reasoning model with chain-of-thought capabilities', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsReasoning: true, contextWindow: 65536 },
    ];
  }
}
