import { singleton } from 'tsyringe';
import { logger } from '../../../utils/logger';
import type { Provider } from '../../../types/models';
import type { ILlmProvider } from './ILlmProvider';
import { OpenAILlmProvider, OpenAILlmProviderConfig, openAILlmProviderConfigSchema, OpenAILlmSettings } from './OpenAILlmProvider';
import { OpenAILegacyLlmProvider, OpenAILegacyLlmProviderConfig, openAILegacyLlmProviderConfigSchema, OpenAILegacyLlmSettings } from './OpenAILegacyLlmProvider';
import { AnthropicLlmProvider, AnthropicLlmProviderConfig, anthropicLlmProviderConfigSchema, AnthropicLlmSettings } from './AnthropicLlmProvider';
import { GeminiLlmProvider, GeminiLlmProviderConfig, geminiLlmProviderConfigSchema, GeminiLlmSettings } from './GeminiLlmProvider';
import { GroqLlmProvider, GroqLlmProviderConfig, groqLlmProviderConfigSchema, GroqLlmSettings } from './GroqLlmProvider';
import { MistralLlmProvider, MistralLlmProviderConfig, mistralLlmProviderConfigSchema, MistralLlmSettings } from './MistralLlmProvider';
import { DeepSeekLlmProvider, DeepSeekLlmProviderConfig, deepSeekLlmProviderConfigSchema, DeepSeekLlmSettings } from './DeepSeekLlmProvider';
import { OpenRouterLlmProvider, OpenRouterLlmProviderConfig, openRouterLlmProviderConfigSchema, OpenRouterLlmSettings } from './OpenRouterLlmProvider';
import { TogetherAILlmProvider, TogetherAILlmProviderConfig, togetherAILlmProviderConfigSchema, TogetherAILlmSettings } from './TogetherAILlmProvider';
import { FireworksAILlmProvider, FireworksAILlmProviderConfig, fireworksAILlmProviderConfigSchema, FireworksAILlmSettings } from './FireworksAILlmProvider';
import { PerplexityLlmProvider, PerplexityLlmProviderConfig, perplexityLlmProviderConfigSchema, PerplexityLlmSettings } from './PerplexityLlmProvider';
import { CohereLlmProvider, CohereLlmProviderConfig, cohereLlmProviderConfigSchema, CohereLlmSettings } from './CohereLlmProvider';
import { XAILlmProvider, XAILlmProviderConfig, xAILlmProviderConfigSchema, XAILlmSettings } from './XAILlmProvider';
import { OllamaLlmProvider, OllamaLlmProviderConfig, ollamaLlmProviderConfigSchema, OllamaLlmSettings } from './OllamaLlmProvider';

/**
 * Supported LLM provider API types
 */
export type LlmProviderApiType = 'openai' | 'openai-legacy' | 'anthropic' | 'gemini' | 'groq' | 'mistral' | 'deepseek' | 'openrouter' | 'together-ai' | 'fireworks-ai' | 'perplexity' | 'cohere' | 'xai' | 'ollama';

/**
 * Union type for all LLM provider settings
 */
export type LlmSettings = OpenAILlmSettings | OpenAILegacyLlmSettings | AnthropicLlmSettings | GeminiLlmSettings | GroqLlmSettings | MistralLlmSettings | DeepSeekLlmSettings | OpenRouterLlmSettings | TogetherAILlmSettings | FireworksAILlmSettings | PerplexityLlmSettings | CohereLlmSettings | XAILlmSettings | OllamaLlmSettings;

/**
 * Union type for all LLM provider configurations
 */
export type LlmProviderConfig = OpenAILlmProviderConfig | OpenAILegacyLlmProviderConfig | AnthropicLlmProviderConfig | GeminiLlmProviderConfig | GroqLlmProviderConfig | MistralLlmProviderConfig | DeepSeekLlmProviderConfig | OpenRouterLlmProviderConfig | TogetherAILlmProviderConfig | FireworksAILlmProviderConfig | PerplexityLlmProviderConfig | CohereLlmProviderConfig | XAILlmProviderConfig | OllamaLlmProviderConfig;

/**
 * Factory service for creating LLM provider instances based on provider entity configuration
 * Handles provider instantiation and configuration mapping from database entities to provider-specific configs
 */
