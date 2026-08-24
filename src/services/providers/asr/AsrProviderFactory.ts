import { singleton, inject } from 'tsyringe';
import { logger } from '../../../utils/logger';
import type { Provider } from '../../../types/models';
import type { IAsrProvider } from './IAsrProvider';
import { AsrProviderBase } from './AsrProviderBase';
import { AzureAsrProvider, AzureAsrProviderConfig, azureAsrProviderConfigSchema, AzureAsrSettings, azureAsrSettingsSchema } from './AzureAsrProvider';
import { ElevenLabsAsrProvider, ElevenLabsAsrProviderConfig, elevenLabsAsrProviderConfigSchema, ElevenLabsAsrSettings, elevenLabsAsrSettingsSchema } from './ElevenLabsAsrProvider';
import { DeepgramAsrProvider, DeepgramAsrProviderConfig, deepgramAsrProviderConfigSchema, DeepgramAsrSettings, deepgramAsrSettingsSchema } from './DeepgramAsrProvider';
import { AssemblyAiAsrProvider, AssemblyAiAsrProviderConfig, assemblyAiAsrProviderConfigSchema, AssemblyAiAsrSettings, assemblyAiAsrSettingsSchema } from './AssemblyAiAsrProvider';
import { SpeechmaticsAsrProvider, SpeechmaticsAsrProviderConfig, speechmaticsAsrProviderConfigSchema, SpeechmaticsAsrSettings, speechmaticsAsrSettingsSchema } from './SpeechmaticsAsrProvider';
import { SonioxAsrProvider, SonioxAsrProviderConfig, sonioxAsrProviderConfigSchema, SonioxAsrSettings, sonioxAsrSettingsSchema } from './SonioxAsrProvider';
import { SecretRefUtils } from '../../secrets/SecretRefUtils';

/**
 * Supported ASR provider API types
 */
export type AsrProviderApiType = 'azure' | 'elevenlabs' | 'deepgram' | 'assemblyai' | 'speechmatics' | 'soniox';

/** 
 * Union type for all ASR provider settings
 */
export type AsrSettings = AzureAsrSettings | ElevenLabsAsrSettings | DeepgramAsrSettings | AssemblyAiAsrSettings | SpeechmaticsAsrSettings | SonioxAsrSettings;

/**
 * Union type for all ASR provider configurations
 */
export type AsrProviderConfig = AzureAsrProviderConfig | ElevenLabsAsrProviderConfig | DeepgramAsrProviderConfig | AssemblyAiAsrProviderConfig | SpeechmaticsAsrProviderConfig | SonioxAsrProviderConfig;

/**
 * Factory service for creating ASR provider instances based on provider entity configuration
 * Handles provider instantiation and configuration mapping from database entities to provider-specific configs
 */
@singleton()
export class AsrProviderFactory {
  constructor(@inject(SecretRefUtils) private readonly secretRefUtils: SecretRefUtils) {}

