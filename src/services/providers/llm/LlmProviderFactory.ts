import { singleton } from 'tsyringe';
import { logger } from '../../../utils/logger';
import type { Provider } from '../../../types/models';
import type { ILlmProvider } from './ILlmProvider';
import { OpenAILlmProvider, OpenAILlmProviderConfig, OpenAILlmSettings } from './OpenAILlmProvider';
import { OpenAILegacyLlmProvider, OpenAILegacyLlmProviderConfig, OpenAILegacyLlmSettings } from './OpenAILegacyLlmProvider';
import { AnthropicLlmProvider, AnthropicLlmProviderConfig, AnthropicLlmSettings } from './AnthropicLlmProvider';
import { GeminiLlmProvider, GeminiLlmProviderConfig, GeminiLlmSettings } from './GeminiLlmProvider';

/**
 * Supported LLM provider API types
 */
export type LlmProviderApiType = 'openai' | 'openai-legacy' | 'anthropic' | 'gemini' | 'groq' | 'vertex';

/**
 * Union type for all LLM provider settings
 */
export type LlmSettings = OpenAILlmSettings | OpenAILegacyLlmSettings | AnthropicLlmSettings | GeminiLlmSettings;

/**
 * Factory service for creating LLM provider instances based on provider entity configuration
 * Handles provider instantiation and configuration mapping from database entities to provider-specific configs
 */
@singleton()
export class LlmProviderFactory {
  /**
   * Creates an LLM provider instance from a provider entity
   * @param provider - Provider entity from database containing configuration
   * @returns Configured LLM provider instance
   * @throws {Error} When provider type is not 'llm' or when API type is not supported
   */
  createProvider(provider: Provider, settings: LlmSettings): ILlmProvider {
    // Validate provider type
    if (provider.providerType !== 'llm') {
      const errorMessage = `Provider ${provider.id} is not an LLM provider. Expected providerType 'llm', got '${provider.providerType}'`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    // Create provider instance based on API type
    switch (provider.apiType) {
      case 'openai':
        return this.createOpenAIProvider(provider, settings as OpenAILlmSettings);

      case 'openai-legacy':
      case 'groq': // Groq uses OpenAI-compatible API        
        return this.createOpenAILegacyProvider(provider, settings as OpenAILegacyLlmSettings);

      case 'anthropic':
        return this.createAnthropicProvider(provider, settings as AnthropicLlmSettings);

      case 'gemini':
      case 'vertex': // Vertex AI uses Gemini API
        return this.createGeminiProvider(provider, settings as GeminiLlmSettings);
      default:
        const errorMessage = `Unsupported LLM provider API type: ${provider.apiType}. Supported types: openai, openai-legacy, anthropic, gemini, groq, vertex`;
        logger.error(errorMessage);
        throw new Error(errorMessage);
    }
  }

  /**
   * Creates an OpenAI LLM provider instance from provider entity
   * Also supports OpenAI-compatible APIs like Groq
   * @param provider - Provider entity with OpenAI-specific configuration
   * @returns Configured OpenAI LLM provider
   * @throws {Error} When required OpenAI configuration fields are missing
   */
  private createOpenAIProvider(provider: Provider, settings: OpenAILlmSettings): OpenAILlmProvider {
    const config = provider.config as OpenAILlmProviderConfig;

    // Validate required fields
    if (!config.apiKey || !settings.model) {
      const errorMessage = `Invalid OpenAI LLM provider configuration for provider ${provider.id}. Required fields: apiKey, model`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    logger.info(`Creating OpenAI LLM provider for provider ${provider.id} with model ${settings.model}`);
    const instance = new OpenAILlmProvider(config, settings);
    instance.init();
    return instance;
  }

  /**
   * Creates an OpenAI Legacy LLM provider instance from provider entity
   * @param provider - Provider entity with OpenAI Legacy-specific configuration
   * @returns Configured OpenAI Legacy LLM provider
   * @throws {Error} When required OpenAI Legacy configuration fields are missing
   */
  private createOpenAILegacyProvider(provider: Provider, settings: OpenAILegacyLlmSettings): OpenAILegacyLlmProvider {
    const config = provider.config as OpenAILegacyLlmProviderConfig;

    // Validate required fields
    if (!config.apiKey || !settings.model) {
      const errorMessage = `Invalid OpenAI Legacy LLM provider configuration for provider ${provider.id}. Required fields: apiKey, model`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    logger.info(`Creating OpenAI Legacy LLM provider for provider ${provider.id} with model ${settings.model}`);
    const instance = new OpenAILegacyLlmProvider(config, settings);
    instance.init();
    return instance;
  }

  /**
   * Creates an Anthropic LLM provider instance from provider entity
   * @param provider - Provider entity with Anthropic-specific configuration
   * @returns Configured Anthropic LLM provider
   * @throws {Error} When required Anthropic configuration fields are missing
   */
  private createAnthropicProvider(provider: Provider, settings: AnthropicLlmSettings): AnthropicLlmProvider {
    const config = provider.config as AnthropicLlmProviderConfig;

    // Validate required fields
    if (!config.apiKey || !settings.model) {
      const errorMessage = `Invalid Anthropic LLM provider configuration for provider ${provider.id}. Required fields: apiKey, model`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    logger.info(`Creating Anthropic LLM provider for provider ${provider.id} with model ${settings.model}`);
    const instance = new AnthropicLlmProvider(config, settings);
    instance.init();
    return instance;
  }

  /**
   * Creates a Gemini LLM provider instance from provider entity
   * Also supports Vertex AI which uses the same Gemini API
   * @param provider - Provider entity with Gemini-specific configuration
   * @returns Configured Gemini LLM provider
   * @throws {Error} When required Gemini configuration fields are missing
   */
  private createGeminiProvider(provider: Provider, settings: GeminiLlmSettings): GeminiLlmProvider {
    const config = provider.config as GeminiLlmProviderConfig;

    // Validate required fields
    if (!config.apiKey || !settings.model) {
      const errorMessage = `Invalid Gemini LLM provider configuration for provider ${provider.id}. Required fields: apiKey, model`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    logger.info(`Creating Gemini LLM provider for provider ${provider.id} with model ${settings.model}`);
    const instance = new GeminiLlmProvider(config, settings);
    instance.init();
    return instance;
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

    const supportedApiTypes: LlmProviderApiType[] = ['openai', 'openai-legacy', 'anthropic', 'gemini', 'groq', 'vertex'];
    return supportedApiTypes.includes(provider.apiType as LlmProviderApiType);
  }

  /**
   * Gets list of supported LLM provider API types
   * @returns Array of supported API types
   */
  getSupportedApiTypes(): LlmProviderApiType[] {
    return ['openai', 'openai-legacy', 'anthropic', 'gemini', 'groq', 'vertex'];
  }
}
