import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import 'dotenv/config';
import logger from '../utils/logger';

type DbType = NodePgDatabase<typeof schema>;

// Lazy-initialized pool and db instance so that env vars can be set
// before the first import (e.g. E2E tests using testcontainers).
let _pool: Pool | null = null;
let _db: DbType | null = null;

function isLocalhost(connStr: string): boolean {
  // Match localhost, 127.0.0.1, or ::1 in the connection string
  return /postgresql:\/\/(?:[^@]+@)?(?:localhost|127\.0\.0\.1|\[::1\])/.test(connStr);
}

function buildSslConfig(connStr: string | undefined): boolean | { ca?: Buffer; rejectUnauthorized: boolean } {
  if (process.env.DB_SSL !== 'true') return false;

  // If CA cert is provided, always enforce strict verification
  if (process.env.DB_SSL_CA) {
    return {
      ca: Buffer.from(process.env.DB_SSL_CA, 'base64'),
      rejectUnauthorized: true,
    };
  }

  // Localhost connections have no MITM risk — self-signed certs are fine
  if (connStr && isLocalhost(connStr)) {
    return { rejectUnauthorized: false };
  }

  // Remote connections must verify certs
  if (process.env.NODE_ENV === 'production') {
    logger.warn(
      'DB_SSL=true for remote host without DB_SSL_CA. ' +
      'For production, set DB_SSL_CA to the base64-encoded CA certificate.',
    );
  }
  return { rejectUnauthorized: true };
}

function createPool(): Pool {
  const connStr = process.env.DB_CONNECTION_STRING;
  // SAFETY GATE: in test mode, refuse to connect to the default PostgreSQL port (5432).
  // The testcontainer uses a random high port (e.g. localhost:33248), so :5432 means
  // the testcontainer failed and we'd hit the local DB from .env.
  if (process.env.NODE_ENV === 'test' && connStr) {
    if (connStr.includes(':5432')) {
      throw new Error(
        'ABORT: Test mode detected but DB_CONNECTION_STRING uses port 5432 (default PostgreSQL). '
        + 'The testcontainer likely failed to start. Refusing to connect to prevent data loss. '
        + `Connection string: ${connStr}`,
      );
    }
  }
  const sslConfig = buildSslConfig(connStr);
  const pool = new Pool({
    connectionString: connStr,
    max: parseInt(process.env.DB_POOL_SIZE || '10'),
    ssl: sslConfig,
  });

  // Enforce UTC on every connection so that:
  // - PostgreSQL's NOW() / defaultNow() stores UTC time (not the server's local timezone)
  // - JS Date values sent by node-postgres are stored as UTC digits
  // Without this, timestamp WITHOUT timezone columns can differ by the server's UTC offset
  // when comparing defaultNow()-set columns against new Date()-set columns.
  pool.on('connect', (client) => {
    client.query("SET TIME ZONE 'UTC'").catch((err) => logger.error({ err }, 'Failed to set session timezone to UTC'));
  });

  pool.on('connect', () => {
    logger.debug('✅ Database connected successfully');
  });

  pool.on('error', (err) => {
    // Don't exit during tests — the container is being torn down
    if (process.env.NODE_ENV === 'test') {
      logger.debug({ err }, 'Database connection error (ignored in test mode)');
      return;
    }
    logger.error({ err }, '❌ Database connection error:');
    process.exit(1);
  });

  return pool;
}

function getPool(): Pool {
  if (!_pool) {
    _pool = createPool();
  }
  return _pool;
}

export function getDb(): DbType {
  // SAFETY GATE: in test mode, refuse to connect to the default PostgreSQL port (5432).
  // Tests MUST use a testcontainer (ephemeral DB on a random high port).
  // If this fires, the testcontainer failed to start or env vars weren't
  // set before the first import — aborting to prevent data loss.
  if (process.env.NODE_ENV === 'test') {
    const connStr = process.env.DB_CONNECTION_STRING || '';
    if (connStr.includes(':5432')) {
      throw new Error(
        'ABORT: Test mode detected but DB_CONNECTION_STRING uses port 5432 (default PostgreSQL). '
        + 'The testcontainer likely failed to start. Refusing to connect to prevent data loss. '
        + `Connection string: ${connStr}`,
      );
    }
  }
  if (!_db) {
    _db = drizzle(getPool(), { schema });
  }
  return _db;
}

// Default export — lazy proxy that delegates to getDb().
// Keeps existing `import { db } from './db/index'` working without changes.
export const db = new Proxy({}, {
  get(_target, prop) {
    return getDb()[prop as keyof DbType];
  },
}) as DbType;

// Export pool accessor for teardown (tests, graceful shutdown)
export function getPoolRef(): Pool {
  return getPool();
}

// Export schema for use in other modules
export * from './schema';
