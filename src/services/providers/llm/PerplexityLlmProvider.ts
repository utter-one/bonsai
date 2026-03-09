import OpenAI from 'openai';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { OpenAILegacyLlmProvider, OpenAILegacyLlmSettings } from './OpenAILegacyLlmProvider';
import { logger } from '../../../utils/logger';
import type { LlmModelInfo } from '../ProviderCatalogService';

extendZodWithOpenApi(z);

/**
 * Schema for Perplexity-specific provider configuration
 */
export const perplexityLlmProviderConfigSchema = z.strictObject({
  apiKey: z.string().describe('Perplexity API key'),
  baseUrl: z.string().optional().describe('Optional base URL override (defaults to https://api.perplexity.ai)'),
});

export type PerplexityLlmProviderConfig = z.infer<typeof perplexityLlmProviderConfigSchema>;

/**
 * Schema for Perplexity LLM settings
 */
export const perplexityLlmSettingsSchema = z.object({
  model: z.string().min(1).describe('Model name (e.g., sonar-pro, sonar, sonar-reasoning-pro)'),
  defaultMaxTokens: z.number().int().positive().optional().describe('Default maximum tokens for generation'),
  defaultTemperature: z.number().min(0).max(2).optional().describe('Default temperature for generation (0-2)'),
  defaultTopP: z.number().min(0).max(1).optional().describe('Default top-p for generation (0-1)'),
  timeout: z.number().int().positive().optional().describe('Request timeout in milliseconds'),
}).openapi('PerplexityLlmSettings');

export type PerplexityLlmSettings = z.infer<typeof perplexityLlmSettingsSchema>;

/**
 * Perplexity LLM provider using the OpenAI-compatible Perplexity API.
 * Extends OpenAILegacyLlmProvider, overriding only the client creation and model enumeration.
 */
export class PerplexityLlmProvider extends OpenAILegacyLlmProvider<PerplexityLlmProviderConfig> {
  constructor(config: PerplexityLlmProviderConfig, settings: PerplexityLlmSettings) {
    super(config, settings as OpenAILegacyLlmSettings);
  }

  /**
   * Creates an OpenAI client pointed at the Perplexity API endpoint
   */
  protected createClient(): OpenAI {
    return new OpenAI({
      apiKey: this.config!.apiKey,
      baseURL: this.config!.baseUrl ?? 'https://api.perplexity.ai',
      timeout: this.settings.timeout,
    });
  }

  /**
   * Enumerate available Perplexity models using static list.
   * Perplexity does not expose a models list endpoint.
   */
  async enumerateModels(): Promise<LlmModelInfo[]> {
    return PerplexityLlmProvider.getPerplexityStaticModels();
  }

  private static getPerplexityStaticModels(): LlmModelInfo[] {
    return [
      { id: 'sonar-pro', displayName: 'Sonar Pro', recommended: true, description: 'Flagship Perplexity model with real-time web search and high accuracy', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, supportsReasoning: false, contextWindow: 127072 },
      { id: 'sonar', displayName: 'Sonar', description: 'Lightweight Perplexity model with real-time web search optimized for speed', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, supportsReasoning: false, contextWindow: 127072 },
      { id: 'sonar-reasoning-pro', displayName: 'Sonar Reasoning Pro', description: 'Advanced reasoning model with web search and chain-of-thought capabilities', supportsToolCalling: false, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, supportsReasoning: true, contextWindow: 127072 },
      { id: 'sonar-reasoning', displayName: 'Sonar Reasoning', description: 'Fast reasoning model with web search', supportsToolCalling: false, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, supportsReasoning: true, contextWindow: 127072 },
      { id: 'sonar-deep-research', displayName: 'Sonar Deep Research', description: 'Expert-level research model performing exhaustive multi-step web searches', supportsToolCalling: false, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, supportsReasoning: true, contextWindow: 127072 },
      { id: 'r1-1776', displayName: 'R1-1776', description: 'Fine-tuned DeepSeek R1 model providing unbiased, uncensored responses', supportsToolCalling: false, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, supportsReasoning: true, contextWindow: 127072 },
    ];
  }
}
