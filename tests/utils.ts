import request from 'supertest';
import { sql } from 'drizzle-orm';
import { getDb, getPoolRef } from '../src/db/index';

// All truncatable tables in the schema (views excluded — they are derived).
// CASCADE handles FK dependencies so order doesn't strictly matter,
// but we list children before parents for clarity.
const TABLES = [
  // conversation subtree (children of conversations)
  'conversation_events',
  'conversation_artifacts',

  // project-scoped entities
  'conversations',
  'users',
  'stages',
  'classifiers',
  'context_transformers',
  'tools',
  'global_actions',
  'guardrails',
  'sample_copies',
  'copy_decorators',
  'knowledge_categories',
  'knowledge_items',
  'agents',
  'issues',
  'providers',
  'environments',
  'api_keys',
  'secrets',
  'testers',
  'scenarios',
  'scenario_runs',
  'scenario_conversations',
  'saved_slice_queries',
  'saved_funnel_queries',

  // benchmark subtree
  'benchmark_results',
  'benchmark_config_executions',
  'benchmark_runs',
  'benchmark_configs',
  'benchmark_provider_configs',
  'benchmark_suites',

  // quick prompts
  'quick_prompts',

  // project snapshots
  'project_snapshots',

  // audit
  'audit_logs',

  // top-level
  'projects',
  // NOTE: 'operators' is intentionally excluded — the test operator must persist
  // across resets so JWT tokens remain valid. Re-create it manually if needed.
];

/**
 * Truncate all tables to reset database state between tests.
 * Uses CASCADE so FK constraints are not violated.
 */
export async function resetDatabase(): Promise<void> {
  // SAFETY GATE: double-check we're not about to truncate a local database.
  // The testcontainer uses a random high port (e.g. localhost:33248), never :5432.
  const connStr = process.env.DB_CONNECTION_STRING || '';
  if (connStr.includes(':5432')) {
    throw new Error(
      `ABORT: resetDatabase() refused — DB_CONNECTION_STRING uses port 5432 (local DB): ${connStr}. ` +
      'This will wipe your data. The testcontainer likely failed to start.',
    );
  }
  const db = getDb();
  // Build TRUNCATE with raw identifiers — table names are hardcoded so safe from injection
  // Use raw SQL string since drizzle's sql.template doesn't support dynamic table lists cleanly
  const tableList = TABLES.map((t) => `"${t}"`).join(', ');
  await db.execute(sql`TRUNCATE TABLE ${sql.raw(tableList)} CASCADE`);
}

/**
 * Gracefully close the database pool (for manual teardown if needed).
 */
export async function closePool(): Promise<void> {
  const pool = getPoolRef();
  await pool.end();
}

/**
 * Return a supertest agent pre-authenticated with the test operator's JWT.
 */
export function authed() {
  const app = (globalThis as any).__TEST_APP__;
  const token = (globalThis as any).__TEST_ACCESS_TOKEN__;
  const agent = request.agent(app);
  agent.set('Authorization', `Bearer ${token}`);
  return agent;
}

/**
 * Return an unauthenticated supertest agent.
 */
export function unauthed() {
  const app = (globalThis as any).__TEST_APP__;
  return request(app);
}

/**
 * Get the current test access token.
 */
export function getAccessToken(): string {
  return (globalThis as any).__TEST_ACCESS_TOKEN__;
}

/**
 * Get the current test refresh token.
 */
export function getRefreshToken(): string {
  return (globalThis as any).__TEST_REFRESH_TOKEN__;
}
