import OpenAI from 'openai';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { OpenAILegacyLlmProvider, OpenAILegacyLlmSettings } from './OpenAILegacyLlmProvider';
import { logger } from '../../../utils/logger';
import type { LlmModelInfo } from '../ProviderCatalogService';

extendZodWithOpenApi(z);

/**
 * Schema for Ollama-specific provider configuration.
 * Supports both local Ollama (http://localhost:11434) and Ollama Cloud (https://ollama.com).
 */
export const ollamaLlmProviderConfigSchema = z.strictObject({
  baseUrl: z.string().optional().describe('Base URL of the Ollama server (defaults to http://localhost:11434 for local, or https://ollama.com for cloud)'),
  apiKey: z.string().optional().describe('API key — required for Ollama Cloud (ollama.com); ignored by local Ollama instances'),
});

export type OllamaLlmProviderConfig = z.infer<typeof ollamaLlmProviderConfigSchema>;

/**
 * Internal normalized config used as the generic type parameter — ensures apiKey and baseUrl are always strings.
 */
type OllamaNormalizedConfig = { baseUrl: string; apiKey: string };

/**
 * Schema for Ollama LLM settings
 */
export const ollamaLlmSettingsSchema = z.object({
  model: z.string().min(1).describe('Model name as pulled locally (e.g., llama3.2, gemma3, qwen3:8b)'),
  defaultMaxTokens: z.number().int().positive().optional().describe('Default maximum tokens for generation'),
  defaultTemperature: z.number().min(0).max(2).optional().describe('Default temperature for generation (0-2)'),
  defaultTopP: z.number().min(0).max(1).optional().describe('Default top-p for generation (0-1)'),
  timeout: z.number().int().positive().optional().describe('Request timeout in milliseconds'),
}).openapi('OllamaLlmSettings');

export type OllamaLlmSettings = z.infer<typeof ollamaLlmSettingsSchema>;

/**
 * Ollama LLM provider using the OpenAI-compatible `/v1/` API.
 * Supports both local Ollama (http://localhost:11434) and Ollama Cloud (https://ollama.com).
 * Extends OpenAILegacyLlmProvider, overriding only client creation, model enumeration, and moderation.
 */
export class OllamaLlmProvider extends OpenAILegacyLlmProvider<OllamaNormalizedConfig> {
  constructor(config: OllamaLlmProviderConfig, settings: OllamaLlmSettings) {
    const normalized: OllamaNormalizedConfig = {
      baseUrl: config.baseUrl ?? 'http://localhost:11434',
      apiKey: config.apiKey ?? 'ollama',
    };
    super(normalized, settings as OllamaLlmSettings & OpenAILegacyLlmSettings);
  }

  /**
   * Creates an OpenAI-compatible client pointed at the configured Ollama server.
   */
  protected createClient(): OpenAI {
    return new OpenAI({
      baseURL: `${this.config!.baseUrl}/v1`,
      apiKey: this.config!.apiKey,
      timeout: this.settings.timeout,
    });
  }

  /**
   * Initializes the Ollama provider.
   */
  async init(): Promise<void> {
    await super.init();
    logger.info(`Ollama LLM provider initialized with model: ${this.settings.model}, baseUrl: ${this.config!.baseUrl}`);
  }

  /**
   * Enumerates models available on the configured Ollama server via the OpenAI-compatible `/v1/models` endpoint.
   */
  async enumerateModels(): Promise<LlmModelInfo[]> {
    if (this.client) {
      try {
        const page = await this.client.models.list();
        return page.data.map(m => ({
          id: m.id,
          displayName: m.id,
          supportsToolCalling: true,
          supportsJsonOutput: true,
          supportsStreaming: true,
        }));
      } catch (error) {
        logger.warn(`Failed to enumerate Ollama models: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return [];
  }

  /**
   * Ollama does not provide a content moderation endpoint.
   * Always returns non-flagged to allow all content through.
   */
  async moderateUserInput(_input: string): Promise<{ flagged: boolean; categories: string[] }> {
    return { flagged: false, categories: [] };
  }
}
