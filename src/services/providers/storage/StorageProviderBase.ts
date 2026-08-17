import type { ErrorCallback } from '../../../types/callbacks';
import type { IStorageProvider, StorageMetadata, StorageObject } from './IStorageProvider';
import { getProviderCallRecorder } from '../../monitoring/ProviderCallRecorder';
import type { ProviderCallRecord } from '../../monitoring/ProviderCallRecorder';

/**
 * Base class for storage providers with common functionality.
 *
 * Instrumentation (P1-03): `upload`/`download` are concrete template wrappers
 * that record one provider_call_logs row each (bytes in `metrics.bytesOut`/
 * `metrics.bytesIn`); subclasses implement `doUpload`/`doDownload`. Provider
 * identity is stamped by StorageProviderFactory.
 */
export abstract class StorageProviderBase<TConfig> implements IStorageProvider {
  protected config?: TConfig;
  private onErrorCallback?: ErrorCallback;

  /** Stamped by StorageProviderFactory (P1-03). */
  providerId?: string;
  providerApiType?: string;

  constructor(config: TConfig) {
    this.config = config;
  }

  async init(): Promise<void> {
    // Base implementation - override in subclasses if needed
  }

  /**
   * Upload an object. Template wrapper — records one `storage.upload` call row;
   * the actual upload lives in `doUpload`.
   */
  async upload(key: string, data: Buffer, metadata?: StorageMetadata): Promise<string> {
    const startedAt = Date.now();
    try {
      const url = await this.doUpload(key, data, metadata);
      this.record('storage.upload', startedAt, null, { bytesOut: data.length });
      return url;
    } catch (error) {
      this.record('storage.upload', startedAt, error, { bytesOut: data.length });
      throw error;
    }
  }

  /**
   * Download an object. Template wrapper — records one `storage.download` call row;
   * the actual download lives in `doDownload`.
   */
  async download(key: string): Promise<Buffer> {
    const startedAt = Date.now();
    try {
      const data = await this.doDownload(key);
      this.record('storage.download', startedAt, null, { bytesIn: data.length });
      return data;
    } catch (error) {
      this.record('storage.download', startedAt, error, undefined);
      throw error;
    }
  }

  protected abstract doUpload(key: string, data: Buffer, metadata?: StorageMetadata): Promise<string>;
  protected abstract doDownload(key: string): Promise<Buffer>;
  abstract delete(key: string): Promise<void>;
  abstract getSignedUrl(key: string, expiresIn: number): Promise<string>;
  abstract exists(key: string): Promise<boolean>;
  abstract list(prefix?: string, maxResults?: number): Promise<StorageObject[]>;

  private record(operation: string, startedAt: number, error: unknown, metrics: { bytesIn?: number; bytesOut?: number } | undefined): void {
    if (!this.providerId || !this.providerApiType) return; // constructed outside the factory — nothing to attribute to
    this.resolveCallRecorder().record({
      providerId: this.providerId,
      providerType: 'storage',
      apiType: this.providerApiType,
      operation,
      durationMs: Date.now() - startedAt,
      ok: error === null,
      error: error ?? undefined,
      metrics,
    });
  }

  /** Test seam — overridable so unit tests can redirect recording away from the DI container. */
  protected resolveCallRecorder(): { record(entry: ProviderCallRecord): void } {
    return getProviderCallRecorder();
  }

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
