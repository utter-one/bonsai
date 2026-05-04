import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    chaiConfig: {
      truncateThreshold: 0,
    },
    globals: true,
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    exclude: [
      'node_modules',
      'dist',
      'drizzle',
      'schemas',
    ],
    environment: 'node',
    pool: 'forks',
    maxWorkers: 4,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/db/index.ts',
        'src/db/migrate.ts',
        'src/index.ts',
        'src/server.ts',
        'src/scripts/**/*',
      ],
      reporter: [
        ['text', { maxCols: 150 }], // Adjust maxCols to prevent truncation of coverage report in the terminal
      ],
      thresholds: {
        lines: 10,
        functions: 10,
        branches: 10,
        statements: 10,
      },
    },
  },
});
