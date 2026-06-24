import OpenAI from 'openai';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { OpenAILegacyLlmProvider, OpenAILegacyLlmSettings } from './OpenAILegacyLlmProvider';
import { logger } from '../../../utils/logger';
import type { LlmModelInfo } from '../ProviderCatalogService';

extendZodWithOpenApi(z);

/**
 * Schema for OVH AI Endpoints-specific provider configuration
 */
export const ovhLlmProviderConfigSchema = z.strictObject({
  apiKey: z.string().describe('OVH AI Endpoints API key'),
  baseUrl: z.string().optional().describe('Optional base URL override (defaults to https://oai.endpoints.kepler.ai.cloud.ovh.net/v1)'),
});

export type OVHLlmProviderConfig = z.infer<typeof ovhLlmProviderConfigSchema>;

/**
 * Schema for OVH AI Endpoints LLM settings
 */
export const ovhLlmSettingsSchema = z.object({
  model: z.string().min(1).describe('Model name (e.g., llama-3.3-70b-instruct, mistral-7b-instruct-v0.3)'),
  defaultMaxTokens: z.number().int().positive().optional().describe('Default maximum tokens for generation'),
  defaultTemperature: z.number().min(0).max(2).optional().describe('Default temperature for generation (0-2)'),
  defaultTopP: z.number().min(0).max(1).optional().describe('Default top-p for generation (0-1)'),
  timeout: z.number().int().positive().optional().describe('Request timeout in milliseconds'),
}).openapi('OVHLlmSettings');

export type OVHLlmSettings = z.infer<typeof ovhLlmSettingsSchema>;

/**
 * OVH AI Endpoints LLM provider using the OpenAI-compatible OVH API.
 * Extends OpenAILegacyLlmProvider, overriding only the client creation and model enumeration.
 */
export class OVHLlmProvider extends OpenAILegacyLlmProvider<OVHLlmProviderConfig> {
  constructor(config: OVHLlmProviderConfig, settings: OVHLlmSettings) {
    super(config, settings as OpenAILegacyLlmSettings);
  }

  /**
   * Creates an OpenAI client pointed at the OVH AI Endpoints API
   */
  protected createClient(): OpenAI {
    return new OpenAI({
      apiKey: this.config!.apiKey,
      baseURL: this.config!.baseUrl ?? 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1',
      timeout: this.settings.timeout,
    });
  }

  /**
   * Enumerate available models via the OVH AI Endpoints OpenAI-compatible models API.
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
        logger.warn(`Failed to enumerate OVH AI Endpoints models via API: ${error instanceof Error ? error.message : String(error)}, using static list`);
      }
    }
    return OVHLlmProvider.getOVHStaticModels();
  }

  private static getOVHStaticModels(): LlmModelInfo[] {
    return [
      { id: 'llama-3.3-70b-instruct', displayName: 'Llama 3.3 70B Instruct', recommended: true, description: 'Latest Meta Llama 3.3 70B instruction-tuned model', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsReasoning: false, contextWindow: 131072 },
      { id: 'llama-3.1-70b-instruct', displayName: 'Llama 3.1 70B Instruct', description: 'Meta Llama 3.1 70B instruction-tuned model', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsReasoning: false, contextWindow: 131072 },
      { id: 'deepseek-r1-distill-qwen-14b', displayName: 'DeepSeek R1 Distill Qwen 14B', description: 'Distilled DeepSeek R1 reasoning model based on Qwen 14B', supportsToolCalling: false, supportsJsonOutput: true, supportsStreaming: true, supportsReasoning: true, contextWindow: 65536 },
      { id: 'mistral-7b-instruct-v0.3', displayName: 'Mistral 7B Instruct v0.3', description: 'Mistral 7B instruction-tuned model', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsReasoning: false, contextWindow: 32768 },
    ];
  }
}