  /**
   * Creates an ASR provider instance from a provider entity
   * @param provider - Provider entity from database containing configuration
   * @returns Configured ASR provider instance
   * @throws {Error} When provider type is not 'asr' or when API type is not supported
   */
  async createProvider(provider: Provider, settings: unknown): Promise<IAsrProvider> {
    // Validate provider type
    if (provider.providerType !== 'asr') {
      const errorMessage = `Provider ${provider.id} is not an ASR provider. Expected providerType 'asr', got '${provider.providerType}'`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    const resolvedConfig = await this.secretRefUtils.resolveObject(provider.config as Record<string, unknown>);
    const resolvedProvider = { ...provider, config: resolvedConfig as typeof provider.config };

    // Create provider instance based on API type
    let instance: IAsrProvider;
    switch (provider.apiType) {
      case 'azure':
        instance = this.createAzureProvider(resolvedProvider, settings as AzureAsrSettings);
        break;

      case 'elevenlabs':
        instance = this.createElevenLabsProvider(resolvedProvider, settings as ElevenLabsAsrSettings);
        break;

      case 'deepgram':
        instance = this.createDeepgramProvider(resolvedProvider, settings as DeepgramAsrSettings);
        break;

      case 'assemblyai':
        instance = this.createAssemblyAiProvider(resolvedProvider, settings as AssemblyAiAsrSettings);
        break;

      case 'speechmatics':
        instance = this.createSpeechmaticsProvider(resolvedProvider, settings as SpeechmaticsAsrSettings);
        break;

      case 'soniox':
        instance = this.createSonioxProvider(resolvedProvider, settings as SonioxAsrSettings);
        break;

      default:
        const errorMessage = `Unsupported ASR provider API type: ${provider.apiType}. Supported types: azure, elevenlabs, deepgram, assemblyai, speechmatics, soniox`;
        logger.error(errorMessage);
        throw new Error(errorMessage);
    }

    // Stamp provider identity for call-log attribution (P1-03)
    if (instance instanceof AsrProviderBase) {
      instance.providerId = provider.id;
      instance.providerApiType = provider.apiType;
    }

    return instance;
  }

  /**
   * Creates an ASR provider instance for the HealthCheckService liveness probe (P1-05b).
   * Resolves secrets and constructs the instance with default (empty) settings —
   * `ping()` implementations never read session settings. The instance is NOT
   * initialised: probe `ping()` methods must be self-contained on a fresh instance.
   * @param provider - Provider entity from database containing configuration
   * @returns ASR provider instance suitable for calling `ping()`
   * @throws {Error} When provider type is not 'asr' or when API type is not supported
   */
  async createProviderForProbing(provider: Provider): Promise<IAsrProvider> {
    return this.createProvider(provider, {});
  }

  /**
   * Creates an Azure ASR provider instance from provider entity
   * @param provider - Provider entity with Azure-specific configuration
   * @returns Configured Azure ASR provider
   * @throws {Error} When required Azure configuration fields are missing
   */
  private createAzureProvider(provider: Provider, settings: AzureAsrSettings): AzureAsrProvider {
    const config = azureAsrProviderConfigSchema.parse(provider.config);
    const safeSettings = azureAsrSettingsSchema.parse(settings);

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
    const safeSettings = elevenLabsAsrSettingsSchema.parse(settings);

    logger.info(`Creating ElevenLabs ASR provider for provider ${provider.id}`);
    return new ElevenLabsAsrProvider(config, safeSettings);
  }

  /**
   * Creates a Deepgram ASR provider instance from provider entity
   * @param provider - Provider entity with Deepgram-specific configuration
   * @returns Configured Deepgram ASR provider
   * @throws {Error} When required Deepgram configuration fields are missing
   */
  private createDeepgramProvider(provider: Provider, settings: DeepgramAsrSettings): DeepgramAsrProvider {
    const config = deepgramAsrProviderConfigSchema.parse(provider.config);
    const safeSettings = deepgramAsrSettingsSchema.parse(settings);

    logger.info(`Creating Deepgram ASR provider for provider ${provider.id}`);
    return new DeepgramAsrProvider(config, safeSettings);
  }

  /**
   * Creates an AssemblyAI ASR provider instance from provider entity
   * @param provider - Provider entity with AssemblyAI-specific configuration
   * @returns Configured AssemblyAI ASR provider
   * @throws {Error} When required AssemblyAI configuration fields are missing
   */
  private createAssemblyAiProvider(provider: Provider, settings: AssemblyAiAsrSettings): AssemblyAiAsrProvider {
    const config = assemblyAiAsrProviderConfigSchema.parse(provider.config);
    const safeSettings = assemblyAiAsrSettingsSchema.parse(settings);

    logger.info(`Creating AssemblyAI ASR provider for provider ${provider.id} (region: ${config.region})`);
    return new AssemblyAiAsrProvider(config, safeSettings);
  }

  /**
   * Creates a Speechmatics ASR provider instance from provider entity
   * @param provider - Provider entity with Speechmatics-specific configuration
   * @returns Configured Speechmatics ASR provider
   * @throws {Error} When required Speechmatics configuration fields are missing
   */
  private createSpeechmaticsProvider(provider: Provider, settings: SpeechmaticsAsrSettings): SpeechmaticsAsrProvider {
    const config = speechmaticsAsrProviderConfigSchema.parse(provider.config);
    const safeSettings = speechmaticsAsrSettingsSchema.parse(settings);

    logger.info(`Creating Speechmatics ASR provider for provider ${provider.id} (region: ${config.region})`);
    return new SpeechmaticsAsrProvider(config, safeSettings);
  }

  /**
   * Creates a Soniox ASR provider instance from provider entity
   * @param provider - Provider entity with Soniox-specific configuration
   * @returns Configured Soniox ASR provider
   * @throws {Error} When required Soniox configuration fields are missing
   */
  private createSonioxProvider(provider: Provider, settings: SonioxAsrSettings): SonioxAsrProvider {
    const config = sonioxAsrProviderConfigSchema.parse(provider.config);
    const safeSettings = sonioxAsrSettingsSchema.parse(settings);

    logger.info(`Creating Soniox ASR provider for provider ${provider.id} (region: ${config.region})`);
    return new SonioxAsrProvider(config, safeSettings);
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

    const supportedApiTypes: AsrProviderApiType[] = ['azure', 'elevenlabs', 'deepgram', 'assemblyai', 'speechmatics', 'soniox'];
    return supportedApiTypes.includes(provider.apiType as AsrProviderApiType);
  }

  /**
   * Gets list of supported ASR provider API types
   * @returns Array of supported API types
   */
  getSupportedApiTypes(): AsrProviderApiType[] {
    return ['azure', 'elevenlabs', 'deepgram', 'assemblyai', 'speechmatics', 'soniox'];
  }
}
