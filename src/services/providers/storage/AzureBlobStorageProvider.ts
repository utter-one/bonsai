import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { BlobServiceClient, StorageSharedKeyCredential, generateBlobSASQueryParameters, BlobSASPermissions, type BlobUploadCommonResponse } from '@azure/storage-blob';
import { StorageProviderBase } from './StorageProviderBase';
import type { StorageMetadata, StorageObject } from './IStorageProvider';
import { logger } from '../../../utils/logger';

extendZodWithOpenApi(z);

/**
 * Azure Blob Storage provider configuration schema
 */
export const azureBlobStorageProviderConfigSchema = z.strictObject({
  accountName: z.string().describe('Azure storage account name'),
  accountKey: z.string().describe('Azure storage account key'),
  endpoint: z.string().optional().describe('Custom endpoint for Azure Blob Storage'),
}).openapi('AzureBlobStorageConfig');

/**
 * Azure Blob Storage settings schema
 */
export const azureBlobStorageSettingsSchema = z.object({
  containerName: z.string().describe('Azure Blob Storage container name'),
  prefix: z.string().optional().describe('Blob prefix for all operations (e.g., "projects/123/")'),
  tier: z.enum(['Hot', 'Cool', 'Archive']).optional().describe('Access tier for uploaded blobs'),
}).openapi('AzureBlobStorageSettings');

export type AzureBlobStorageProviderConfig = z.infer<typeof azureBlobStorageProviderConfigSchema>;
export type AzureBlobStorageSettings = z.infer<typeof azureBlobStorageSettingsSchema>;

/**
 * Azure Blob Storage provider implementation
 */
export class AzureBlobStorageProvider extends StorageProviderBase<AzureBlobStorageProviderConfig> {
  private serviceClient?: BlobServiceClient;
  private credential?: StorageSharedKeyCredential;
  private settings: AzureBlobStorageSettings;

  constructor(config: AzureBlobStorageProviderConfig, settings: AzureBlobStorageSettings) {
    super(config);
    this.settings = azureBlobStorageSettingsSchema.parse(settings);
  }

  async init(): Promise<void> {
    await super.init();
    this.credential = new StorageSharedKeyCredential(this.config!.accountName, this.config!.accountKey);
    const endpoint = this.config!.endpoint || `https://${this.config!.accountName}.blob.core.windows.net`;
    this.serviceClient = new BlobServiceClient(endpoint, this.credential);
    logger.info(`Azure Blob Storage provider initialized for container: ${this.settings.containerName}`);
  }

  async upload(key: string, data: Buffer, metadata?: StorageMetadata): Promise<string> {
    return this.withErrorHandling(async () => {
      const fullKey = this.getFullKey(key);
      const containerClient = this.serviceClient!.getContainerClient(this.settings.containerName);
      const blockBlobClient = containerClient.getBlockBlobClient(fullKey);

      const options: Parameters<typeof blockBlobClient.upload>[2] = {
        blobHTTPHeaders: {
          blobContentType: metadata?.contentType,
          blobContentEncoding: metadata?.contentEncoding,
          blobCacheControl: metadata?.cacheControl,
        },
        metadata: metadata?.customMetadata,
        tier: this.settings.tier,
      };

      await blockBlobClient.upload(data, data.length, options);

      const url = blockBlobClient.url;
      logger.info(`Uploaded blob to Azure: ${fullKey}`);
      return url;
    });
  }

  async download(key: string): Promise<Buffer> {
    return this.withErrorHandling(async () => {
      const fullKey = this.getFullKey(key);
      const containerClient = this.serviceClient!.getContainerClient(this.settings.containerName);
      const blockBlobClient = containerClient.getBlockBlobClient(fullKey);

      const downloadResponse = await blockBlobClient.download();

      if (!downloadResponse.readableStreamBody) {
        throw new Error(`No data returned for key: ${fullKey}`);
      }

      const chunks: Buffer[] = [];
      for await (const chunk of downloadResponse.readableStreamBody) {
        chunks.push(Buffer.from(chunk));
      }

      const buffer = Buffer.concat(chunks);
      logger.info(`Downloaded blob from Azure: ${fullKey} (${buffer.length} bytes)`);
      return buffer;
    });
  }

  async delete(key: string): Promise<void> {
    return this.withErrorHandling(async () => {
      const fullKey = this.getFullKey(key);
      const containerClient = this.serviceClient!.getContainerClient(this.settings.containerName);
      const blockBlobClient = containerClient.getBlockBlobClient(fullKey);

      await blockBlobClient.delete();
      logger.info(`Deleted blob from Azure: ${fullKey}`);
    });
  }

  async getSignedUrl(key: string, expiresIn: number): Promise<string> {
    return this.withErrorHandling(async () => {
      const fullKey = this.getFullKey(key);
      const containerClient = this.serviceClient!.getContainerClient(this.settings.containerName);
      const blockBlobClient = containerClient.getBlockBlobClient(fullKey);

      const startsOn = new Date();
      const expiresOn = new Date(startsOn.getTime() + expiresIn * 1000);

      const sasToken = generateBlobSASQueryParameters(
        {
          containerName: this.settings.containerName,
          blobName: fullKey,
          permissions: BlobSASPermissions.parse('r'),
          startsOn,
          expiresOn,
        },
        this.credential!
      ).toString();

      const url = `${blockBlobClient.url}?${sasToken}`;
      logger.info(`Generated SAS URL for Azure blob: ${fullKey} (expires in ${expiresIn}s)`);
      return url;
    });
  }

  async exists(key: string): Promise<boolean> {
    return this.withErrorHandling(async () => {
      const fullKey = this.getFullKey(key);
      const containerClient = this.serviceClient!.getContainerClient(this.settings.containerName);
      const blockBlobClient = containerClient.getBlockBlobClient(fullKey);

      return await blockBlobClient.exists();
    });
  }

  async list(prefix?: string, maxResults: number = 1000): Promise<StorageObject[]> {
    return this.withErrorHandling(async () => {
      const fullPrefix = this.getFullKey(prefix || '');
      const containerClient = this.serviceClient!.getContainerClient(this.settings.containerName);

      const objects: StorageObject[] = [];
      const iterator = containerClient.listBlobsFlat({
        prefix: fullPrefix,
      }).byPage({ maxPageSize: maxResults });

      for await (const page of iterator) {
        for (const blob of page.segment.blobItems) {
          objects.push({
            key: this.stripPrefix(blob.name),
            size: blob.properties.contentLength || 0,
            lastModified: blob.properties.lastModified || new Date(),
            contentType: blob.properties.contentType,
            etag: blob.properties.etag,
          });
        }
        break; // Only get first page
      }

      logger.info(`Listed ${objects.length} blobs from Azure with prefix: ${fullPrefix}`);
      return objects;
    });
  }

  /**
   * Get full key with prefix
   */
  private getFullKey(key: string): string {
    if (this.settings.prefix) {
      return `${this.settings.prefix}${key}`;
    }
    return key;
  }

  /**
   * Strip prefix from key
   */
  private stripPrefix(key: string): string {
    if (this.settings.prefix && key.startsWith(this.settings.prefix)) {
      return key.substring(this.settings.prefix.length);
    }
    return key;
  }
}
