import { singleton } from 'tsyringe';
import { logger } from '../../../utils/logger';
import type { Provider } from '../../../types/models';
import type { ITtsProvider } from './ITtsProvider';
import { ElevenLabsTtsProvider, ElevenLabsTtsProviderConfig, elevenLabsTtsProviderConfigSchema, ElevenLabsTtsSettings } from './ElevenLabsTtsProvider';
import { OpenAiTtsProvider, OpenAiTtsProviderConfig, openAiTtsProviderConfigSchema, OpenAiTtsSettings } from './OpenAiTtsProvider';
import { DeepgramTtsProvider, DeepgramTtsProviderConfig, deepgramTtsProviderConfigSchema, DeepgramTtsSettings } from './DeepgramTtsProvider';
import { CartesiaTtsProvider, CartesiaTtsProviderConfig, cartesiaTtsProviderConfigSchema, CartesiaTtsSettings } from './CartesiaTtsProvider';
import { AzureTtsProvider, AzureTtsProviderConfig, azureTtsProviderConfigSchema, AzureTtsSettings } from './AzureTtsProvider';
import { AmazonPollyTtsProvider, AmazonPollyTtsProviderConfig, amazonPollyTtsProviderConfigSchema, AmazonPollyTtsSettings } from './AmazonPollyTtsProvider';

/**
 * Supported TTS provider API types
 */
export type TtsProviderApiType = 'elevenlabs' | 'openai' | 'deepgram' | 'cartesia' | 'azure' | 'amazon-polly';

/**
 * Union type for all TTS voice settings
 */
export type TtsSettings = ElevenLabsTtsSettings | OpenAiTtsSettings | DeepgramTtsSettings | CartesiaTtsSettings | AzureTtsSettings | AmazonPollyTtsSettings;

/**
 * Union type for all TTS provider configurations
 */
export type TtsProviderConfig = ElevenLabsTtsProviderConfig | OpenAiTtsProviderConfig | DeepgramTtsProviderConfig | CartesiaTtsProviderConfig | AzureTtsProviderConfig | AmazonPollyTtsProviderConfig;

/**
 * Factory service for creating TTS provider instances based on provider entity configuration
 * Handles provider instantiation and configuration mapping from database entities to provider-specific configs
 */
