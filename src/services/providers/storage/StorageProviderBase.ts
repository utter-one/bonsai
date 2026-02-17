import type { ErrorCallback } from '../../../types/callbacks';
import type { IStorageProvider, StorageMetadata, StorageObject } from './IStorageProvider';

/**
 * Base class for storage providers with common functionality
 */
export abstract class StorageProviderBase<TConfig> implements IStorageProvider {
  protected config?: TConfig;
  private onErrorCallback?: ErrorCallback;

  constructor(config: TConfig) {
    this.config = config;
  }

  async init(): Promise<void> {
    // Base implementation - override in subclasses if needed
  }

  abstract upload(key: string, data: Buffer, metadata?: StorageMetadata): Promise<string>;
  abstract download(key: string): Promise<Buffer>;
  abstract delete(key: string): Promise<void>;
  abstract getSignedUrl(key: string, expiresIn: number): Promise<string>;
  abstract exists(key: string): Promise<boolean>;
  abstract list(prefix?: string, maxResults?: number): Promise<StorageObject[]>;

  setOnError(cb: ErrorCallback): void {
    this.onErrorCallback = cb;
  }

  /**
   * Notify error callback if registered
   */
  protected notifyError(error: Error): void {
    if (this.onErrorCallback) {
      this.onErrorCallback(error);
    }
  }

  /**
   * Wrap async operations with error handling
   */
  protected async withErrorHandling<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.notifyError(err);
      throw err;
    }
  }
}
