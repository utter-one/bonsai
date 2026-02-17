import type { ErrorCallback } from '../../../types/callbacks';

/**
 * Storage provider interface for file storage operations
 */
export interface IStorageProvider {
  /**
   * Initialize the storage provider
   */
  init(): Promise<void>;

  /**
   * Upload a file to storage
   * @param key - Unique identifier for the file
   * @param data - File content as Buffer
   * @param metadata - Optional metadata (content-type, etc.)
   * @returns URL or identifier for the uploaded file
   */
  upload(key: string, data: Buffer, metadata?: StorageMetadata): Promise<string>;

  /**
   * Download a file from storage
   * @param key - Unique identifier for the file
   * @returns File content as Buffer
   */
  download(key: string): Promise<Buffer>;

  /**
   * Delete a file from storage
   * @param key - Unique identifier for the file
   */
  delete(key: string): Promise<void>;

  /**
   * Get a signed URL for temporary access
   * @param key - Unique identifier for the file
   * @param expiresIn - Expiration time in seconds
   * @returns Signed URL
   */
  getSignedUrl(key: string, expiresIn: number): Promise<string>;

  /**
   * Check if a file exists
   * @param key - Unique identifier for the file
   */
  exists(key: string): Promise<boolean>;

  /**
   * List files with optional prefix filter
   * @param prefix - Optional prefix to filter by
   * @param maxResults - Maximum number of results to return
   */
  list(prefix?: string, maxResults?: number): Promise<StorageObject[]>;

  /**
   * Register callback for errors
   */
  setOnError(cb: ErrorCallback): void;
}

/**
 * Metadata for storage objects
 */
export type StorageMetadata = {
  contentType?: string;
  contentEncoding?: string;
  cacheControl?: string;
  customMetadata?: Record<string, string>;
};

/**
 * Storage object information
 */
export type StorageObject = {
  key: string;
  size: number;
  lastModified: Date;
  contentType?: string;
  etag?: string;
};