@singleton()
export class TtsProviderFactory {
  /**
   * Creates a TTS provider instance from a provider entity
   * @param provider - Provider entity from database containing configuration
   * @param settings - TTS provider-specific settings
   * @returns Configured TTS provider instance
   * @throws {Error} When provider type is not 'tts' or when API type is not supported
   */
  createProvider(provider: Provider, settings: TtsSettings): ITtsProvider {
    // Validate provider type
    if (provider.providerType !== 'tts') {
      const errorMessage = `Provider ${provider.id} is not a TTS provider. Expected providerType 'tts', got '${provider.providerType}'`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    // Create provider instance based on API type
    switch (provider.apiType) {
      case 'elevenlabs':
        return this.createElevenLabsProvider(provider, settings as ElevenLabsTtsSettings);

      case 'openai':
        return this.createOpenAiProvider(provider, settings as OpenAiTtsSettings);

      case 'deepgram':
        return this.createDeepgramProvider(provider, settings as DeepgramTtsSettings);

      case 'cartesia':
        return this.createCartesiaProvider(provider, settings as CartesiaTtsSettings);

      case 'azure':
        return this.createAzureProvider(provider, settings as AzureTtsSettings);

      case 'amazon-polly':
        return this.createAmazonPollyProvider(provider, settings as AmazonPollyTtsSettings);

      default:
        const errorMessage = `Unsupported TTS provider API type: ${provider.apiType}. Supported types: elevenlabs, openai, deepgram, cartesia, azure, amazon-polly`;
        logger.error(errorMessage);
        throw new Error(errorMessage);
    }
  }

  /**
   * Creates an ElevenLabs TTS provider instance from provider entity
   * @param provider - Provider entity with ElevenLabs-specific configuration
   * @param settings - ElevenLabs-specific TTS settings
   * @returns Configured ElevenLabs TTS provider
   * @throws {Error} When required ElevenLabs configuration fields are missing
   */
  private createElevenLabsProvider(provider: Provider, settings: ElevenLabsTtsSettings): ElevenLabsTtsProvider {
    const config = elevenLabsTtsProviderConfigSchema.parse(provider.config);

    logger.info(`Creating ElevenLabs TTS provider for provider ${provider.id}`);
    return new ElevenLabsTtsProvider(config, settings);
  }

  /**
   * Creates an OpenAI TTS provider instance from provider entity
   * @param provider - Provider entity with OpenAI-specific configuration
   * @param settings - OpenAI-specific TTS settings
   * @returns Configured OpenAI TTS provider
   * @throws {Error} When required OpenAI configuration fields are missing
   */
  private createOpenAiProvider(provider: Provider, settings: OpenAiTtsSettings): OpenAiTtsProvider {
    const config = openAiTtsProviderConfigSchema.parse(provider.config);

    logger.info(`Creating OpenAI TTS provider for provider ${provider.id}`);
    return new OpenAiTtsProvider(config, settings);
  }

  /**
   * Creates a Deepgram TTS provider instance from provider entity
   * @param provider - Provider entity with Deepgram-specific configuration
   * @param settings - Deepgram-specific TTS settings
   * @returns Configured Deepgram TTS provider
   * @throws {Error} When required Deepgram configuration fields are missing
   */
  private createDeepgramProvider(provider: Provider, settings: DeepgramTtsSettings): DeepgramTtsProvider {
    const config = deepgramTtsProviderConfigSchema.parse(provider.config);

    logger.info(`Creating Deepgram TTS provider for provider ${provider.id}`);
    return new DeepgramTtsProvider(config, settings);
  }

  /**
   * Creates a Cartesia TTS provider instance from provider entity
   * @param provider - Provider entity with Cartesia-specific configuration
   * @param settings - Cartesia-specific TTS settings
   * @returns Configured Cartesia TTS provider
   * @throws {Error} When required Cartesia configuration fields are missing
   */
  private createCartesiaProvider(provider: Provider, settings: CartesiaTtsSettings): CartesiaTtsProvider {
    const config = cartesiaTtsProviderConfigSchema.parse(provider.config);

    logger.info(`Creating Cartesia TTS provider for provider ${provider.id}`);
    return new CartesiaTtsProvider(config, settings);
  }

  /**
   * Creates an Azure TTS provider instance from provider entity
   * @param provider - Provider entity with Azure-specific configuration
   * @param settings - Azure-specific TTS settings
   * @returns Configured Azure TTS provider
   * @throws {Error} When required Azure configuration fields are missing
   */
  private createAzureProvider(provider: Provider, settings: AzureTtsSettings): AzureTtsProvider {
    const config = azureTtsProviderConfigSchema.parse(provider.config);

    logger.info(`Creating Azure TTS provider for provider ${provider.id}`);
    return new AzureTtsProvider(config, settings);
  }

  /**
   * Creates an Amazon Polly TTS provider instance from provider entity
   * @param provider - Provider entity with Amazon Polly-specific configuration
   * @param settings - Amazon Polly-specific TTS settings
   * @returns Configured Amazon Polly TTS provider
   * @throws {Error} When required Amazon Polly configuration fields are missing
   */
  private createAmazonPollyProvider(provider: Provider, settings: AmazonPollyTtsSettings): AmazonPollyTtsProvider {
    const config = amazonPollyTtsProviderConfigSchema.parse(provider.config);

    logger.info(`Creating Amazon Polly TTS provider for provider ${provider.id}`);
    return new AmazonPollyTtsProvider(config, settings);
  }

  /**
   * Validates if a provider can be used for TTS
   * @param provider - Provider entity to validate
   * @returns True if provider is valid for TTS, false otherwise
   */
  isValidTtsProvider(provider: Provider): boolean {
    if (provider.providerType !== 'tts') {
      return false;
    }

    const supportedApiTypes: TtsProviderApiType[] = ['elevenlabs', 'openai', 'deepgram', 'cartesia'];
    return supportedApiTypes.includes(provider.apiType as TtsProviderApiType);
  }

  /**
   * Gets list of supported TTS provider API types
   * @returns Array of supported API types
   */
  getSupportedApiTypes(): TtsProviderApiType[] {
    return ['elevenlabs', 'openai', 'deepgram', 'cartesia', 'azure', 'amazon-polly'];
  }
}
