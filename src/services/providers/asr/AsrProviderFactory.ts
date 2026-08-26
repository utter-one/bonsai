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
import { CONNECTION_TEST_DRAFT_ID } from '../connectionTest/types';

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
    const instance = this.instantiateProvider(resolvedProvider, settings);

    // Stamp provider identity for call-log attribution (P1-03)
    if (instance instanceof AsrProviderBase) {
      instance.providerId = provider.id;
      instance.providerApiType = provider.apiType;
    }

    return instance;
  }

  /**
   * Creates an ASR provider instance for an on-demand connection test (TPC-03).
   * Explicit seam for the test path: fresh instance (never pooled/pre-warmed),
   * secrets resolved, and no production call sites may use it. The session
   * lifecycle (init/start/...) is the strategy's job — this returns an
   * uninitialised instance.
   * Draft providers (id CONNECTION_TEST_DRAFT_ID) are built WITHOUT call-log
   * identity stamps — the provider base's instrumentation then records
   * nothing, which is the TPC-01 draft-mode contract (no call-log rows).
   * Saved providers are stamped so their production wrapper records the
   * test's own `asr.session` call-log row under the tester's monitoring
   * context (breaker-excluded via the context at flush time).
   * @param provider - Provider entity (saved row, or the synthetic draft provider for draft tests)
   * @param settings - ASR settings (empty object: the test uses provider defaults)
   * @returns A new, uninitialised ASR provider instance
   * @throws {Error} When provider type is not 'asr' or API type is not supported
   */
  async createForTest(provider: Provider, settings: unknown): Promise<IAsrProvider> {
    if (provider.providerType !== 'asr') {
      const errorMessage = `Provider ${provider.id} is not an ASR provider. Expected providerType 'asr', got '${provider.providerType}'`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    logger.info(`Creating test ASR provider instance (${provider.apiType}) for provider ${provider.id}`);
    const resolvedConfig = await this.secretRefUtils.resolveObject(provider.config as Record<string, unknown>);
    const instance = this.instantiateProvider({ ...provider, config: resolvedConfig as typeof provider.config }, settings);

    // Stamp only for saved providers — draft tests must not produce call-log rows.
    if (instance instanceof AsrProviderBase && provider.id !== CONNECTION_TEST_DRAFT_ID) {
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
   * Parses provider config and instantiates the correct provider class (no validation beyond the config schemas, no identity stamping).
   * @param provider - Provider entity (config already resolved)
   * @param settings - ASR settings for the concrete apiType
   * @returns A new, uninitialised ASR provider instance
   * @throws {Error} When the API type is not supported
   */
  private instantiateProvider(provider: Provider, settings: unknown): IAsrProvider {
    // Create provider instance based on API type
    switch (provider.apiType) {
      case 'azure':
        return this.createAzureProvider(provider, settings as AzureAsrSettings);

      case 'elevenlabs':
        return this.createElevenLabsProvider(provider, settings as ElevenLabsAsrSettings);

      case 'deepgram':
        return this.createDeepgramProvider(provider, settings as DeepgramAsrSettings);

      case 'assemblyai':
        return this.createAssemblyAiProvider(provider, settings as AssemblyAiAsrSettings);

      case 'speechmatics':
        return this.createSpeechmaticsProvider(provider, settings as SpeechmaticsAsrSettings);

      case 'soniox':
        return this.createSonioxProvider(provider, settings as SonioxAsrSettings);

      default:
        const errorMessage = `Unsupported ASR provider API type: ${provider.apiType}. Supported types: azure, elevenlabs, deepgram, assemblyai, speechmatics, soniox`;
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
