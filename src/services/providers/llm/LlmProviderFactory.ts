import { singleton } from 'tsyringe';
import { logger } from '../../../utils/logger';
import type { Provider } from '../../../types/models';
import type { ILlmProvider } from './ILlmProvider';
import { OpenAILlmProvider, OpenAILlmProviderConfig } from './OpenAILlmProvider';
import { OpenAILegacyLlmProvider, OpenAILegacyLlmProviderConfig } from './OpenAILegacyLlmProvider';
import { AnthropicLlmProvider, AnthropicLlmProviderConfig } from './AnthropicLlmProvider';
import { GeminiLlmProvider, GeminiLlmProviderConfig } from './GeminiLlmProvider';

/**
 * Supported LLM provider API types
 */
export type LlmProviderApiType = 'openai' | 'openai-legacy' | 'anthropic' | 'gemini' | 'groq' | 'vertex';

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
  createProvider(provider: Provider): ILlmProvider {
    // Validate provider type
    if (provider.providerType !== 'llm') {
      const errorMessage = `Provider ${provider.id} is not an LLM provider. Expected providerType 'llm', got '${provider.providerType}'`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    // Create provider instance based on API type
    switch (provider.apiType) {
      case 'openai':
        return this.createOpenAIProvider(provider);

      case 'openai-legacy':
      case 'groq': // Groq uses OpenAI-compatible API        
        return this.createOpenAILegacyProvider(provider);

      case 'anthropic':
        return this.createAnthropicProvider(provider);

      case 'gemini':
      case 'vertex': // Vertex AI uses Gemini API
        return this.createGeminiProvider(provider);

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
  private createOpenAIProvider(provider: Provider): OpenAILlmProvider {
    const config = provider.config as Partial<OpenAILlmProviderConfig>;

    // Validate required fields
    if (!config.apiKey || !config.model) {
      const errorMessage = `Invalid OpenAI LLM provider configuration for provider ${provider.id}. Required fields: apiKey, model`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    // Build OpenAI provider configuration
    const openaiConfig: OpenAILlmProviderConfig = {
      apiKey: config.apiKey,
      model: config.model,
      organizationId: config.organizationId,
      baseUrl: config.baseUrl,
      defaultMaxTokens: config.defaultMaxTokens,
      defaultTemperature: config.defaultTemperature,
      defaultTopP: config.defaultTopP,
      timeout: config.timeout,
    };

    logger.info(`Creating OpenAI LLM provider for provider ${provider.id} with model ${openaiConfig.model}`);
    const instance = new OpenAILlmProvider();
    instance.init(openaiConfig);
    return instance;
  }

  /**
   * Creates an OpenAI Legacy LLM provider instance from provider entity
   * @param provider - Provider entity with OpenAI Legacy-specific configuration
   * @returns Configured OpenAI Legacy LLM provider
   * @throws {Error} When required OpenAI Legacy configuration fields are missing
   */
  private createOpenAILegacyProvider(provider: Provider): OpenAILegacyLlmProvider {
    const config = provider.config as Partial<OpenAILegacyLlmProviderConfig>;

    // Validate required fields
    if (!config.apiKey || !config.model) {
      const errorMessage = `Invalid OpenAI Legacy LLM provider configuration for provider ${provider.id}. Required fields: apiKey, model`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    // Build OpenAI Legacy provider configuration
    const openaiLegacyConfig: OpenAILegacyLlmProviderConfig = {
      apiKey: config.apiKey,
      model: config.model,
      organizationId: config.organizationId,
      baseUrl: config.baseUrl,
      defaultMaxTokens: config.defaultMaxTokens,
      defaultTemperature: config.defaultTemperature,
      defaultTopP: config.defaultTopP,
      timeout: config.timeout,
    };

    logger.info(`Creating OpenAI Legacy LLM provider for provider ${provider.id} with model ${openaiLegacyConfig.model}`);
    const instance = new OpenAILegacyLlmProvider();
    instance.init(openaiLegacyConfig);
    return instance;
  }

  /**
   * Creates an Anthropic LLM provider instance from provider entity
   * @param provider - Provider entity with Anthropic-specific configuration
   * @returns Configured Anthropic LLM provider
   * @throws {Error} When required Anthropic configuration fields are missing
   */
  private createAnthropicProvider(provider: Provider): AnthropicLlmProvider {
    const config = provider.config as Partial<AnthropicLlmProviderConfig>;

    // Validate required fields
    if (!config.apiKey || !config.model) {
      const errorMessage = `Invalid Anthropic LLM provider configuration for provider ${provider.id}. Required fields: apiKey, model`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    // Build Anthropic provider configuration
    const anthropicConfig: AnthropicLlmProviderConfig = {
      apiKey: config.apiKey,
      model: config.model,
      baseUrl: config.baseUrl,
      defaultMaxTokens: config.defaultMaxTokens,
      defaultTemperature: config.defaultTemperature,
      defaultTopP: config.defaultTopP,
      timeout: config.timeout,
    };

    logger.info(`Creating Anthropic LLM provider for provider ${provider.id} with model ${anthropicConfig.model}`);
    const instance = new AnthropicLlmProvider();
    instance.init(anthropicConfig);
    return instance;
  }

  /**
   * Creates a Gemini LLM provider instance from provider entity
   * Also supports Vertex AI which uses the same Gemini API
   * @param provider - Provider entity with Gemini-specific configuration
   * @returns Configured Gemini LLM provider
   * @throws {Error} When required Gemini configuration fields are missing
   */
  private createGeminiProvider(provider: Provider): GeminiLlmProvider {
    const config = provider.config as Partial<GeminiLlmProviderConfig>;

    // Validate required fields
    if (!config.apiKey || !config.model) {
      const errorMessage = `Invalid Gemini LLM provider configuration for provider ${provider.id}. Required fields: apiKey, model`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    // Build Gemini provider configuration
    const geminiConfig: GeminiLlmProviderConfig = {
      apiKey: config.apiKey,
      model: config.model,
      baseUrl: config.baseUrl,
      defaultMaxTokens: config.defaultMaxTokens,
      defaultTemperature: config.defaultTemperature,
      defaultTopP: config.defaultTopP,
      timeout: config.timeout,
    };

    logger.info(`Creating Gemini LLM provider for provider ${provider.id} with model ${geminiConfig.model}`);
    const instance = new GeminiLlmProvider();
    instance.init(geminiConfig);
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
