import { singleton } from 'tsyringe';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { logger } from '../utils/logger';
import type { VersionResponse } from '../http/contracts/version';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Lazily-registered provider of the OpenAPI spec object. Must be set via
 * {@link setSpecProvider} before the first call to {@link VersionService.getVersion}.
 * This indirection breaks the circular module dependency:
 * VersionService → swagger → MigrationController → MigrationService → VersionService.
 */
let _specProvider: (() => object) | null = null;

/**
 * Registers the function used to obtain the OpenAPI spec for REST schema hashing.
 * Should be called once during application startup, before the IoC container resolves
 * {@link VersionService}.
 * @param fn - Function that returns the current OpenAPI spec object.
 */
export function setSpecProvider(fn: () => object): void {
  _specProvider = fn;
}

/**
 * Service that computes and caches content-addressed hashes of the REST and WebSocket API schemas.
 * Both hashes are computed on the first call to {@link getVersion} and cached for the lifetime
 * of the process. The REST hash is derived from the in-memory OpenAPI spec (via the registered
 * spec provider). The WebSocket hash is derived from the committed
 * schemas/websocket-contracts.json artifact.
 */
@singleton()
export class VersionService {
  private versionInfo: VersionResponse | null = null;

  /**
   * Returns the cached version information: schema hashes and the git commit SHA.
   * Computes and caches on the first invocation.
   */
  getVersion(): VersionResponse {
    if (!this.versionInfo) {
      this.versionInfo = this.computeVersion();
      logger.info({ restSchemaHash: this.versionInfo.restSchemaHash, wsSchemaHash: this.versionInfo.wsSchemaHash, gitCommit: this.versionInfo.gitCommit }, 'API schema version hashes computed');
    }
    return this.versionInfo;
  }

  private computeVersion(): VersionResponse {
    return {
      version: this.readPackageVersion() + this.getVersionSuffix(),
      restSchemaHash: this.hashRestSchema(),
      wsSchemaHash: this.hashWsSchema(),
      gitCommit: process.env.GIT_COMMIT ?? process.env.SOURCE_COMMIT,
    };
  }

  private readPackageVersion(): string {
    try {
      const pkgPath = join(__dirname, '../../package.json');
      const content = readFileSync(pkgPath, 'utf-8');
      return (JSON.parse(content) as { version: string }).version;
    } catch (error) {
      logger.warn({ error }, 'Failed to read package.json for version — returning "unknown"');
      return 'unknown';
    }
  }

  private getVersionSuffix(): string {
    const commitHash = process.env.GIT_COMMIT ?? process.env.SOURCE_COMMIT;
    const environment = process.env.NODE_ENV ?? 'dev';
    let suffix = '';
    if (environment !== 'production') { 
      suffix = environment ? `${environment}-` : '';
      if (!commitHash) {
        suffix += `local`;
      } else {
        suffix += `${commitHash.slice(0, 7)}`;
      }
    }

    return suffix ? `-${suffix}` : '';
  }

  private hashRestSchema(): string {
    if (!_specProvider) {
      logger.warn('VersionService: spec provider not registered — REST schema hash will be empty. Call setSpecProvider() before resolving VersionService.');
      return createHash('sha256').update('{}').digest('hex').slice(0, 12);
    }
    const spec = _specProvider();
    return createHash('sha256').update(JSON.stringify(spec)).digest('hex').slice(0, 12);
  }

  private hashWsSchema(): string {
    try {
      const schemaPath = join(__dirname, '../../schemas/websocket-contracts.json');
      const content = readFileSync(schemaPath, 'utf-8');
      return createHash('sha256').update(content).digest('hex').slice(0, 12);
    } catch (error) {
      logger.warn({ error }, 'Failed to read WebSocket contracts schema for hashing — returning "unavailable"');
      return 'unavailable';
    }
  }
}
