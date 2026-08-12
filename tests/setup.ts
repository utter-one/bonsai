import Mocha from 'mocha';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import request from 'supertest';
import * as schema from '../src/db/schema';

let container: PostgreSqlContainer | null = null;
let migrationPool: Pool | null = null;

export async function globalSetup(): Promise<void> {
  // SAFETY: verify Docker is available before starting the testcontainer.
  // Without Docker, the testcontainer silently fails and tests would hit
  // whatever DB_CONNECTION_STRING is in .env — wiping your local data.
  const { execSync } = await import('child_process');
  try {
    execSync('docker info', { stdio: 'ignore', timeout: 5000 });
  } catch {
    throw new Error(
      'Docker is not running or not accessible. '
      + 'E2E tests require a running Docker daemon for the testcontainer. '
      + 'Aborting to prevent tests from hitting your local database.',
    );
  }

  // 1. Start ephemeral PostgreSQL container
  container = await new PostgreSqlContainer('postgres:18-alpine')
    .withDatabase('bonsai_test')
    .withUsername('test')
    .withPassword('test')
    .start();

  const connStr = container.getConnectionUri();

  // 2. Set env vars BEFORE any app code imports db module
  process.env.DB_CONNECTION_STRING = connStr;
  process.env.JWT_SECRET = 'test-secret-key-for-e2e-testing-min-32-chars';
  process.env.DB_SSL = 'false';
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'silent'; // suppress pino output during tests
  process.env.PORT = '0'; // don't bind a real port in tests
  process.env.RATE_LIMIT_API_WINDOW_MS = '60000';
  process.env.RATE_LIMIT_API_MAX = '10000'; // generous limit for tests
  process.env.RATE_LIMIT_AUTH_WINDOW_MS = '60000';
  process.env.RATE_LIMIT_AUTH_MAX = '10000'; // generous limit for tests
  process.env.MASTER_ENCRYPTION_KEY = '0000000000000000000000000000000000000000000000000000000000000000'; // 32-byte hex key for test encryption

  // 3. Run migrations against the fresh container
  migrationPool = new Pool({ connectionString: connStr });
  const migrationDb = drizzle(migrationPool, { schema });
  await migrate(migrationDb, { migrationsFolder: './drizzle' });

  // 4. Bootstrap the Express app (lazy pool picks up the test connection string)
  //    We import here so the db module sees the test env vars.
  const { createApp } = await import('../src/server');
  const app = await createApp();
  (globalThis as any).__TEST_APP__ = app;

  // 5. Create initial operator and capture tokens
  const res = await request(app)
    .post('/api/setup/initial-operator')
    .send({
      id: 'test@example.com',
      name: 'Test Admin',
      password: 'testpassword123',
    });

  (globalThis as any).__TEST_ACCESS_TOKEN__ = res.body.accessToken;
  (globalThis as any).__TEST_REFRESH_TOKEN__ = res.body.refreshToken;
}

export async function globalTeardown(): Promise<void> {
  // Best-effort cleanup — don't block test exit
  migrationPool?.end().catch(() => {});
  container?.stop().catch(() => {});
}

// Register as Mocha root hook
export function rootHooks(): Mocha.RootHookObject {
  return {
    async beforeAll() {
      await globalSetup();
    },
    async afterAll() {
      await globalTeardown();
    },
  };
}
