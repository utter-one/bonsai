import { singleton } from 'tsyringe';
import { logger } from '../../../utils/logger';
import type { Provider } from '../../../types/models';
import type { IAsrProvider } from './IAsrProvider';
import { AzureAsrProvider, AzureAsrProviderConfig, azureAsrProviderConfigSchema, AzureAsrSettings } from './AzureAsrProvider';
import { ElevenLabsAsrProvider, ElevenLabsAsrProviderConfig, elevenLabsAsrProviderConfigSchema, ElevenLabsAsrSettings } from './ElevenLabsAsrProvider';

/**
 * Supported ASR provider API types
 */
export type AsrProviderApiType = 'azure' | 'elevenlabs';

/** 
 * Union type for all ASR provider settings
 */
export type AsrSettings = AzureAsrSettings | ElevenLabsAsrSettings;

/**
 * Union type for all ASR provider configurations
 */
export type AsrProviderConfig = AzureAsrProviderConfig | ElevenLabsAsrProviderConfig;

/**
 * Factory service for creating ASR provider instances based on provider entity configuration
 * Handles provider instantiation and configuration mapping from database entities to provider-specific configs
 */
@singleton()
export class AsrProviderFactory {
  /**
   * Creates an ASR provider instance from a provider entity
   * @param provider - Provider entity from database containing configuration
   * @returns Configured ASR provider instance
   * @throws {Error} When provider type is not 'asr' or when API type is not supported
   */
  createProvider(provider: Provider, settings: unknown): IAsrProvider {
    // Validate provider type
    if (provider.providerType !== 'asr') {
      const errorMessage = `Provider ${provider.id} is not an ASR provider. Expected providerType 'asr', got '${provider.providerType}'`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    // Create provider instance based on API type
    switch (provider.apiType) {
      case 'azure':
        return this.createAzureProvider(provider, settings as AzureAsrSettings);

      case 'elevenlabs':
        return this.createElevenLabsProvider(provider, settings as ElevenLabsAsrSettings);

      default:
        const errorMessage = `Unsupported ASR provider API type: ${provider.apiType}. Supported types: azure, elevenlabs`;
        logger.error(errorMessage);
        throw new Error(errorMessage);
    }
  }

  /**
   * Creates an Azure ASR provider instance from provider entity
   * @param provider - Provider entity with Azure-specific configuration
   * @returns Configured Azure ASR provider
   * @throws {Error} When required Azure configuration fields are missing
   */
  private createAzureProvider(provider: Provider, settings: AzureAsrSettings): AzureAsrProvider {
    const config = azureAsrProviderConfigSchema.parse(provider.config);
    const safeSettings = (settings ?? {}) as AzureAsrSettings;

    logger.info(`Creating Azure ASR provider for provider ${provider.id} with region ${config.region}`);
    return new AzureAsrProvider(config, safeSettings);
  }

  /**
   * Creates an ElevenLabs ASR provider instance from provider entity
   * @param provider - Provider entity with ElevenLabs-specific configuration
   * @returns Configured ElevenLabs ASR provider
   * @throws {Error} When required ElevenLabs configuration fields are missing
   */
  private createElevenLabsProvider(provider: Provider, settings: ElevenLabsAsrSettings): ElevenLabsAsrProvider {
    const config = elevenLabsAsrProviderConfigSchema.parse(provider.config);
    const safeSettings = (settings ?? {}) as ElevenLabsAsrSettings;

    logger.info(`Creating ElevenLabs ASR provider for provider ${provider.id}`);
    return new ElevenLabsAsrProvider(config, safeSettings);
  }

  /**
   * Validates if a provider can be used for ASR
   * @param provider - Provider entity to validate
   * @returns True if provider is valid for ASR, false otherwise
   */
  isValidAsrProvider(provider: Provider): boolean {
    if (provider.providerType !== 'asr') {
      return false;
    }

    const supportedApiTypes: AsrProviderApiType[] = ['azure', 'elevenlabs'];
    return supportedApiTypes.includes(provider.apiType as AsrProviderApiType);
  }

  /**
   * Gets list of supported ASR provider API types
   * @returns Array of supported API types
   */
  getSupportedApiTypes(): AsrProviderApiType[] {
    return ['azure', 'elevenlabs'];
  }
}
