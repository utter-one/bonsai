import OpenAI from 'openai';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { OpenAILegacyLlmProvider, OpenAILegacyLlmSettings } from './OpenAILegacyLlmProvider';
import { logger } from '../../../utils/logger';
import type { LlmModelInfo } from '../ProviderCatalogService';

extendZodWithOpenApi(z);

/**
 * Schema for Scaleway Generative APIs-specific provider configuration
 */
export const scalewayLlmProviderConfigSchema = z.strictObject({
  apiKey: z.string().describe('Scaleway API key'),
  baseUrl: z.string().optional().describe('Optional base URL override (defaults to https://api.scaleway.ai/v1)'),
});

export type ScalewayLlmProviderConfig = z.infer<typeof scalewayLlmProviderConfigSchema>;

/**
 * Schema for Scaleway Generative APIs LLM settings
 */
export const scalewayLlmSettingsSchema = z.object({
  model: z.string().min(1).describe('Model name (e.g., llama-3.3-70b-instruct, mistral-7b-instruct-v0.3)'),
  defaultMaxTokens: z.number().int().positive().optional().describe('Default maximum tokens for generation'),
  defaultTemperature: z.number().min(0).max(2).optional().describe('Default temperature for generation (0-2)'),
  defaultTopP: z.number().min(0).max(1).optional().describe('Default top-p for generation (0-1)'),
  timeout: z.number().int().positive().optional().describe('Request timeout in milliseconds'),
}).openapi('ScalewayLlmSettings');

export type ScalewayLlmSettings = z.infer<typeof scalewayLlmSettingsSchema>;

/**
 * Scaleway Generative APIs LLM provider using the OpenAI-compatible Scaleway API.
 * Extends OpenAILegacyLlmProvider, overriding only the client creation and model enumeration.
 */
export class ScalewayLlmProvider extends OpenAILegacyLlmProvider<ScalewayLlmProviderConfig> {
  constructor(config: ScalewayLlmProviderConfig, settings: ScalewayLlmSettings) {
    super(config, settings as OpenAILegacyLlmSettings);
  }

  /**
   * Creates an OpenAI client pointed at the Scaleway Generative APIs endpoint
   */
  protected createClient(): OpenAI {
    return new OpenAI({
      apiKey: this.config!.apiKey,
      baseURL: this.config!.baseUrl ?? 'https://api.scaleway.ai/v1',
      timeout: this.settings.timeout,
    });
  }

  /**
   * Enumerate available models via the Scaleway OpenAI-compatible models API.
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
            supportsReasoning: m.id.includes('deepseek-r1') || m.id.includes('reasoner'),
          }));
        }
      } catch (error) {
        logger.warn(`Failed to enumerate Scaleway models via API: ${error instanceof Error ? error.message : String(error)}, using static list`);
      }
    }
    return ScalewayLlmProvider.getScalewayStaticModels();
  }

  private static getScalewayStaticModels(): LlmModelInfo[] {
    return [
      { id: 'llama-3.3-70b-instruct', displayName: 'Llama 3.3 70B Instruct', recommended: true, description: 'Latest Meta Llama 3.3 70B instruction-tuned model', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsReasoning: false, contextWindow: 131072 },
      { id: 'llama-3.1-70b-instruct', displayName: 'Llama 3.1 70B Instruct', description: 'Meta Llama 3.1 70B instruction-tuned model', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsReasoning: false, contextWindow: 131072 },
      { id: 'llama-3.1-8b-instruct', displayName: 'Llama 3.1 8B Instruct', description: 'Meta Llama 3.1 8B fast and cost-efficient model', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsReasoning: false, contextWindow: 131072 },
      { id: 'mistral-7b-instruct-v0.3', displayName: 'Mistral 7B Instruct v0.3', description: 'Mistral 7B instruction-tuned model', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsReasoning: false, contextWindow: 32768 },
      { id: 'mixtral-8x7b-instruct-v0.1', displayName: 'Mixtral 8x7B Instruct', description: 'Mistral Mixtral MoE model for balanced performance', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsReasoning: false, contextWindow: 32768 },
    ];
  }
}
