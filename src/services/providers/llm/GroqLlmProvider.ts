import OpenAI from 'openai';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { OpenAILegacyLlmProvider, OpenAILegacyLlmSettings } from './OpenAILegacyLlmProvider';
import { logger } from '../../../utils/logger';
import type { LlmModelInfo } from '../ProviderCatalogService';

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
}).openapi('GroqLlmSettings');

export type GroqLlmSettings = z.infer<typeof groqLlmSettingsSchema>;

/**
 * Groq LLM provider using ultra-fast Groq inference via the OpenAI-compatible API.
 * Extends OpenAILegacyLlmProvider, overriding only the client creation and model enumeration.
 */
export class GroqLlmProvider extends OpenAILegacyLlmProvider<GroqLlmProviderConfig> {
  constructor(config: GroqLlmProviderConfig, settings: GroqLlmSettings) {
    super(config, settings as OpenAILegacyLlmSettings);
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

  private static getGroqStaticModels(): LlmModelInfo[] {
    return [
      { id: 'openai/gpt-oss-120b', displayName: 'OpenAI GPT-OSS 120B', recommended: true, description: 'OpenAI flagship open-weight model with built-in browser search and code execution', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, contextWindow: 131072 },
      { id: 'openai/gpt-oss-20b', displayName: 'OpenAI GPT-OSS 20B', description: 'Medium-sized open-weight model for low latency', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, contextWindow: 131072 },
      { id: 'llama-3.3-70b-versatile', displayName: 'Llama 3.3 70B Versatile', description: 'Latest Llama model with balanced capabilities', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, contextWindow: 131072 },
      { id: 'llama-3.1-70b-versatile', displayName: 'Llama 3.1 70B Versatile', description: 'Large model for complex tasks', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, contextWindow: 131072 },
      { id: 'llama-3.1-8b-instant', displayName: 'Llama 3.1 8B Instant', description: 'Ultra-fast model for simple tasks', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, contextWindow: 131072 },
      { id: 'gemma2-9b-it', displayName: 'Gemma 2 9B Instruct', description: 'Google Gemma 2 model for instruction following', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, contextWindow: 8192 },
    ];
  }
}
