import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import 'dotenv/config';

/**
 * Runs database migrations using Drizzle ORM migrator
 */
async function runMigrations() {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'nexus',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  const db = drizzle(pool);

  console.log('Running migrations...');
  
  await migrate(db, { migrationsFolder: './drizzle' });
  
  console.log('Migrations completed successfully!');
  
  await pool.end();
}

runMigrations().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
