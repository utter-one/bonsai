import { singleton } from 'tsyringe';
import { logger } from '../../../utils/logger';
import type { Provider } from '../../../types/models';
import type { ITtsProvider } from './ITtsProvider';
import { ElevenLabsTtsProvider, ElevenLabsTtsProviderConfig, elevenLabsTtsProviderConfigSchema, ElevenLabsTtsSettings } from './ElevenLabsTtsProvider';
import { OpenAiTtsProvider, OpenAiTtsProviderConfig, openAiTtsProviderConfigSchema, OpenAiTtsSettings } from './OpenAiTtsProvider';
import { DeepgramTtsProvider, DeepgramTtsProviderConfig, deepgramTtsProviderConfigSchema, DeepgramTtsSettings } from './DeepgramTtsProvider';

/**
 * Supported TTS provider API types
 */
export type TtsProviderApiType = 'elevenlabs' | 'openai' | 'deepgram';

/**
 * Union type for all TTS voice settings
 */
export type TtsSettings = ElevenLabsTtsSettings | OpenAiTtsSettings | DeepgramTtsSettings;

/**
 * Union type for all TTS provider configurations
 */
export type TtsProviderConfig = ElevenLabsTtsProviderConfig | OpenAiTtsProviderConfig | DeepgramTtsProviderConfig;

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

      default:
        const errorMessage = `Unsupported TTS provider API type: ${provider.apiType}. Supported types: elevenlabs, openai, deepgram`;
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
   * Validates if a provider can be used for TTS
   * @param provider - Provider entity to validate
   * @returns True if provider is valid for TTS, false otherwise
   */
  isValidTtsProvider(provider: Provider): boolean {
    if (provider.providerType !== 'tts') {
      return false;
    }

    const supportedApiTypes: TtsProviderApiType[] = ['elevenlabs', 'openai', 'deepgram'];
    return supportedApiTypes.includes(provider.apiType as TtsProviderApiType);
  }

  /**
   * Gets list of supported TTS provider API types
   * @returns Array of supported API types
   */
  getSupportedApiTypes(): TtsProviderApiType[] {
    return ['elevenlabs', 'openai', 'deepgram'];
  }
}
