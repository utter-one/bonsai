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

/**
 * Supported LLM provider API types
 */
export type LlmProviderApiType = 'openai' | 'openai-legacy' | 'anthropic' | 'gemini' | 'groq' | 'mistral' | 'deepseek' | 'openrouter' | 'together-ai' | 'fireworks-ai' | 'perplexity' | 'cohere' | 'xai' | 'vertex';

/**
 * Union type for all LLM provider settings
 */
export type LlmSettings = OpenAILlmSettings | OpenAILegacyLlmSettings | AnthropicLlmSettings | GeminiLlmSettings | GroqLlmSettings | MistralLlmSettings | DeepSeekLlmSettings | OpenRouterLlmSettings | TogetherAILlmSettings | FireworksAILlmSettings | PerplexityLlmSettings | CohereLlmSettings | XAILlmSettings;

/**
 * Union type for all LLM provider configurations
 */
export type LlmProviderConfig = OpenAILlmProviderConfig | OpenAILegacyLlmProviderConfig | AnthropicLlmProviderConfig | GeminiLlmProviderConfig | GroqLlmProviderConfig | MistralLlmProviderConfig | DeepSeekLlmProviderConfig | OpenRouterLlmProviderConfig | TogetherAILlmProviderConfig | FireworksAILlmProviderConfig | PerplexityLlmProviderConfig | CohereLlmProviderConfig | XAILlmProviderConfig;

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
        return this.createOpenAILegacyProvider(provider, settings as OpenAILegacyLlmSettings);

      case 'groq':
        return this.createGroqProvider(provider, settings as GroqLlmSettings);

      case 'mistral':
        return this.createMistralProvider(provider, settings as MistralLlmSettings);

      case 'deepseek':
        return this.createDeepSeekProvider(provider, settings as DeepSeekLlmSettings);

      case 'openrouter':
        return this.createOpenRouterProvider(provider, settings as OpenRouterLlmSettings);

      case 'together-ai':
        return this.createTogetherAIProvider(provider, settings as TogetherAILlmSettings);

      case 'fireworks-ai':
        return this.createFireworksAIProvider(provider, settings as FireworksAILlmSettings);

      case 'perplexity':
        return this.createPerplexityProvider(provider, settings as PerplexityLlmSettings);

      case 'cohere':
        return this.createCohereProvider(provider, settings as CohereLlmSettings);

      case 'xai':
        return this.createXAIProvider(provider, settings as XAILlmSettings);

      case 'anthropic':
        return this.createAnthropicProvider(provider, settings as AnthropicLlmSettings);

      case 'gemini':
      case 'vertex': // Vertex AI uses Gemini API
        return this.createGeminiProvider(provider, settings as GeminiLlmSettings);

      default:
        const errorMessage = `Unsupported LLM provider API type: ${provider.apiType}. Supported types: openai, openai-legacy, anthropic, gemini, groq, mistral, deepseek, openrouter, together-ai, fireworks-ai, perplexity, cohere, xai, vertex`;
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
    const config = openAILlmProviderConfigSchema.parse(provider.config);

    // Validate required fields in settings
    if (!settings.model) {
      const errorMessage = `Invalid OpenAI LLM provider settings for provider ${provider.id}. Required field: model`;
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
    const config = openAILegacyLlmProviderConfigSchema.parse(provider.config);

    // Validate required fields in settings
    if (!settings.model) {
      const errorMessage = `Invalid OpenAI Legacy LLM provider settings for provider ${provider.id}. Required field: model`;
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
    const config = anthropicLlmProviderConfigSchema.parse(provider.config);

    // Validate required fields in settings
    if (!settings.model) {
      const errorMessage = `Invalid Anthropic LLM provider settings for provider ${provider.id}. Required field: model`;
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
  /**
   * Creates a Groq LLM provider instance
   */
  private createGroqProvider(provider: Provider, settings: GroqLlmSettings): GroqLlmProvider {
    const config = groqLlmProviderConfigSchema.parse(provider.config);
    if (!settings.model) {
      const errorMessage = `Invalid Groq LLM provider settings for provider ${provider.id}. Required field: model`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }
    logger.info(`Creating Groq LLM provider for provider ${provider.id} with model ${settings.model}`);
    const instance = new GroqLlmProvider(config, settings);
    instance.init();
    return instance;
  }

  /**
   * Creates a Mistral AI LLM provider instance
   */
  private createMistralProvider(provider: Provider, settings: MistralLlmSettings): MistralLlmProvider {
    const config = mistralLlmProviderConfigSchema.parse(provider.config);
    if (!settings.model) {
      const errorMessage = `Invalid Mistral LLM provider settings for provider ${provider.id}. Required field: model`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }
    logger.info(`Creating Mistral AI LLM provider for provider ${provider.id} with model ${settings.model}`);
    const instance = new MistralLlmProvider(config, settings);
    instance.init();
    return instance;
  }

  /**
   * Creates a DeepSeek LLM provider instance
   */
  private createDeepSeekProvider(provider: Provider, settings: DeepSeekLlmSettings): DeepSeekLlmProvider {
    const config = deepSeekLlmProviderConfigSchema.parse(provider.config);
    if (!settings.model) {
      const errorMessage = `Invalid DeepSeek LLM provider settings for provider ${provider.id}. Required field: model`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }
    logger.info(`Creating DeepSeek LLM provider for provider ${provider.id} with model ${settings.model}`);
    const instance = new DeepSeekLlmProvider(config, settings);
    instance.init();
    return instance;
  }

  /**
   * Creates an OpenRouter LLM provider instance
   */
  private createOpenRouterProvider(provider: Provider, settings: OpenRouterLlmSettings): OpenRouterLlmProvider {
    const config = openRouterLlmProviderConfigSchema.parse(provider.config);
    if (!settings.model) {
      const errorMessage = `Invalid OpenRouter LLM provider settings for provider ${provider.id}. Required field: model`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }
    logger.info(`Creating OpenRouter LLM provider for provider ${provider.id} with model ${settings.model}`);
    const instance = new OpenRouterLlmProvider(config, settings);
    instance.init();
    return instance;
  }

  /**
   * Creates a Together AI LLM provider instance
   */
  private createTogetherAIProvider(provider: Provider, settings: TogetherAILlmSettings): TogetherAILlmProvider {
    const config = togetherAILlmProviderConfigSchema.parse(provider.config);
    if (!settings.model) {
      const errorMessage = `Invalid Together AI LLM provider settings for provider ${provider.id}. Required field: model`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }
    logger.info(`Creating Together AI LLM provider for provider ${provider.id} with model ${settings.model}`);
    const instance = new TogetherAILlmProvider(config, settings);
    instance.init();
    return instance;
  }

  /**
   * Creates a Fireworks AI LLM provider instance
   */
  private createFireworksAIProvider(provider: Provider, settings: FireworksAILlmSettings): FireworksAILlmProvider {
    const config = fireworksAILlmProviderConfigSchema.parse(provider.config);
    if (!settings.model) {
      const errorMessage = `Invalid Fireworks AI LLM provider settings for provider ${provider.id}. Required field: model`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }
    logger.info(`Creating Fireworks AI LLM provider for provider ${provider.id} with model ${settings.model}`);
    const instance = new FireworksAILlmProvider(config, settings);
    instance.init();
    return instance;
  }

  /**
   * Creates a Perplexity LLM provider instance
   */
  private createPerplexityProvider(provider: Provider, settings: PerplexityLlmSettings): PerplexityLlmProvider {
    const config = perplexityLlmProviderConfigSchema.parse(provider.config);
    if (!settings.model) {
      const errorMessage = `Invalid Perplexity LLM provider settings for provider ${provider.id}. Required field: model`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }
    logger.info(`Creating Perplexity LLM provider for provider ${provider.id} with model ${settings.model}`);
    const instance = new PerplexityLlmProvider(config, settings);
    instance.init();
    return instance;
  }

  /**
   * Creates a Cohere LLM provider instance
   */
  private createCohereProvider(provider: Provider, settings: CohereLlmSettings): CohereLlmProvider {
    const config = cohereLlmProviderConfigSchema.parse(provider.config);
    if (!settings.model) {
      const errorMessage = `Invalid Cohere LLM provider settings for provider ${provider.id}. Required field: model`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }
    logger.info(`Creating Cohere LLM provider for provider ${provider.id} with model ${settings.model}`);
    const instance = new CohereLlmProvider(config, settings);
    instance.init();
    return instance;
  }

  /**
   * Creates an xAI (Grok) LLM provider instance
   */
  private createXAIProvider(provider: Provider, settings: XAILlmSettings): XAILlmProvider {
    const config = xAILlmProviderConfigSchema.parse(provider.config);
    if (!settings.model) {
      const errorMessage = `Invalid xAI LLM provider settings for provider ${provider.id}. Required field: model`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }
    logger.info(`Creating xAI LLM provider for provider ${provider.id} with model ${settings.model}`);
    const instance = new XAILlmProvider(config, settings);
    instance.init();
    return instance;
  }

  /**
   * Creates a Gemini LLM provider instance
   * Also supports Vertex AI which uses the same Gemini API
   */
  private createGeminiProvider(provider: Provider, settings: GeminiLlmSettings): GeminiLlmProvider {
    const config = geminiLlmProviderConfigSchema.parse(provider.config);

    // Validate required fields in settings
    if (!settings.model) {
      const errorMessage = `Invalid Gemini LLM provider settings for provider ${provider.id}. Required field: model`;
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

    const supportedApiTypes: LlmProviderApiType[] = ['openai', 'openai-legacy', 'anthropic', 'gemini', 'groq', 'mistral', 'deepseek', 'openrouter', 'together-ai', 'fireworks-ai', 'perplexity', 'cohere', 'xai', 'vertex'];
    return supportedApiTypes.includes(provider.apiType as LlmProviderApiType);
  }

  /**
   * Gets list of supported LLM provider API types
   * @returns Array of supported API types
   */
  getSupportedApiTypes(): LlmProviderApiType[] {
    return ['openai', 'openai-legacy', 'anthropic', 'gemini', 'groq', 'mistral', 'deepseek', 'openrouter', 'together-ai', 'fireworks-ai', 'perplexity', 'cohere', 'xai', 'vertex'];
  }
}
