import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import 'dotenv/config';
import logger from '../utils/logger';

// Create PostgreSQL connection pool
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'nexus',
  max: parseInt(process.env.DB_POOL_SIZE || '10'),
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

// Initialize Drizzle ORM
export const db = drizzle(pool, { schema });

// Export schema for use in other modules
export * from './schema';

// Optional: Test connection
pool.on('connect', () => {
  logger.info('✅ Database connected successfully');
});

pool.on('error', (err) => {
  logger.error({ err }, '❌ Database connection error:');
  process.exit(1);
});
