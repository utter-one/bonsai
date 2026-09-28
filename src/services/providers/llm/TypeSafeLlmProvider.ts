import { TypeSafeClient, noul } from '@typesafe-ai/sdk';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { LlmProviderBase } from './LlmProviderBase';
import { LlmContent, LlmGenerationOptions, LlmGenerationResult, LlmMessage } from './ILlmProvider';
import type { LlmModelInfo } from '../ProviderCatalogService';
import { logger } from '../../../utils/logger';

extendZodWithOpenApi(z);

/**
 * Schema for TypeSafe (Jev) provider configuration.
 */
export const typesafeLlmProviderConfigSchema = z.strictObject({
  apiKey: z.string().describe('TypeSafe API key'),
  baseUrl: z.string().optional().describe('Optional base URL override (defaults to https://api.typesafe.ai)'),
});

export type TypeSafeLlmProviderConfig = z.infer<typeof typesafeLlmProviderConfigSchema>;

/**
 * Schema for TypeSafe (Jev) LLM settings.
 * Jev is a "System One" decision model: it answers a single yes/no (noul)
 * question about the rendered prompt and returns a calibrated probability.
 */
export const typesafeLlmSettingsSchema = z.object({
  model: z.string().min(1).describe('Model name (e.g., jev-latest, jev-preview, jev-1.13.0)'),
  defaultMaxTokens: z.number().int().positive().optional().describe('Default maximum tokens for generation (unused by Jev; present for LlmSettings union compatibility)'),
  timeout: z.number().int().positive().optional().describe('Request timeout in milliseconds (SDK default 10000)'),
  classificationThreshold: z.number().min(0).max(1).optional().describe('Noul probability at or above which the classifier emits the configured action (default 0.5)'),
}).openapi('TypeSafeLlmSettings');

export type TypeSafeLlmSettings = z.infer<typeof typesafeLlmSettingsSchema>;

/**
 * TypeSafe (Jev) LLM provider using the native @typesafe-ai/sdk.
 *
 * Jev is a decision model, not a chat model: `generate` adapts a rendered
 * classifier/guardrail prompt into a single noul question and emits the
 * `{"actions":{...}}` JSON the classification pipeline parses. It is intended
 * for single-condition classification and guardrail conditions — not for
 * free-form generation, parameterized tools, or multi-action prompts.
 */
export class TypeSafeLlmProvider extends LlmProviderBase<TypeSafeLlmProviderConfig> {
  private client?: TypeSafeClient;
  private settings: TypeSafeLlmSettings;

  constructor(config: TypeSafeLlmProviderConfig, settings: TypeSafeLlmSettings) {
    super(config);
    this.settings = settings;
  }

  /**
   * Initialize the TypeSafe provider.
   */
  async init(): Promise<void> {
    await super.init();

    this.client = new TypeSafeClient({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseUrl,
      defaultModel: this.settings.model,
      timeout: this.settings.timeout,
      logLevel: 'off',
    });

    logger.info(`TypeSafe LLM provider initialized with model: ${this.settings.model}`);
  }

  /**
   * Generate a non-streaming response.
   *
   * Adapts the rendered prompt (system message) into a single noul question and
   * the user input (last user message) into the state, then maps the calibrated
   * probability against the classification threshold to the `{"actions":{...}}`
   * JSON the classifier pipeline expects.
   */
  protected async doGenerate(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<LlmGenerationResult> {
    this.ensureInitialized();
    this.validateMessages(messages);

    if (!this.client) {
      throw new Error('TypeSafe client not initialized');
    }

    const instructions = this.extractTextContent(messages.filter((m) => m.role === 'system'));
    const state = this.extractTextContent(messages.filter((m) => m.role === 'user'));

    await this.notifyStarted();

    try {
      logger.info(`Generating TypeSafe (Jev) decision with model: ${this.settings.model}`);
      const requestBody = { state, questions: { condition: noul(instructions) } };
      logger.info(`TypeSafe request: baseURL=${this.client.baseURL} body=${JSON.stringify(requestBody)}`);

      const response = await this.client.systemOne(requestBody);

      logger.info(`TypeSafe raw response: ${JSON.stringify(response)}`);

      const probability = response.answers.condition.noul;
      const threshold = this.settings.classificationThreshold ?? 0.5;
      // Fixed sentinel: a classifier does not own an action name. The guardrail flow remaps this to the first guardrail's name.
      const actionName = 'match';
      const text = probability >= threshold ? JSON.stringify({ actions: { [actionName]: {} } }) : JSON.stringify({ actions: {} });
      logger.info(`TypeSafe decision: noul=${probability} threshold=${threshold} fired=${probability >= threshold} text=${text}`);

      const content: LlmContent[] = [{ contentType: 'text', text }];
      const result: LlmGenerationResult = {
        id: crypto.randomUUID(),
        content,
        role: 'assistant',
        finishReason: 'stop',
        usage: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        },
        metadata: { typesafe: { noul: probability, model: response.model } },
      };

      await this.notifyComplete(result);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`TypeSafe generation error: ${errorMessage}`);
      await this.notifyError(error instanceof Error ? error : new Error(errorMessage));
      throw error;
    }
  }

  /**
   * Jev has no streaming. Deliver the single noul result as one chunk so the
   * provider is technically usable anywhere, meaningful only for classification.
   */
  protected async doGenerateStream(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<void> {
    const result = await this.doGenerate(messages, options);
    const text = result.content[0] && result.content[0].contentType === 'text' ? (result.content[0] as { text: string }).text : '';
    await this.notifyChunk(text, result.id, 'assistant', 'stop', result.usage);
    await this.notifyComplete(result);
  }

  /**
   * Enumerate available Jev models via the API, falling back to a static list.
   */
  protected async doEnumerateModels(): Promise<LlmModelInfo[]> {
    if (this.client) {
      try {
        const models = await this.client.models.list();
        if (Array.isArray(models) && models.length > 0) {
          return models.map((m) => ({
            id: m.name,
            displayName: m.name,
            description: m.description,
            isDecisionModel: true,
            supportsToolCalling: false,
            supportsJsonOutput: true,
            supportsStreaming: false,
            supportsVision: false,
            supportsReasoning: false,
            contextWindow: 64000,
          }));
        }
      } catch (error) {
        logger.warn(`Failed to enumerate TypeSafe models via API: ${error instanceof Error ? error.message : String(error)}, using static list`);
      }
    }
    return TypeSafeLlmProvider.getStaticModels();
  }

  /**
   * Static Jev model list used when the models API is unavailable.
   */
  private static getStaticModels(): LlmModelInfo[] {
    return [
      { id: 'jev-latest', displayName: 'Jev (Latest)', recommended: true, description: 'TypeSafe flagship System One decision model — fast, calibrated structured answers for classification and guardrail conditions. Text input only; no free-form generation.', isDecisionModel: true, supportsToolCalling: false, supportsJsonOutput: true, supportsStreaming: false, supportsVision: false, supportsReasoning: false, contextWindow: 64000 },
      { id: 'jev-preview', displayName: 'Jev (Preview)', description: 'Latest Jev release (preview alias).', isDecisionModel: true, supportsToolCalling: false, supportsJsonOutput: true, supportsStreaming: false, supportsVision: false, supportsReasoning: false, contextWindow: 64000 },
    ];
  }
}
