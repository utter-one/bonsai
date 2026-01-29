import { singleton } from 'tsyringe';
import { logger } from '../../../utils/logger';
import type { Provider } from '../../../types/models';
import type { ITtsProvider } from './ITtsProvider';
import { ElevenLabsTtsProvider, ElevenLabsTtsProviderConfig, elevenLabsTtsProviderConfigSchema } from './ElevenLabsTtsProvider';

/**
 * Supported TTS provider API types
 */
export type TtsProviderApiType = 'elevenlabs';

/**
 * Union type for all TTS provider settings
 */
export type TtsSettings = ElevenLabsTtsProviderConfig;

/**
 * Union type for all TTS provider configurations
 */
export type TtsProviderConfig = ElevenLabsTtsProviderConfig;

/**
 * Factory service for creating TTS provider instances based on provider entity configuration
 * Handles provider instantiation and configuration mapping from database entities to provider-specific configs
 */
@singleton()
export class TtsProviderFactory {
  /**
   * Creates a TTS provider instance from a provider entity
   * @param provider - Provider entity from database containing configuration
   * @returns Configured TTS provider instance
   * @throws {Error} When provider type is not 'tts' or when API type is not supported
   */
  createProvider(provider: Provider): ITtsProvider {
    // Validate provider type
    if (provider.providerType !== 'tts') {
      const errorMessage = `Provider ${provider.id} is not a TTS provider. Expected providerType 'tts', got '${provider.providerType}'`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    // Create provider instance based on API type
    switch (provider.apiType) {
      case 'elevenlabs':
        return this.createElevenLabsProvider(provider);

      default:
        const errorMessage = `Unsupported TTS provider API type: ${provider.apiType}. Supported types: elevenlabs`;
        logger.error(errorMessage);
        throw new Error(errorMessage);
    }
  }

  /**
   * Creates an ElevenLabs TTS provider instance from provider entity
   * @param provider - Provider entity with ElevenLabs-specific configuration
   * @returns Configured ElevenLabs TTS provider
   * @throws {Error} When required ElevenLabs configuration fields are missing
   */
  private createElevenLabsProvider(provider: Provider): ElevenLabsTtsProvider {
    const config = elevenLabsTtsProviderConfigSchema.parse(provider.config);

    logger.info(`Creating ElevenLabs TTS provider for provider ${provider.id}`);
    return new ElevenLabsTtsProvider(config);
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

    const supportedApiTypes: TtsProviderApiType[] = ['elevenlabs'];
    return supportedApiTypes.includes(provider.apiType as TtsProviderApiType);
  }

  /**
   * Gets list of supported TTS provider API types
   * @returns Array of supported API types
   */
  getSupportedApiTypes(): TtsProviderApiType[] {
    return ['elevenlabs'];
  }
}
