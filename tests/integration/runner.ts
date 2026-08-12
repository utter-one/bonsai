#!/usr/bin/env tsx
/**
 * Integration test runner for conversation logic tests.
 * Uses testcontainers (PostgreSQL) + full app boot like e2e tests.
 */

import 'reflect-metadata';
import Mocha from 'mocha';
import { rootHooks } from '../setup';

// Set env before any imports
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.RATE_LIMIT_API_MAX = '10000';

async function main() {
  const mocha = new Mocha({
    timeout: 30000,
    slow: 1000,
    ui: 'bdd',
    color: true,
    reporter: 'spec',
  });

  // Register root hooks for global setup/teardown (spins up testcontainers + boots Express app)
  const hooks = rootHooks();
  mocha.suite.beforeAll(async () => {
    await hooks.beforeAll!();
  });
  mocha.suite.afterAll(async () => {
    await hooks.afterAll!();
  });

  // Load integration test files
  mocha.addFile('tests/integration/live/conversationRunner.test.ts');
  mocha.addFile('tests/integration/live/infrastructure.test.ts');

  // Run
  const runner = mocha.run((failures) => {
    console.log(`\nMOCHA CALLBACK: ${failures || 0} failures`);
    process.exitCode = failures ? 1 : 0;
    setTimeout(() => process.exit(process.exitCode || 0), 3000);
  });
}

main().catch(err => {
  console.error('Runner error:', err);
  process.exit(1);
});
