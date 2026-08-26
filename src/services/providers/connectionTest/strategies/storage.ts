import { randomUUID } from 'node:crypto';
import { access, constants, stat } from 'node:fs/promises';
import { container } from 'tsyringe';
import { ValidationError } from '../../../../errors';
import { StorageProviderFactory, type StorageSettings } from '../../storage/StorageProviderFactory';
import type { IStorageProvider, StorageObject } from '../../storage/IStorageProvider';
import { ConnectionTestFailure, sanitizeErrorText, type ConnectionTestContext, type ConnectionTestOutcome, type ConnectionTestRequest, type ConnectionTestStrategy, type TestProtocol } from '../types';

/** Hard timeout for the whole storage test body (TPC-01 guard table). */
const STORAGE_TEST_TIMEOUT_MS = 15_000;

/** Throwaway key for the optional write round trip (always deleted in `finally`). */
const TEST_KEY_PREFIX = 'bonsai-connection-test';

/** 1 KB round-trip payload — byte-compared on download, never persisted anywhere else. */
const TEST_PAYLOAD: Buffer = Buffer.alloc(1024, 0xcd);

/**
 * Transport per apiType (TPC-05): a table — no per-vendor code paths. The
 * cloud variants go through their SDKs against the same endpoints production
 * uses (or the config's own `endpoint`/`apiEndpoint` override); `local` is a
 * direct filesystem check.
 */
const STORAGE_PROTOCOL_BY_API_TYPE: Record<string, TestProtocol> = {
  s3: 'sdk',
  'azure-blob': 'sdk',
  gcs: 'sdk',
  local: 'local-fs',
};

/** Fresh per-test state built by the strategy. No `cleanup` — storage providers hold no session resources. */
export interface StorageTestInstance {
  storage: IStorageProvider;
  /** local only: the configured base directory (pre-checked, reported in detail.path). */
  basePath: string | null;
}

/**
 * Storage connection strategy (TPC-05): verify auth + bucket availability +
 * credentials' read scope with a real `list(1)` against the provider's
 * production client path (same SDK, endpoint and credentials a conversation
 * turn uses). With `write: true` the test additionally runs a full
 * upload → download (byte-compare) → delete round trip on a throwaway
 * 1 KB key — proving write scope, and the key is ALWAYS deleted in `finally`,
 * even on a mismatch.
 *
 * `local` differs by nature (no third party): the configured base directory
 * is pre-checked for existence + read/write access (a misconfiguration is
 * `client_error`, not a vendor failure) and reported as `detail.path`. The
 * check runs BEFORE the provider is built because LocalStorageProvider.init()
 * auto-creates a missing directory.
 *
 * All 4 apiTypes are covered by construction — the factory maps them, the
 * strategy contains no per-vendor code (the one exception is the local
 * pre-check the spec mandates). Saved-mode round-trips record their own
 * `storage.upload`/`storage.download` rows under the tester's monitoring
 * context (breaker-excluded); `list`/`delete` are not instrumented by the
 * production base, and draft instances are un-stamped (record nothing).
 */
