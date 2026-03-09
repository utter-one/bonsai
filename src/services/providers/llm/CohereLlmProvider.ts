import OpenAI from 'openai';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { OpenAILegacyLlmProvider, OpenAILegacyLlmSettings } from './OpenAILegacyLlmProvider';
import { logger } from '../../../utils/logger';
import type { LlmModelInfo } from '../ProviderCatalogService';

extendZodWithOpenApi(z);

/**
 * Schema for Cohere-specific provider configuration
 */
export const cohereLlmProviderConfigSchema = z.strictObject({
  apiKey: z.string().describe('Cohere API key'),
  baseUrl: z.string().optional().describe('Optional base URL override (defaults to https://api.cohere.com/compatibility/v1)'),
});

export type CohereLlmProviderConfig = z.infer<typeof cohereLlmProviderConfigSchema>;

/**
 * Schema for Cohere LLM settings
 */
export const cohereLlmSettingsSchema = z.object({
  model: z.string().min(1).describe('Model name (e.g., command-a-03-2025, command-r-plus-08-2024)'),
  defaultMaxTokens: z.number().int().positive().optional().describe('Default maximum tokens for generation'),
  defaultTemperature: z.number().min(0).max(2).optional().describe('Default temperature for generation (0-2)'),
  defaultTopP: z.number().min(0).max(1).optional().describe('Default top-p for generation (0-1)'),
  timeout: z.number().int().positive().optional().describe('Request timeout in milliseconds'),
}).openapi('CohereLlmSettings');

export type CohereLlmSettings = z.infer<typeof cohereLlmSettingsSchema>;

/**
 * Cohere LLM provider using the OpenAI-compatible Cohere compatibility API.
 * Extends OpenAILegacyLlmProvider, overriding only the client creation and model enumeration.
 */
export class CohereLlmProvider extends OpenAILegacyLlmProvider<CohereLlmProviderConfig> {
  constructor(config: CohereLlmProviderConfig, settings: CohereLlmSettings) {
    super(config, settings as OpenAILegacyLlmSettings);
  }

  /**
   * Creates an OpenAI client pointed at the Cohere compatibility API endpoint
   */
  protected createClient(): OpenAI {
    return new OpenAI({
      apiKey: this.config!.apiKey,
      baseURL: this.config!.baseUrl ?? 'https://api.cohere.com/compatibility/v1',
      timeout: this.settings.timeout,
    });
  }

  /**
   * Enumerate available Cohere models via the compatibility API.
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
        logger.warn(`Failed to enumerate Cohere models via API: ${error instanceof Error ? error.message : String(error)}, using static list`);
      }
    }
    return CohereLlmProvider.getCohereStaticModels();
  }

  private static getCohereStaticModels(): LlmModelInfo[] {
    return [
      { id: 'command-a-03-2025', displayName: 'Command A', recommended: true, description: 'Flagship Command model with best-in-class RAG, tool use, and agentic capabilities', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, supportsReasoning: false, contextWindow: 256000 },
      { id: 'command-r-plus-08-2024', displayName: 'Command R+ (Aug 2024)', description: 'Advanced Command model optimized for complex RAG workflows and multi-step tool use', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, supportsReasoning: false, contextWindow: 128000 },
      { id: 'command-r-08-2024', displayName: 'Command R (Aug 2024)', description: 'Balanced Command model for RAG and tool use with a focus on low latency', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, supportsReasoning: false, contextWindow: 128000 },
      { id: 'command-r7b-12-2024', displayName: 'Command R7B (Dec 2024)', description: 'Lightweight Command model for fast inference and cost-efficient deployments', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, supportsReasoning: false, contextWindow: 128000 },
    ];
  }
}
