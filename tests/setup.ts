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
  process.env.RATE_LIMIT_WS_AUTH_WINDOW_MS = '60000';
  process.env.RATE_LIMIT_WS_AUTH_MAX = '10000'; // generous limit for tests (channel webhook rate limiter)
  process.env.MONITORING_HEALTH_INTERVAL_MS = '1000'; // fast health loop so health_checks rows appear within e2e tests
  process.env.MONITORING_HEALTH_PROBES = 'off'; // no live provider probes in tests — fake provider configs would hit real APIs
  process.env.MONITORING_ALERT_ENGINE_INTERVAL_MS = '1000'; // P2-01: fast engine loop so alert e2e tests converge quickly
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

  // 4b. Expose the app-world monitoring registry. E2E test files load in a separate
  //     module graph (mocha's tsx require hook vs this ESM entry chain), so their
  //     own `container.resolve(MetricsRegistry)` returns a DIFFERENT singleton than
  //     the app's. Reading the instance from globalThis (shared across module graphs)
  //     lets tests assert on the registry the middleware actually records into.
  const { container: iocContainer } = await import('tsyringe');
  const { MetricsRegistry } = await import('../src/services/monitoring/MetricsRegistry');
  const { MonitoringConfigService } = await import('../src/services/monitoring/MonitoringConfigService');
  const { RetentionService } = await import('../src/services/monitoring/RetentionService');
  (globalThis as any).__TEST_METRICS_REGISTRY__ = iocContainer.resolve(MetricsRegistry);
  // P1-06: app-world config + retention singletons (same dual-module-graph reason).
  (globalThis as any).__TEST_MONITORING_CONFIG__ = iocContainer.resolve(MonitoringConfigService);
  (globalThis as any).__TEST_RETENTION_SERVICE__ = iocContainer.resolve(RetentionService);
  // P1-07: app-world rate limiter test seams (store reset + top-N rejection map).
  const { resetRateLimitersForTests, getRateLimitRejectionStats } = await import('../src/http/middleware/rateLimiter');
  (globalThis as any).__TEST_RATE_LIMITS__ = { reset: resetRateLimitersForTests, getStats: getRateLimitRejectionStats };
  // P2-01: app-world alert engine + health service singletons (dual module graph).
  // Tests use runNow() for deterministic passes and the 1 s background interval otherwise.
  const { AlertRuleEngine } = await import('../src/services/monitoring/AlertRuleEngine');
  const { HealthCheckService: AppHealthCheckService } = await import('../src/services/monitoring/HealthCheckService');
  (globalThis as any).__TEST_ALERT_ENGINE__ = iocContainer.resolve(AlertRuleEngine);
  (globalThis as any).__TEST_HEALTH_SERVICE__ = iocContainer.resolve(AppHealthCheckService);
  // P2-02: app-world alert publisher — read from the engine's own injected
  // instance. (Resolving the string token directly yields a DIFFERENT
  // NotifyingPublisher: tsyringe keeps the token provider cache separate from
  // the @singleton class cache.)
  (globalThis as any).__TEST_ALERT_PUBLISHER__ = (iocContainer.resolve(AlertRuleEngine) as any).publisher;
  // P3-01: app-world LLM provider factory — e2e drives the instrumented
  // generate() path directly (there is no HTTP endpoint that runs an LLM turn
  // in the e2e process: quick prompts are templates, conversation input is
  // WebSocket-only) so a bogus-URL provider can trip the circuit breaker.
  const { LlmProviderFactory } = await import('../src/services/providers/llm/LlmProviderFactory');
  (globalThis as any).__TEST_LLM_FACTORY__ = iocContainer.resolve(LlmProviderFactory);
  // P3-02: app-world fallback resolver — its chain cache lives in the app's
  // singleton, so tests must resolve through the same instance the
  // ProviderService invalidates hooks into.
  const { FallbackResolver } = await import('../src/services/providers/FallbackResolver');
  (globalThis as any).__TEST_FALLBACK_RESOLVER__ = iocContainer.resolve(FallbackResolver);
  // P3-03: app-world breaker registry, fallback-event writer, and call logger
  // (the logger seam lets e2e flushNow() the app's buffered provider_call_logs
  // rows instead of waiting for the 5 s batch timer).
  const { CircuitBreakerRegistry } = await import('../src/services/monitoring/CircuitBreakerRegistry');
  const { FallbackEventService } = await import('../src/services/monitoring/FallbackEventService');
  const { CallLogger: AppCallLogger } = await import('../src/services/monitoring/CallLogger');
  const { FailoverLlmProvider: AppFailoverLlmProvider } = await import('../src/services/providers/llm/FailoverLlmProvider');
  (globalThis as any).__TEST_BREAKER_REGISTRY__ = iocContainer.resolve(CircuitBreakerRegistry);
  (globalThis as any).__TEST_FALLBACK_EVENTS__ = iocContainer.resolve(FallbackEventService);
  (globalThis as any).__TEST_CALL_LOGGER__ = iocContainer.resolve(AppCallLogger);
  // App-world wrapper CLASS: e2e must construct it from the app's module
  // graph so instanceof checks and CircuitOpenError identity match the
  // app-world provider instances it wraps.
  (globalThis as any).__TEST_FAILOVER_PROVIDER__ = AppFailoverLlmProvider;
  // P3-04: app-world TTS/ASR/storage failover wrapper CLASSES (same dual-module
  // graph reason). Their breaker gate checks `instanceof CircuitOpenError` from
  // the app graph, so the registry passed in must be the app-world one above.
  const { FailoverTtsProvider: AppFailoverTtsProvider } = await import('../src/services/providers/tts/FailoverTtsProvider');
  const { FailoverAsrProvider: AppFailoverAsrProvider } = await import('../src/services/providers/asr/FailoverAsrProvider');
  const { FailoverStorageProvider: AppFailoverStorageProvider } = await import('../src/services/providers/storage/FailoverStorageProvider');
  (globalThis as any).__TEST_FAILOVER_TTS__ = AppFailoverTtsProvider;
  (globalThis as any).__TEST_FAILOVER_ASR__ = AppFailoverAsrProvider;
  (globalThis as any).__TEST_FAILOVER_STORAGE__ = AppFailoverStorageProvider;

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
  migrationPool?.end().catch(() => { });
  container?.stop().catch(() => { });
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
