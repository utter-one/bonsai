import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command, type PutObjectCommandInput } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageProviderBase } from './StorageProviderBase';
import type { StorageMetadata, StorageObject } from './IStorageProvider';
import { logger } from '../../../utils/logger';

extendZodWithOpenApi(z);

/**
 * S3 storage provider configuration schema
 */
export const s3StorageProviderConfigSchema = z.object({
  accessKeyId: z.string().describe('AWS access key ID'),
  secretAccessKey: z.string().describe('AWS secret access key'),
  region: z.string().describe('AWS region (e.g., us-east-1)'),
  endpoint: z.string().optional().describe('Custom endpoint for S3-compatible services (e.g., MinIO)'),
}).openapi('S3StorageConfig');

/**
 * S3 storage provider settings schema
 */
export const s3StorageSettingsSchema = z.object({
  bucket: z.string().describe('S3 bucket name'),
  prefix: z.string().optional().describe('Key prefix for all operations (e.g., "projects/123/")'),
  acl: z.enum(['private', 'public-read', 'public-read-write', 'authenticated-read']).optional().describe('Access control list for uploaded objects'),
  serverSideEncryption: z.enum(['AES256', 'aws:kms']).optional().describe('Server-side encryption method'),
}).openapi('S3StorageSettings');

export type S3StorageProviderConfig = z.infer<typeof s3StorageProviderConfigSchema>;
export type S3StorageSettings = z.infer<typeof s3StorageSettingsSchema>;

/**
 * AWS S3 storage provider implementation
 */
export class S3StorageProvider extends StorageProviderBase<S3StorageProviderConfig> {
  private client?: S3Client;
  private settings: S3StorageSettings;

  constructor(config: S3StorageProviderConfig, settings: S3StorageSettings) {
    super(config);
    this.settings = s3StorageSettingsSchema.parse(settings);
  }

  async init(): Promise<void> {
    await super.init();
    this.client = new S3Client({
      credentials: {
        accessKeyId: this.config!.accessKeyId,
        secretAccessKey: this.config!.secretAccessKey,
      },
      region: this.config!.region,
      endpoint: this.config!.endpoint,
      forcePathStyle: !!this.config!.endpoint, // Required for MinIO and other S3-compatible services
    });
    logger.info(`S3 storage provider initialized for bucket: ${this.settings.bucket}`);
  }

  async upload(key: string, data: Buffer, metadata?: StorageMetadata): Promise<string> {
    return this.withErrorHandling(async () => {
      const fullKey = this.getFullKey(key);
      const input: PutObjectCommandInput = {
        Bucket: this.settings.bucket,
        Key: fullKey,
        Body: data,
        ContentType: metadata?.contentType,
        ContentEncoding: metadata?.contentEncoding,
        CacheControl: metadata?.cacheControl,
        ACL: this.settings.acl,
        ServerSideEncryption: this.settings.serverSideEncryption,
        Metadata: metadata?.customMetadata,
      };

      const command = new PutObjectCommand(input);
      await this.client!.send(command);

      const url = this.config!.endpoint ? `${this.config!.endpoint}/${this.settings.bucket}/${fullKey}` : `https://${this.settings.bucket}.s3.${this.config!.region}.amazonaws.com/${fullKey}`;

      logger.info(`Uploaded file to S3: ${fullKey}`);
      return url;
    });
  }

  async download(key: string): Promise<Buffer> {
    return this.withErrorHandling(async () => {
      const fullKey = this.getFullKey(key);
      const command = new GetObjectCommand({
        Bucket: this.settings.bucket,
        Key: fullKey,
      });

      const response = await this.client!.send(command);
      const chunks: Uint8Array[] = [];

      if (!response.Body) {
        throw new Error(`No data returned for key: ${fullKey}`);
      }

      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }

      const buffer = Buffer.concat(chunks);
      logger.info(`Downloaded file from S3: ${fullKey} (${buffer.length} bytes)`);
      return buffer;
    });
  }

  async delete(key: string): Promise<void> {
    return this.withErrorHandling(async () => {
      const fullKey = this.getFullKey(key);
      const command = new DeleteObjectCommand({
        Bucket: this.settings.bucket,
        Key: fullKey,
      });

      await this.client!.send(command);
      logger.info(`Deleted file from S3: ${fullKey}`);
    });
  }

  async getSignedUrl(key: string, expiresIn: number): Promise<string> {
    return this.withErrorHandling(async () => {
      const fullKey = this.getFullKey(key);
      const command = new GetObjectCommand({
        Bucket: this.settings.bucket,
        Key: fullKey,
      });

      const url = await getSignedUrl(this.client!, command, { expiresIn });
      logger.info(`Generated signed URL for S3 key: ${fullKey} (expires in ${expiresIn}s)`);
      return url;
    });
  }

  async exists(key: string): Promise<boolean> {
    return this.withErrorHandling(async () => {
      const fullKey = this.getFullKey(key);
      try {
        const command = new HeadObjectCommand({
          Bucket: this.settings.bucket,
          Key: fullKey,
        });
        await this.client!.send(command);
        return true;
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'name' in error && error.name === 'NotFound') {
          return false;
        }
        throw error;
      }
    });
  }

  async list(prefix?: string, maxResults: number = 1000): Promise<StorageObject[]> {
    return this.withErrorHandling(async () => {
      const fullPrefix = this.getFullKey(prefix || '');
      const command = new ListObjectsV2Command({
        Bucket: this.settings.bucket,
        Prefix: fullPrefix,
        MaxKeys: maxResults,
      });

      const response = await this.client!.send(command);
      const objects: StorageObject[] = [];

      if (response.Contents) {
        for (const item of response.Contents) {
          if (item.Key) {
            objects.push({
              key: this.stripPrefix(item.Key),
              size: item.Size || 0,
              lastModified: item.LastModified || new Date(),
              contentType: undefined, // S3 ListObjects doesn't return content type
              etag: item.ETag,
            });
          }
        }
      }

      logger.info(`Listed ${objects.length} objects from S3 with prefix: ${fullPrefix}`);
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
