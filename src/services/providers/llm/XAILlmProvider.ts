import OpenAI from 'openai';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { OpenAILegacyLlmProvider, OpenAILegacyLlmSettings } from './OpenAILegacyLlmProvider';
import { logger } from '../../../utils/logger';
import type { LlmModelInfo } from '../ProviderCatalogService';

extendZodWithOpenApi(z);

/**
 * Schema for xAI-specific provider configuration
 */
export const xAILlmProviderConfigSchema = z.strictObject({
  apiKey: z.string().describe('xAI API key'),
  baseUrl: z.string().optional().describe('Optional base URL override (defaults to https://api.x.ai/v1)'),
});

export type XAILlmProviderConfig = z.infer<typeof xAILlmProviderConfigSchema>;

/**
 * Schema for xAI LLM settings
 */
export const xAILlmSettingsSchema = z.object({
  model: z.string().min(1).describe('Model name (e.g., grok-3, grok-3-fast, grok-3-mini)'),
  defaultMaxTokens: z.number().int().positive().optional().describe('Default maximum tokens for generation'),
  defaultTemperature: z.number().min(0).max(2).optional().describe('Default temperature for generation (0-2)'),
  defaultTopP: z.number().min(0).max(1).optional().describe('Default top-p for generation (0-1)'),
  timeout: z.number().int().positive().optional().describe('Request timeout in milliseconds'),
}).openapi('XAILlmSettings');

export type XAILlmSettings = z.infer<typeof xAILlmSettingsSchema>;

/**
 * xAI (Grok) LLM provider using the OpenAI-compatible xAI API.
 * Extends OpenAILegacyLlmProvider, overriding only the client creation and model enumeration.
 */
export class XAILlmProvider extends OpenAILegacyLlmProvider<XAILlmProviderConfig> {
  constructor(config: XAILlmProviderConfig, settings: XAILlmSettings) {
    super(config, settings as OpenAILegacyLlmSettings);
  }

  /**
   * Creates an OpenAI client pointed at the xAI API endpoint
   */
  protected createClient(): OpenAI {
    return new OpenAI({
      apiKey: this.config!.apiKey,
      baseURL: this.config!.baseUrl ?? 'https://api.x.ai/v1',
      timeout: this.settings.timeout,
    });
  }

  /**
   * Enumerate available xAI (Grok) models via the API.
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
            supportsVision: m.id.includes('vision') || m.id.includes('2'),
          }));
        }
      } catch (error) {
        logger.warn(`Failed to enumerate xAI models via API: ${error instanceof Error ? error.message : String(error)}, using static list`);
      }
    }
    return XAILlmProvider.getXAIStaticModels();
  }

  private static getXAIStaticModels(): LlmModelInfo[] {
    return [
      { id: 'grok-3', displayName: 'Grok 3', recommended: true, description: 'xAI flagship model with frontier-level intelligence and broad knowledge', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, supportsReasoning: false, contextWindow: 131072 },
      { id: 'grok-3-fast', displayName: 'Grok 3 Fast', description: 'High-throughput Grok 3 model optimized for low-latency responses', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, supportsReasoning: false, contextWindow: 131072 },
      { id: 'grok-3-mini', displayName: 'Grok 3 Mini', description: 'Lightweight Grok 3 model for cost-efficient reasoning tasks', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, supportsReasoning: true, contextWindow: 131072 },
      { id: 'grok-3-mini-fast', displayName: 'Grok 3 Mini Fast', description: 'Fastest Grok 3 model for high-volume, latency-sensitive workloads', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, supportsReasoning: true, contextWindow: 131072 },
      { id: 'grok-2-vision-1212', displayName: 'Grok 2 Vision', description: 'Grok 2 variant with vision capabilities for image understanding', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: true, supportsReasoning: false, contextWindow: 32768 },
    ];
  }
}
