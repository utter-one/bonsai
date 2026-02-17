import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { StorageProviderBase } from './StorageProviderBase';
import type { StorageMetadata, StorageObject } from './IStorageProvider';
import { logger } from '../../../utils/logger';

extendZodWithOpenApi(z);

/**
 * Local storage provider configuration schema
 */
export const localStorageProviderConfigSchema = z.object({
  basePath: z.string().describe('Base directory path for local storage'),
  baseUrl: z.string().optional().describe('Base URL for generating file URLs (if files are served via HTTP)'),
}).openapi('LocalStorageConfig');

/**
 * Local storage settings schema
 */
export const localStorageSettingsSchema = z.object({
  subPath: z.string().optional().describe('Subdirectory within basePath for this project'),
}).openapi('LocalStorageSettings');

export type LocalStorageProviderConfig = z.infer<typeof localStorageProviderConfigSchema>;
export type LocalStorageSettings = z.infer<typeof localStorageSettingsSchema>;

/**
 * Token-based signed URL storage for local filesystem
 */
interface SignedUrlToken {
  key: string;
  expiresAt: number;
}

/**
 * Local filesystem storage provider implementation
 */
export class LocalStorageProvider extends StorageProviderBase<LocalStorageProviderConfig> {
  private settings: LocalStorageSettings;
  private signedUrlTokens: Map<string, SignedUrlToken> = new Map();

  constructor(config: LocalStorageProviderConfig, settings: LocalStorageSettings) {
    super(config);
    this.settings = localStorageSettingsSchema.parse(settings);
  }

  async init(): Promise<void> {
    await super.init();
    const fullPath = this.getFullPath('');
    await fs.mkdir(fullPath, { recursive: true });
    logger.info(`Local storage provider initialized at: ${fullPath}`);
  }

  async upload(key: string, data: Buffer, metadata?: StorageMetadata): Promise<string> {
    return this.withErrorHandling(async () => {
      const fullPath = this.getFullPath(key);
      const dir = path.dirname(fullPath);

      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(fullPath, data);

      // Store metadata in extended attributes or sidecar file
      if (metadata) {
        await this.writeMetadata(fullPath, metadata);
      }

      const url = this.generateUrl(key);
      logger.info(`Uploaded file to local storage: ${fullPath}`);
      return url;
    });
  }

  async download(key: string): Promise<Buffer> {
    return this.withErrorHandling(async () => {
      const fullPath = this.getFullPath(key);
      const buffer = await fs.readFile(fullPath);
      logger.info(`Downloaded file from local storage: ${fullPath} (${buffer.length} bytes)`);
      return buffer;
    });
  }

  async delete(key: string): Promise<void> {
    return this.withErrorHandling(async () => {
      const fullPath = this.getFullPath(key);
      await fs.unlink(fullPath);

      // Also delete metadata file
      const metadataPath = `${fullPath}.metadata.json`;
      try {
        await fs.unlink(metadataPath);
      } catch {
        // Metadata file may not exist
      }

      logger.info(`Deleted file from local storage: ${fullPath}`);
    });
  }

  async getSignedUrl(key: string, expiresIn: number): Promise<string> {
    return this.withErrorHandling(async () => {
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = Date.now() + expiresIn * 1000;

      this.signedUrlTokens.set(token, { key, expiresAt });

      // Clean up expired tokens periodically
      this.cleanupExpiredTokens();

      const url = `${this.config!.baseUrl || 'file://'}?token=${token}`;
      logger.info(`Generated signed URL for local file: ${key} (expires in ${expiresIn}s)`);
      return url;
    });
  }

  async exists(key: string): Promise<boolean> {
    return this.withErrorHandling(async () => {
      const fullPath = this.getFullPath(key);
      try {
        await fs.access(fullPath);
        return true;
      } catch {
        return false;
      }
    });
  }

  async list(prefix?: string, maxResults: number = 1000): Promise<StorageObject[]> {
    return this.withErrorHandling(async () => {
      const fullPath = this.getFullPath(prefix || '');
      const objects: StorageObject[] = [];

      const collectFiles = async (dir: string, relativeBase: string) => {
        if (objects.length >= maxResults) return;

        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });

          for (const entry of entries) {
            if (objects.length >= maxResults) break;

            const fullEntryPath = path.join(dir, entry.name);
            const relativePath = path.join(relativeBase, entry.name);

            if (entry.isDirectory()) {
              await collectFiles(fullEntryPath, relativePath);
            } else if (entry.isFile() && !entry.name.endsWith('.metadata.json')) {
              const stats = await fs.stat(fullEntryPath);
              const metadata = await this.readMetadata(fullEntryPath);

              objects.push({
                key: relativePath,
                size: stats.size,
                lastModified: stats.mtime,
                contentType: metadata?.contentType,
                etag: undefined,
              });
            }
          }
        } catch (error: unknown) {
          if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
            // Directory doesn't exist, return empty list
            return;
          }
          throw error;
        }
      };

      await collectFiles(fullPath, prefix || '');

      logger.info(`Listed ${objects.length} files from local storage with prefix: ${prefix || ''}`);
      return objects;
    });
  }

  /**
   * Verify a signed URL token
   */
  verifySignedUrlToken(token: string): string | null {
    const entry = this.signedUrlTokens.get(token);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.signedUrlTokens.delete(token);
      return null;
    }

    return entry.key;
  }

  /**
   * Get full filesystem path
   */
  private getFullPath(key: string): string {
    const base = this.config!.basePath;
    const sub = this.settings.subPath || '';
    return path.join(base, sub, key);
  }

  /**
   * Generate URL for uploaded file
   */
  private generateUrl(key: string): string {
    if (this.config!.baseUrl) {
      const sub = this.settings.subPath || '';
      const fullKey = path.join(sub, key);
      return `${this.config!.baseUrl}/${fullKey}`;
    }
    return `file://${this.getFullPath(key)}`;
  }

  /**
   * Write metadata to sidecar file
   */
  private async writeMetadata(filePath: string, metadata: StorageMetadata): Promise<void> {
    const metadataPath = `${filePath}.metadata.json`;
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  }

  /**
   * Read metadata from sidecar file
   */
  private async readMetadata(filePath: string): Promise<StorageMetadata | undefined> {
    const metadataPath = `${filePath}.metadata.json`;
    try {
      const content = await fs.readFile(metadataPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return undefined;
    }
  }

  /**
   * Clean up expired signed URL tokens
   */
  private cleanupExpiredTokens(): void {
    const now = Date.now();
    for (const [token, entry] of this.signedUrlTokens.entries()) {
      if (now > entry.expiresAt) {
        this.signedUrlTokens.delete(token);
      }
    }
  }
}
