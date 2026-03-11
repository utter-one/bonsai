import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import 'dotenv/config';
import logger from '../utils/logger';

// Create PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DB_CONNECTION_STRING,
  max: parseInt(process.env.DB_POOL_SIZE || '10'),
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

// Initialize Drizzle ORM
export const db = drizzle(pool, { schema });

// Export schema for use in other modules
export * from './schema';

// Enforce UTC on every connection so that:
// - PostgreSQL's NOW() / defaultNow() stores UTC time (not the server's local timezone)
// - JS Date values sent by node-postgres are stored as UTC digits
// Without this, timestamp WITHOUT timezone columns can differ by the server's UTC offset
// when comparing defaultNow()-set columns against new Date()-set columns.
pool.on('connect', (client) => {
  client.query("SET TIME ZONE 'UTC'").catch((err) => logger.error({ err }, 'Failed to set session timezone to UTC'));
});

pool.on('connect', () => {
  logger.info('✅ Database connected successfully');
});

pool.on('error', (err) => {
  logger.error({ err }, '❌ Database connection error:');
  process.exit(1);
});
