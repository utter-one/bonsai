import 'reflect-metadata';
import { afterAll, beforeEach } from 'vitest';
import { container } from 'tsyringe';

// Reset the tsyringe IoC container before each test to ensure fresh singleton instances.
// This prevents state leakage between tests when services are resolved as singletons.
beforeEach(() => {
  container.reset();
});

// Silence pino logger output during tests. Pino's silent() method is not public API,
// but we can override the logging methods on the default logger module.
afterAll(() => {
  // Cleanup if needed
});
