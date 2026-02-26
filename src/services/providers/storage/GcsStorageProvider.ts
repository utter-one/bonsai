import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { Storage, type GetSignedUrlConfig } from '@google-cloud/storage';
import { StorageProviderBase } from './StorageProviderBase';
import type { StorageMetadata, StorageObject } from './IStorageProvider';
import { logger } from '../../../utils/logger';

extendZodWithOpenApi(z);

/**
 * Google Cloud Storage provider configuration schema
 */
export const gcsStorageProviderConfigSchema = z.strictObject({
  projectId: z.string().describe('Google Cloud project ID'),
  keyFileJson: z.string().describe('Service account key file content as JSON string'),
}).openapi('GcsStorageConfig');

/**
 * Google Cloud Storage settings schema
 */
export const gcsStorageSettingsSchema = z.object({
  bucketName: z.string().describe('Google Cloud Storage bucket name'),
  prefix: z.string().optional().describe('Object prefix for all operations (e.g., "projects/123/")'),
  storageClass: z.enum(['STANDARD', 'NEARLINE', 'COLDLINE', 'ARCHIVE']).optional().describe('Storage class for uploaded objects'),
}).openapi('GcsStorageSettings');

export type GcsStorageProviderConfig = z.infer<typeof gcsStorageProviderConfigSchema>;
export type GcsStorageSettings = z.infer<typeof gcsStorageSettingsSchema>;

/**
 * Google Cloud Storage provider implementation
 */
export class GcsStorageProvider extends StorageProviderBase<GcsStorageProviderConfig> {
  private storage?: Storage;
  private settings: GcsStorageSettings;

  constructor(config: GcsStorageProviderConfig, settings: GcsStorageSettings) {
    super(config);
    this.settings = gcsStorageSettingsSchema.parse(settings);
  }

  async init(): Promise<void> {
    await super.init();
    const credentials = JSON.parse(this.config!.keyFileJson);
    this.storage = new Storage({
      projectId: this.config!.projectId,
      credentials,
    });
    logger.info(`Google Cloud Storage provider initialized for bucket: ${this.settings.bucketName}`);
  }

  async upload(key: string, data: Buffer, metadata?: StorageMetadata): Promise<string> {
    return this.withErrorHandling(async () => {
      const fullKey = this.getFullKey(key);
      const bucket = this.storage!.bucket(this.settings.bucketName);
      const file = bucket.file(fullKey);

      const options: Parameters<typeof file.save>[1] = {
        contentType: metadata?.contentType,
        metadata: metadata?.customMetadata ? { metadata: metadata.customMetadata } : undefined,
      };

      if (this.settings.storageClass) {
        options.metadata = {
          ...options.metadata,
          storageClass: this.settings.storageClass,
        };
      }

      await file.save(data, options);

      const url = `https://storage.googleapis.com/${this.settings.bucketName}/${fullKey}`;
      logger.info(`Uploaded file to GCS: ${fullKey}`);
      return url;
    });
  }

  async download(key: string): Promise<Buffer> {
    return this.withErrorHandling(async () => {
      const fullKey = this.getFullKey(key);
      const bucket = this.storage!.bucket(this.settings.bucketName);
      const file = bucket.file(fullKey);

      const [buffer] = await file.download();
      logger.info(`Downloaded file from GCS: ${fullKey} (${buffer.length} bytes)`);
      return buffer;
    });
  }

  async delete(key: string): Promise<void> {
    return this.withErrorHandling(async () => {
      const fullKey = this.getFullKey(key);
      const bucket = this.storage!.bucket(this.settings.bucketName);
      const file = bucket.file(fullKey);

      await file.delete();
      logger.info(`Deleted file from GCS: ${fullKey}`);
    });
  }

  async getSignedUrl(key: string, expiresIn: number): Promise<string> {
    return this.withErrorHandling(async () => {
      const fullKey = this.getFullKey(key);
      const bucket = this.storage!.bucket(this.settings.bucketName);
      const file = bucket.file(fullKey);

      const options: GetSignedUrlConfig = {
        version: 'v4',
        action: 'read',
        expires: Date.now() + expiresIn * 1000,
      };

      const [url] = await file.getSignedUrl(options);
      logger.info(`Generated signed URL for GCS file: ${fullKey} (expires in ${expiresIn}s)`);
      return url;
    });
  }

  async exists(key: string): Promise<boolean> {
    return this.withErrorHandling(async () => {
      const fullKey = this.getFullKey(key);
      const bucket = this.storage!.bucket(this.settings.bucketName);
      const file = bucket.file(fullKey);

      const [exists] = await file.exists();
      return exists;
    });
  }

  async list(prefix?: string, maxResults: number = 1000): Promise<StorageObject[]> {
    return this.withErrorHandling(async () => {
      const fullPrefix = this.getFullKey(prefix || '');
      const bucket = this.storage!.bucket(this.settings.bucketName);

      const [files] = await bucket.getFiles({
        prefix: fullPrefix,
        maxResults,
      });

      const objects: StorageObject[] = files.map(file => ({
        key: this.stripPrefix(file.name),
        size: typeof file.metadata.size === 'number' ? file.metadata.size : parseInt(file.metadata.size || '0', 10),
        lastModified: new Date(file.metadata.updated || Date.now()),
        contentType: file.metadata.contentType,
        etag: file.metadata.etag,
      }));

      logger.info(`Listed ${objects.length} files from GCS with prefix: ${fullPrefix}`);
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
