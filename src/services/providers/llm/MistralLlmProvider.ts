import OpenAI from 'openai';
import { Mistral } from '@mistralai/mistralai';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { OpenAILegacyLlmProvider, OpenAILegacyLlmSettings } from './OpenAILegacyLlmProvider';
import { logger } from '../../../utils/logger';
import type { LlmModelInfo } from '../ProviderCatalogService';

extendZodWithOpenApi(z);

/**
 * Schema for Mistral AI-specific provider configuration
 */
export const mistralLlmProviderConfigSchema = z.strictObject({
  apiKey: z.string().describe('Mistral AI API key'),
  baseUrl: z.string().optional().describe('Optional base URL override (defaults to https://api.mistral.ai/v1)'),
});

export type MistralLlmProviderConfig = z.infer<typeof mistralLlmProviderConfigSchema>;

/**
 * Schema for Mistral AI LLM settings
 */
export const mistralLlmSettingsSchema = z.object({
  model: z.string().min(1).describe('Model name (e.g., mistral-large-latest, mistral-small-latest)'),
  defaultMaxTokens: z.number().int().positive().optional().describe('Default maximum tokens for generation'),
  defaultTemperature: z.number().min(0).max(2).optional().describe('Default temperature for generation (0-2)'),
  defaultTopP: z.number().min(0).max(1).optional().describe('Default top-p for generation (0-1)'),
  timeout: z.number().int().positive().optional().describe('Request timeout in milliseconds'),
}).openapi('MistralLlmSettings');

export type MistralLlmSettings = z.infer<typeof mistralLlmSettingsSchema>;

/**
 * Mistral AI LLM provider using the OpenAI-compatible API for chat completions
 * and the native Mistral SDK for accurate model enumeration.
 * Extends OpenAILegacyLlmProvider, overriding client creation and model enumeration.
 */
export class MistralLlmProvider extends OpenAILegacyLlmProvider<MistralLlmProviderConfig> {
  private mistralClient?: Mistral;

  constructor(config: MistralLlmProviderConfig, settings: MistralLlmSettings) {
    super(config, settings as OpenAILegacyLlmSettings);
  }

  /**
   * Initialize the Mistral provider.
   * Creates both the OpenAI-compatible client (for chat) and the native Mistral client (for model listing).
   */
  async init(): Promise<void> {
    await super.init();
    this.mistralClient = new Mistral({
      apiKey: this.config!.apiKey,
      serverURL: this.config!.baseUrl,
    });
    logger.info(`Mistral AI LLM provider initialized with model: ${this.settings.model}`);
  }

  /**
   * Creates an OpenAI client pointed at the Mistral AI OpenAI-compatible endpoint
   */
  protected createClient(): OpenAI {
    return new OpenAI({
      apiKey: this.config!.apiKey,
      baseURL: this.config!.baseUrl ?? 'https://api.mistral.ai/v1',
      timeout: this.settings.timeout,
    });
  }

  /**
   * Enumerate available models using the native Mistral SDK.
   * Falls back to a static list if the API call fails.
   */
  async enumerateModels(): Promise<LlmModelInfo[]> {
    if (this.mistralClient) {
      try {
        const modelList = await this.mistralClient.models.list();
        const chatModels = (modelList.data ?? []).filter(m => m.capabilities.completionChat);
        if (chatModels.length > 0) {
          return chatModels.map(m => ({
            id: m.id,
            displayName: m.name ?? m.id,
            description: m.description ?? undefined,
            supportsToolCalling: m.capabilities.functionCalling ?? false,
            supportsJsonOutput: true,
            supportsStreaming: true,
            supportsVision: m.capabilities.vision ?? false,
            contextWindow: m.maxContextLength,
          }));
        }
      } catch (error) {
        logger.warn(`Failed to enumerate Mistral models via API: ${error instanceof Error ? error.message : String(error)}, using static list`);
      }
    }
    return MistralLlmProvider.getMistralStaticModels();
  }

  private static getMistralStaticModels(): LlmModelInfo[] {
    return [
      { id: 'mistral-large-latest', displayName: 'Mistral Large', recommended: true, description: 'Top-tier reasoning model for sophisticated tasks', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: true, contextWindow: 131072 },
      { id: 'mistral-small-latest', displayName: 'Mistral Small', description: 'Cost-efficient model for simple tasks', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: true, contextWindow: 131072 },
      { id: 'codestral-latest', displayName: 'Codestral', description: 'Specialized model for code generation and completion', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, contextWindow: 262144 },
      { id: 'mistral-saba-latest', displayName: 'Mistral Saba', description: 'High-performance model for Middle Eastern and South Asian languages', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, contextWindow: 32768 },
      { id: 'open-mistral-nemo', displayName: 'Mistral NeMo', description: 'Open-source model with a 128k context window', supportsToolCalling: true, supportsJsonOutput: true, supportsStreaming: true, supportsVision: false, contextWindow: 131072 },
    ];
  }
}
