import { randomUUID } from 'node:crypto';
import type { ErrorCallback } from '../../../types/callbacks';
import type { IStorageProvider, StorageMetadata, StorageObject } from './IStorageProvider';
import { getProviderCallRecorder } from '../../monitoring/ProviderCallRecorder';
import type { ProviderCallRecord } from '../../monitoring/ProviderCallRecorder';
import { ConnectionTestFailure, sanitizeErrorText } from '../connectionTest/types';
import type { ConnectionTestOutcome } from '../connectionTest/types';

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

  /** Stamped by the P3-04 failover wrapper on non-primary instances — operation rows carry `fallback_provider_id`. */
  fallbackOfProviderId?: string;

  /** P3-04 failover attribution — implemented for the `IStorageProvider` interface. */
  setFallbackOf(providerId: string): void {
    this.fallbackOfProviderId = providerId;
  }

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

  /**
   * Minimal production-path connection test (TPC-05): a real `list` (1 object)
   * against this provider's configured bucket — the same SDK/auth path
   * production uses. The provider owns the test; the tester owns the guards.
   * With `write`, it also uploads a 1 KB probe, downloads and byte-compares it,
   * then deletes it in a `finally` (best effort). Vendor failures escape as raw
   * errors (or as ConnectionTestFailure for the local path check).
   * @param opts.write Exercise the write path (upload+download+delete) when true.
   * @param opts.path For local providers: the raw configured base path, reported
   *                  in `detail.path` (the instance config holds the resolved
   *                  per-provider directory, so the raw path is passed in).
   */
  async testConnection(opts: { write: boolean; path: string | null }): Promise<ConnectionTestOutcome> {
    let objects: number;
    try {
      const entries = await this.list(undefined, 1);
      objects = entries.length;
    } catch (error) {
      // local: filesystem errors are misconfiguration, not a vendor failure.
      // (The tester's pre-construction check usually catches this first; this is
      // the defensive branch for a permissions race between check and list.)
      if (this.providerApiType === 'local') {
        throw new ConnectionTestFailure(`Local storage listing failed for '${opts.path ?? 'unknown path'}': ${sanitizeErrorText(error instanceof Error ? error.message : String(error))}`, 'auth', undefined, 'client_error');
      }
      throw error; // cloud: let the tester classify (e.g. access_denied)
    }

    const pathDetail = opts.path !== null ? { path: opts.path } : {};

    if (!opts.write) {
      return {
        ok: true,
        phase: 'first-data',
        errorCode: null,
        detail: { objects, ...pathDetail },
      };
    }

    // Write round trip: upload → download (byte-compare) → delete. The key is
    // a fresh uuid and is ALWAYS deleted in `finally` — even when the download
    // mismatches or the comparison throws. Upload runs through the production
    // template method (records `storage.upload`); download records
    // `storage.download`.
    const key = `bonsai-connection-test/${randomUUID()}`;
    const payload = Buffer.alloc(1024, 0xcd);
    try {
      await this.upload(key, payload, { contentType: 'application/octet-stream' });
      const downloaded = await this.download(key);
      const verified = downloaded.length === payload.length && downloaded.equals(payload);
      if (!verified) {
        // The vendor accepted the upload but returned different bytes — a
        // round-trip integrity failure, not an auth or network problem.
        throw new ConnectionTestFailure(`Storage round trip mismatch: uploaded ${payload.length} bytes, downloaded ${downloaded.length}`, 'write', undefined, 'server_error');
      }
      return {
        ok: true,
        phase: 'write',
        errorCode: null,
        detail: { wrote: true, verified: true, ...pathDetail },
      };
    } finally {
      await this.delete(key).catch(() => undefined); // best effort — never mask the real outcome
    }
  }

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
      fallbackProviderId: this.fallbackOfProviderId ?? null,
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
