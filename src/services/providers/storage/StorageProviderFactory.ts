import { singleton, inject } from 'tsyringe';
import { logger } from '../../../utils/logger';
import type { Provider } from '../../../types/models';
import type { IStorageProvider } from './IStorageProvider';
import { StorageProviderBase } from './StorageProviderBase';
import { SecretRefUtils } from '../../secrets/SecretRefUtils';
import { CONNECTION_TEST_DRAFT_ID } from '../connectionTest/types';

export type StorageProviderApiType = 's3' | 'azure-blob' | 'gcs' | 'local';

// Settings types will be defined by specific providers - using generic for now
export type StorageSettings = Record<string, unknown>;

// Config types will be defined by specific providers
export type StorageProviderConfig = Record<string, unknown>;

/**
 * Factory for creating storage provider instances
 */
@singleton()
export class StorageProviderFactory {
  constructor(@inject(SecretRefUtils) private readonly secretRefUtils: SecretRefUtils) {}

  /**
   * Create a storage provider instance
   * @param provider - Provider entity from database
   * @param settings - Runtime settings for the provider
   * @returns Initialized storage provider instance
   */
  async createProvider(provider: Provider, settings: StorageSettings): Promise<IStorageProvider> {
    if (provider.providerType !== 'storage') {
      throw new Error(`Provider ${provider.id} is not a storage provider (type: ${provider.providerType})`);
    }

    const resolvedConfig = await this.secretRefUtils.resolveObject(provider.config as Record<string, unknown>);
    const resolvedProvider = { ...provider, config: resolvedConfig as typeof provider.config };
    const instance = await this.instantiateProvider(resolvedProvider, settings);

    // Stamp provider identity for call-log attribution (P1-03)
    if (instance instanceof StorageProviderBase) {
      instance.providerId = provider.id;
      instance.providerApiType = provider.apiType;
    }

    return instance;
  }

  /**
   * Creates a storage provider instance for a connection test (TPC-05).
   * Same construction as `createProvider` (including init), but call-log
   * stamping is skipped for draft tests — un-stamped instances record
   * nothing, so plaintext draft secrets never produce attributed rows.
   * @param provider - Provider entity (saved row or synthetic draft)
   * @param settings - Storage provider-specific settings (bucket, subPath, ...)
   * @returns Initialised storage provider instance (stamped only for saved providers)
   */
  async createForTest(provider: Provider, settings: StorageSettings): Promise<IStorageProvider> {
    if (provider.providerType !== 'storage') {
      throw new Error(`Provider ${provider.id} is not a storage provider (type: ${provider.providerType})`);
    }

    logger.info(`Creating test storage provider instance (${provider.apiType}) for provider ${provider.id}`);
    const resolvedConfig = await this.secretRefUtils.resolveObject(provider.config as Record<string, unknown>);
    const resolvedProvider = { ...provider, config: resolvedConfig as typeof provider.config };
    const instance = await this.instantiateProvider(resolvedProvider, settings);

    // Stamp only for saved providers — draft tests must not produce call-log rows.
    // No `instanceof` gate on purpose: every apiType above instantiates a
    // StorageProviderBase subclass, and under tsx (dev/tests) the dynamically
    // imported provider module can live in a different module graph than this
    // factory, which would make `instanceof StorageProviderBase` unreliable.
    if (provider.id !== CONNECTION_TEST_DRAFT_ID) {
      const base = instance as StorageProviderBase<Record<string, unknown>>;
      base.providerId = provider.id;
      base.providerApiType = provider.apiType;
    }

    return instance;
  }

  /**
   * Constructs (and init-s) the concrete provider for an apiType — shared by
   * `createProvider` and `createForTest` (one code path).
   */
  private async instantiateProvider(provider: Provider, settings: StorageSettings): Promise<IStorageProvider> {
    let instance: IStorageProvider;

    switch (provider.apiType as StorageProviderApiType) {
      case 's3':
        instance = await this.createS3Provider(provider, settings);
        break;

      case 'azure-blob':
        instance = await this.createAzureBlobProvider(provider, settings);
        break;

      case 'gcs':
        instance = await this.createGcsProvider(provider, settings);
        break;

      case 'local':
        instance = await this.createLocalProvider(provider, settings);
        break;

      default:
        throw new Error(`Unsupported storage provider API type: ${provider.apiType}`);
    }

    return instance;
  }

  private async createS3Provider(provider: Provider, settings: StorageSettings): Promise<IStorageProvider> {
    const { S3StorageProvider, s3StorageProviderConfigSchema } = await import('./S3StorageProvider');
    const config = s3StorageProviderConfigSchema.parse(provider.config);
    logger.info(`Creating S3 storage provider for provider ${provider.id}`);
    const instance = new S3StorageProvider(config, settings as any);
    await instance.init();
    return instance;
  }

  private async createAzureBlobProvider(provider: Provider, settings: StorageSettings): Promise<IStorageProvider> {
    const { AzureBlobStorageProvider, azureBlobStorageProviderConfigSchema } = await import('./AzureBlobStorageProvider');
    const config = azureBlobStorageProviderConfigSchema.parse(provider.config);
    logger.info(`Creating Azure Blob storage provider for provider ${provider.id}`);
    const instance = new AzureBlobStorageProvider(config, settings as any);
    await instance.init();
    return instance;
  }

  private async createGcsProvider(provider: Provider, settings: StorageSettings): Promise<IStorageProvider> {
    const { GcsStorageProvider, gcsStorageProviderConfigSchema } = await import('./GcsStorageProvider');
    const config = gcsStorageProviderConfigSchema.parse(provider.config);
    logger.info(`Creating GCS storage provider for provider ${provider.id}`);
    const instance = new GcsStorageProvider(config, settings as any);
    await instance.init();
    return instance;
  }

  private async createLocalProvider(provider: Provider, settings: StorageSettings): Promise<IStorageProvider> {
    const { LocalStorageProvider, localStorageProviderConfigSchema } = await import('./LocalStorageProvider');
    const config = localStorageProviderConfigSchema.parse(provider.config);
    logger.info(`Creating Local storage provider for provider ${provider.id}`);
    const instance = new LocalStorageProvider(config, settings as any);
    await instance.init();
    return instance;
  }

  /**
   * Check if a provider is a valid storage provider
   */
  isValidStorageProvider(provider: Provider): boolean {
    return provider.providerType === 'storage' && ['s3', 'azure-blob', 'gcs', 'local'].includes(provider.apiType);
  }

  /**
   * Get list of supported storage provider API types
   */
  getSupportedApiTypes(): StorageProviderApiType[] {
    return ['s3', 'azure-blob', 'gcs', 'local'];
  }
}
