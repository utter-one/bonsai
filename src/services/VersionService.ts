import { singleton } from 'tsyringe';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getOpenAPISpec } from '../swagger';
import { logger } from '../utils/logger';
import type { VersionResponse } from '../http/contracts/version';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Service that computes and caches content-addressed hashes of the REST and WebSocket API schemas.
 * Both hashes are computed exactly once — in the constructor — and stored for the lifetime
 * of the process. The REST hash is derived from the in-memory OpenAPI spec (itself cached by
 * getOpenAPISpec). The WebSocket hash is derived from the committed
 * schemas/websocket-contracts.json artifact.
 */
@singleton()
export class VersionService {
  private readonly versionInfo: VersionResponse;

  constructor() {
    this.versionInfo = this.computeVersion();
    logger.info({ restSchemaHash: this.versionInfo.restSchemaHash, wsSchemaHash: this.versionInfo.wsSchemaHash, gitCommit: this.versionInfo.gitCommit }, 'API schema version hashes computed');
  }

  /**
   * Returns the cached version information: schema hashes and the git commit SHA.
   */
  getVersion(): VersionResponse {
    return this.versionInfo;
  }

  private computeVersion(): VersionResponse {
    return {
      restSchemaHash: this.hashRestSchema(),
      wsSchemaHash: this.hashWsSchema(),
      gitCommit: process.env.GIT_COMMIT ?? null,
    };
  }

  private hashRestSchema(): string {
    const spec = getOpenAPISpec();
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
