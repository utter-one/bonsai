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

function createPool(): Pool {
  const pool = new Pool({
    connectionString: process.env.DB_CONNECTION_STRING,
    max: parseInt(process.env.DB_POOL_SIZE || '10'),
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
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
