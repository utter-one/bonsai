import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { VersionService, setSpecProvider } from '../../src/services/VersionService';

describe('VersionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getVersion', () => {
    it('returns version info with all fields', () => {
      const service = new VersionService();
      const result = service.getVersion();
      expect(result).toBeDefined();
      expect(typeof result.version).toBe('string');
      expect(typeof result.restSchemaHash).toBe('string');
      expect(typeof result.wsSchemaHash).toBe('string');
    });

    it('returns package version from package.json', () => {
      const service = new VersionService();
      const result = service.getVersion();
      expect(result.version.startsWith('0.')).toBe(true);
    });

    it('caches the result on subsequent calls', () => {
      const service = new VersionService();
      const first = service.getVersion();
      const second = service.getVersion();
      expect(first).toBe(second);
    });
  });

  describe('version suffix', () => {
    it('includes environment and commit hash in non-production', () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('GIT_COMMIT', 'abc123def456');
      const service = new VersionService();
      const result = service.getVersion();
      expect(result.version).toContain('-development-abc123d');
    });

    it('includes "local" suffix when no commit hash in dev', () => {
      vi.stubEnv('NODE_ENV', 'dev');
      delete process.env.GIT_COMMIT;
      delete process.env.SOURCE_COMMIT;
      const service = new VersionService();
      const result = service.getVersion();
      expect(result.version).toContain('-dev-local');
    });

    it('has no suffix in production', () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('GIT_COMMIT', 'abc123def456');
      const service = new VersionService();
      const result = service.getVersion();
      expect(result.version).not.toContain('-');
    });

    it('uses SOURCE_COMMIT as fallback for GIT_COMMIT', () => {
      vi.stubEnv('NODE_ENV', 'development');
      delete process.env.GIT_COMMIT;
      vi.stubEnv('SOURCE_COMMIT', 'xyz789abc012');
      const service = new VersionService();
      const result = service.getVersion();
      expect(result.version).toContain('-development-xyz789a');
    });
  });

  describe('schema hashes', () => {
    it('computes REST schema hash from spec provider', () => {
      setSpecProvider(() => ({ openapi: '3.0.0', info: { title: 'Test' } }));
      const service = new VersionService();
      const result = service.getVersion();
      expect(result.restSchemaHash).toHaveLength(12);
    });

    it('computes empty-spec hash when spec provider not registered', () => {
      setSpecProvider(null as any);
      const service = new VersionService();
      const result = service.getVersion();
      expect(result.restSchemaHash).toHaveLength(12);
    });

    it('computes WS schema hash from file', () => {
      const service = new VersionService();
      const result = service.getVersion();
      expect(result.wsSchemaHash).not.toBe('unavailable');
      expect(result.wsSchemaHash).toHaveLength(12);
    });
  });

  describe('gitCommit field', () => {
    it('returns GIT_COMMIT value', () => {
      vi.stubEnv('GIT_COMMIT', 'abcdef123456');
      const service = new VersionService();
      const result = service.getVersion();
      expect(result.gitCommit).toBe('abcdef123456');
    });

    it('falls back to SOURCE_COMMIT', () => {
      delete process.env.GIT_COMMIT;
      vi.stubEnv('SOURCE_COMMIT', 'xyz789');
      const service = new VersionService();
      const result = service.getVersion();
      expect(result.gitCommit).toBe('xyz789');
    });

    it('returns undefined when neither env var is set', () => {
      delete process.env.GIT_COMMIT;
      delete process.env.SOURCE_COMMIT;
      const service = new VersionService();
      const result = service.getVersion();
      expect(result.gitCommit).toBeUndefined();
    });
  });
});