export function buildStorageConnectionTestStrategy(): ConnectionTestStrategy<StorageTestInstance> {
  return {
    providerType: 'storage',
    timeoutMs: STORAGE_TEST_TIMEOUT_MS,
    protocol: 'sdk',

    async buildInstance(request: ConnectionTestRequest, _ctx: ConnectionTestContext): Promise<StorageTestInstance> {
      const factory = container.resolve(StorageProviderFactory);

      // local: pre-check the base directory (existence + R/W) BEFORE building —
      // LocalStorageProvider.init() would auto-create a missing directory and
      // mask the misconfiguration. Missing/unwritable is a configuration
      // error, not a third-party failure (spec: client_error).
      let basePath: string | null = null;
      if (request.apiType === 'local') {
        basePath = readLocalBasePath(request.provider);
        await assertLocalDirectory(basePath);
      }

      const storage = await factory.createForTest(request.provider, buildStorageSettings(request));
      return { storage, basePath };
    },

    async test(request: ConnectionTestRequest, instance: StorageTestInstance, _ctx: ConnectionTestContext): Promise<ConnectionTestOutcome> {
      const { storage, basePath } = instance;
      const protocol = STORAGE_PROTOCOL_BY_API_TYPE[request.apiType] ?? 'sdk';
      const outcomeBase: Pick<ConnectionTestOutcome, 'providerType' | 'apiType' | 'protocol' | 'latencyMs' | 'statusHttp'> = {
        providerType: request.providerType,
        apiType: request.apiType,
        protocol,
        latencyMs: 0, // tester-owned (total elapsed)
        statusHttp: null,
      };
      const pathDetail = basePath ? { path: basePath } : {};

      // Default (read-only): one list(1) — verifies credentials, bucket
      // existence and network at zero cost.
      let objects: StorageObject[];
      try {
        objects = await storage.list(undefined, 1);
      } catch (error) {
        // local: filesystem errors are misconfiguration, not a vendor.
        if (request.apiType === 'local') {
          throw new ConnectionTestFailure(`Local storage listing failed for '${basePath}': ${sanitizeErrorText(error instanceof Error ? error.message : String(error))}`, 'auth', undefined, 'client_error');
        }
        throw error;
      }

      if (request.write !== true) {
        return {
          ...outcomeBase,
          ok: true,
          phase: 'first-data',
          errorCode: null,
          detail: { objects: objects.length, ...pathDetail },
        };
      }

      // Write round trip: upload → download (byte-compare) → delete.
      // The key is a fresh uuid and ALWAYS deleted in `finally` — even when
      // the download mismatches or the comparison throws.
      const key = `${TEST_KEY_PREFIX}/${randomUUID()}`;
      try {
        await storage.upload(key, TEST_PAYLOAD, { contentType: 'application/octet-stream' });
        const downloaded = await storage.download(key);
        const verified = downloaded.length === TEST_PAYLOAD.length && downloaded.equals(TEST_PAYLOAD);
        if (!verified) {
          // The vendor accepted the upload but returned different bytes — a
          // round-trip integrity failure, not an auth or network problem.
          throw new ConnectionTestFailure(`Storage round trip mismatch: uploaded ${TEST_PAYLOAD.length} bytes, downloaded ${downloaded.length}`, 'write', undefined, 'server_error');
        }
        return {
          ...outcomeBase,
          ok: true,
          phase: 'write',
          errorCode: null,
          detail: { wrote: true, verified: true, ...pathDetail },
        };
      } finally {
        await storage.delete(key).catch(() => undefined); // best effort — never mask the real outcome
      }
    },
  };
}

/** local: `basePath` is a required plaintext config field (not a secret). */
function readLocalBasePath(provider: ConnectionTestRequest['provider']): string {
  const basePath = (provider.config as Record<string, unknown> | null)?.basePath;
  if (typeof basePath !== 'string' || basePath.length === 0) {
    throw new ValidationError('Local storage connection test requires a non-empty basePath in the provider config', []);
  }
  return basePath;
}

/** local: existence + directory-ness + read/write access, as `client_error` failures. */
async function assertLocalDirectory(basePath: string): Promise<void> {
  try {
    const stats = await stat(basePath);
    if (!stats.isDirectory()) {
      throw new ConnectionTestFailure(`Local storage path '${basePath}' is not a directory`, 'auth', undefined, 'client_error');
    }
    await access(basePath, constants.R_OK | constants.W_OK);
  } catch (err) {
    if (err instanceof ConnectionTestFailure) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new ConnectionTestFailure(`Local storage directory '${basePath}' is missing or not readable/writable: ${sanitizeErrorText(message)}`, 'auth', undefined, 'client_error');
  }
}

/** Per-apiType settings — storage settings are per-project in production, so the bucket comes from the test input. */
function buildStorageSettings(request: ConnectionTestRequest): StorageSettings {
  switch (request.apiType) {
    case 's3':
      if (!request.bucket) throw new ValidationError('Storage connection test for s3 requires the bucket input parameter', []);
      return { bucket: request.bucket };
    case 'azure-blob':
      if (!request.bucket) throw new ValidationError('Storage connection test for azure-blob requires the bucket (container) input parameter', []);
      return { containerName: request.bucket };
    case 'gcs':
      if (!request.bucket) throw new ValidationError('Storage connection test for gcs requires the bucket input parameter', []);
      return { bucketName: request.bucket };
    case 'local':
      return {};
    default:
      throw new ValidationError(`Unsupported storage provider API type for connection test: ${request.apiType}`, []);
  }
}