@singleton()
export class LlmProviderFactory {
  /**
   * Creates an LLM provider instance from a provider entity
   * @param provider - Provider entity from database containing configuration
   * @param settings - LLM settings including the required model field
   * @returns Configured and initialized LLM provider instance
   * @throws {Error} When provider type is not 'llm', API type is not supported, or model is missing
   */
  createProvider(provider: Provider, settings: LlmSettings): ILlmProvider {
    if (provider.providerType !== 'llm') {
      const errorMessage = `Provider ${provider.id} is not an LLM provider. Expected providerType 'llm', got '${provider.providerType}'`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    if (!settings.model) {
      const errorMessage = `Invalid LLM provider settings for provider ${provider.id}. Required field: model`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    logger.info(`Creating ${provider.apiType} LLM provider for provider ${provider.id} with model ${settings.model}`);
    const instance = this.instantiateProvider(provider, settings);
    instance.init();
    return instance;
  }

  /**
   * Creates an LLM provider instance with minimal/default settings for model enumeration purposes.
   * The returned instance should only be used to call `enumerateModels()`, not for generation.
   * @param provider - Provider entity from database containing configuration
   * @returns LLM provider instance suitable for calling enumerateModels()
   * @throws {Error} When provider type is not 'llm' or API type is not supported
   */
  createProviderForEnumeration(provider: Provider): ILlmProvider {
    if (provider.providerType !== 'llm') {
      const errorMessage = `Provider ${provider.id} is not an LLM provider. Expected providerType 'llm', got '${provider.providerType}'`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    return this.instantiateProvider(provider, { model: '' } as LlmSettings);
  }

  /**
   * Parses provider config and instantiates the correct provider class without validation or init.
   * @param provider - Provider entity
   * @param settings - LLM settings (may have empty model for enumeration)
   * @returns Uninitialised LLM provider instance
   */
  private instantiateProvider(provider: Provider, settings: LlmSettings): ILlmProvider {
    switch (provider.apiType) {
      case 'openai':
        return new OpenAILlmProvider(openAILlmProviderConfigSchema.parse(provider.config), settings as OpenAILlmSettings);

      case 'openai-legacy':
        return new OpenAILegacyLlmProvider(openAILegacyLlmProviderConfigSchema.parse(provider.config), settings as OpenAILegacyLlmSettings);

      case 'anthropic':
        return new AnthropicLlmProvider(anthropicLlmProviderConfigSchema.parse(provider.config), settings as AnthropicLlmSettings);

      case 'gemini':
        return new GeminiLlmProvider(geminiLlmProviderConfigSchema.parse(provider.config), settings as GeminiLlmSettings);

      case 'groq':
        return new GroqLlmProvider(groqLlmProviderConfigSchema.parse(provider.config), settings as GroqLlmSettings);

      case 'mistral':
        return new MistralLlmProvider(mistralLlmProviderConfigSchema.parse(provider.config), settings as MistralLlmSettings);

      case 'deepseek':
        return new DeepSeekLlmProvider(deepSeekLlmProviderConfigSchema.parse(provider.config), settings as DeepSeekLlmSettings);

      case 'openrouter':
        return new OpenRouterLlmProvider(openRouterLlmProviderConfigSchema.parse(provider.config), settings as OpenRouterLlmSettings);

      case 'together-ai':
        return new TogetherAILlmProvider(togetherAILlmProviderConfigSchema.parse(provider.config), settings as TogetherAILlmSettings);

      case 'fireworks-ai':
        return new FireworksAILlmProvider(fireworksAILlmProviderConfigSchema.parse(provider.config), settings as FireworksAILlmSettings);

      case 'perplexity':
        return new PerplexityLlmProvider(perplexityLlmProviderConfigSchema.parse(provider.config), settings as PerplexityLlmSettings);

      case 'cohere':
        return new CohereLlmProvider(cohereLlmProviderConfigSchema.parse(provider.config), settings as CohereLlmSettings);

      case 'xai':
        return new XAILlmProvider(xAILlmProviderConfigSchema.parse(provider.config), settings as XAILlmSettings);

      case 'ollama':
        return new OllamaLlmProvider(ollamaLlmProviderConfigSchema.parse(provider.config), settings as OllamaLlmSettings);

      default: {
        const errorMessage = `Unsupported LLM provider API type: ${provider.apiType}. Supported types: openai, openai-legacy, anthropic, gemini, groq, mistral, deepseek, openrouter, together-ai, fireworks-ai, perplexity, cohere, xai, ollama`;
        logger.error(errorMessage);
        throw new Error(errorMessage);
      }
    }
  }

  /**
   * Validates if a provider can be used for LLM
   * @param provider - Provider entity to validate
   * @returns True if provider is valid for LLM, false otherwise
   */
  isValidLlmProvider(provider: Provider): boolean {
    if (provider.providerType !== 'llm') {
      return false;
    }

    const supportedApiTypes: LlmProviderApiType[] = ['openai', 'openai-legacy', 'anthropic', 'gemini', 'groq', 'mistral', 'deepseek', 'openrouter', 'together-ai', 'fireworks-ai', 'perplexity', 'cohere', 'xai', 'ollama'];
    return supportedApiTypes.includes(provider.apiType as LlmProviderApiType);
  }

  /**
   * Gets list of supported LLM provider API types
   * @returns Array of supported API types
   */
  getSupportedApiTypes(): LlmProviderApiType[] {
    return ['openai', 'openai-legacy', 'anthropic', 'gemini', 'groq', 'mistral', 'deepseek', 'openrouter', 'together-ai', 'fireworks-ai', 'perplexity', 'cohere', 'xai', 'ollama'];
  }
}
