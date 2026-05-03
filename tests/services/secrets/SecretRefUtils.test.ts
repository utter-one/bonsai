import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SecretsManagerRegistry } from '../../../src/services/secrets/SecretsManagerRegistry';

const mockIsSecretReference = vi.fn((value: unknown): value is string => {
  return typeof value === 'string' && /^@sec:[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/.test(value);
});
const mockStoreSecret = vi.fn(async (_managerName: string, value: string) => `@sec:local:${value.length}abc`);
const mockResolveSecret = vi.fn(async (ref: string) => {
  const parts = ref.split(':');
  return `resolved-${parts[2]}`;
});

const mockRegistry: SecretsManagerRegistry = {
  defaultManagerName: 'local',
  isSecretReference: mockIsSecretReference,
  storeSecret: mockStoreSecret,
  resolveSecret: mockResolveSecret,
  deleteSecret: vi.fn(),
  listAllRefs: vi.fn(),
  register: vi.fn(),
};

vi.mock('../../../src/services/secrets/SecretsManagerRegistry', () => ({
  SecretsManagerRegistry: vi.fn().mockImplementation(() => mockRegistry),
}));

import { SecretRefUtils, SENSITIVE_PROVIDER_CONFIG_FIELDS } from '../../../src/services/secrets/SecretRefUtils';

describe('SecretRefUtils', () => {
  let utils: SecretRefUtils;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreSecret.mockImplementation(async (_name: string, value: string) => `@sec:local:${value.length}abc`);
    mockResolveSecret.mockImplementation(async (ref: string) => {
      const parts = ref.split(':');
      return `resolved-${parts[2]}`;
    });
    utils = new SecretRefUtils(mockRegistry as any);
  });

  describe('SENSITIVE_PROVIDER_CONFIG_FIELDS', () => {
    it('contains all expected sensitive field names', () => {
      expect(SENSITIVE_PROVIDER_CONFIG_FIELDS.has('apiKey')).toBe(true);
      expect(SENSITIVE_PROVIDER_CONFIG_FIELDS.has('subscriptionKey')).toBe(true);
      expect(SENSITIVE_PROVIDER_CONFIG_FIELDS.has('accountKey')).toBe(true);
      expect(SENSITIVE_PROVIDER_CONFIG_FIELDS.has('secretAccessKey')).toBe(true);
      expect(SENSITIVE_PROVIDER_CONFIG_FIELDS.has('authToken')).toBe(true);
      expect(SENSITIVE_PROVIDER_CONFIG_FIELDS.has('accessToken')).toBe(true);
      expect(SENSITIVE_PROVIDER_CONFIG_FIELDS.has('appSecret')).toBe(true);
      expect(SENSITIVE_PROVIDER_CONFIG_FIELDS.has('verifyToken')).toBe(true);
      expect(SENSITIVE_PROVIDER_CONFIG_FIELDS.has('keyFileJson')).toBe(true);
      expect(SENSITIVE_PROVIDER_CONFIG_FIELDS.has('accountSid')).toBe(true);
    });

    it('does not contain non-sensitive field names', () => {
      expect(SENSITIVE_PROVIDER_CONFIG_FIELDS.has('baseUrl')).toBe(false);
      expect(SENSITIVE_PROVIDER_CONFIG_FIELDS.has('model')).toBe(false);
      expect(SENSITIVE_PROVIDER_CONFIG_FIELDS.has('name')).toBe(false);
      expect(SENSITIVE_PROVIDER_CONFIG_FIELDS.has('timeout')).toBe(false);
    });
  });

  describe('secretizeObject', () => {
    it('replaces sensitive string values with references', async () => {
      const obj = { apiKey: 'sk-test123', baseUrl: 'https://api.example.com' };
      const result = await utils.secretizeObject(obj, new Set(['apiKey']));
      expect(result.apiKey).toMatch(/^@sec:local:/);
      expect(result.baseUrl).toBe('https://api.example.com');
    });

    it('does not modify non-sensitive fields', async () => {
      const obj = { apiKey: 'sk-123', model: 'gpt-4', timeout: 30 };
      const result = await utils.secretizeObject(obj, new Set(['apiKey']));
      expect(result.model).toBe('gpt-4');
      expect(result.timeout).toBe(30);
    });

    it('skips already-referenced values (idempotent)', async () => {
      const obj = { apiKey: '@sec:local:existing123', baseUrl: 'https://api.example.com' };
      const result = await utils.secretizeObject(obj, new Set(['apiKey']));
      expect(result.apiKey).toBe('@sec:local:existing123');
      expect(mockStoreSecret).not.toHaveBeenCalled();
    });

    it('skips empty string values', async () => {
      const obj = { apiKey: '', baseUrl: 'https://api.example.com' };
      const result = await utils.secretizeObject(obj, new Set(['apiKey']));
      expect(result.apiKey).toBe('');
      expect(mockStoreSecret).not.toHaveBeenCalled();
    });

    it('skips missing keys', async () => {
      const obj = { baseUrl: 'https://api.example.com' };
      const result = await utils.secretizeObject(obj, new Set(['apiKey']));
      expect(result).toEqual({ baseUrl: 'https://api.example.com' });
      expect(mockStoreSecret).not.toHaveBeenCalled();
    });

    it('skips non-string values', async () => {
      const obj = { apiKey: 12345, baseUrl: 'https://api.example.com' };
      const result = await utils.secretizeObject(obj as any, new Set(['apiKey']));
      expect(result.apiKey).toBe(12345);
      expect(mockStoreSecret).not.toHaveBeenCalled();
    });

    it('does not mutate the original object', async () => {
      const obj = { apiKey: 'sk-original', baseUrl: 'https://api.example.com' };
      const originalApiKey = obj.apiKey;
      await utils.secretizeObject(obj, new Set(['apiKey']));
      expect((obj as any).apiKey).toBe(originalApiKey);
    });

    it('secretizes multiple sensitive fields', async () => {
      const obj = { apiKey: 'sk-123', authToken: 'auth-456', baseUrl: 'https://api.example.com' };
      const result = await utils.secretizeObject(obj, new Set(['apiKey', 'authToken']));
      expect(result.apiKey).toMatch(/^@sec:local:/);
      expect(result.authToken).toMatch(/^@sec:local:/);
      expect(result.baseUrl).toBe('https://api.example.com');
    });

    it('uses defaultManagerName when storing secrets', async () => {
      const obj = { apiKey: 'sk-123' };
      await utils.secretizeObject(obj, new Set(['apiKey']));
      expect(mockStoreSecret).toHaveBeenCalledWith('local', 'sk-123');
    });

    it('handles object with no matching sensitive fields', async () => {
      const obj = { baseUrl: 'https://api.example.com', model: 'gpt-4' };
      const result = await utils.secretizeObject(obj, new Set(['apiKey']));
      expect(result).toEqual({ baseUrl: 'https://api.example.com', model: 'gpt-4' });
    });
  });

  describe('resolveObject', () => {
    it('resolves secret references to plaintext', async () => {
      const obj = { apiKey: '@sec:local:123abc', baseUrl: 'https://api.example.com' };
      const result = await utils.resolveObject(obj);
      expect(result.apiKey).toBe('resolved-123abc');
      expect(result.baseUrl).toBe('https://api.example.com');
    });

    it('traverses nested objects recursively', async () => {
      const obj = {
        outer: { apiKey: '@sec:local:nested1' },
        baseUrl: 'https://api.example.com',
      };
      const result = await utils.resolveObject(obj);
      expect(result.outer.apiKey).toBe('resolved-nested1');
      expect(result.baseUrl).toBe('https://api.example.com');
    });

    it('traverses deeply nested objects', async () => {
      const obj = {
        level1: {
          level2: {
            level3: { apiKey: '@sec:local:deep1' },
          },
        },
      };
      const result = await utils.resolveObject(obj);
      expect(result.level1.level2.level3.apiKey).toBe('resolved-deep1');
    });

    it('does not recurse into arrays', async () => {
      const obj = {
        items: ['@sec:local:arr1', '@sec:local:arr2'],
      };
      const result = await utils.resolveObject(obj);
      expect(result.items).toEqual(['@sec:local:arr1', '@sec:local:arr2']);
    });

    it('passes through null values', async () => {
      const obj = { apiKey: null, baseUrl: 'https://api.example.com' };
      const result = await utils.resolveObject(obj);
      expect(result.apiKey).toBeNull();
    });

    it('passes through non-object primitives', async () => {
      const obj = { count: 42, active: true, label: 'test' };
      const result = await utils.resolveObject(obj);
      expect(result.count).toBe(42);
      expect(result.active).toBe(true);
      expect(result.label).toBe('test');
    });

    it('does not mutate the original object', async () => {
      const obj = { apiKey: '@sec:local:orig1' };
      await utils.resolveObject(obj);
      expect((obj as any).apiKey).toBe('@sec:local:orig1');
    });

    it('handles empty object', async () => {
      const result = await utils.resolveObject({});
      expect(result).toEqual({});
    });

    it('resolves multiple references in the same object', async () => {
      const obj = { apiKey: '@sec:local:key1', authToken: '@sec:local:auth2' };
      const result = await utils.resolveObject(obj);
      expect(result.apiKey).toBe('resolved-key1');
      expect(result.authToken).toBe('resolved-auth2');
    });

    it('handles mixed reference and plain values at nested level', async () => {
      const obj = {
        config: { apiKey: '@sec:local:mix1', model: 'gpt-4' },
        metadata: { name: 'test' },
      };
      const result = await utils.resolveObject(obj);
      expect(result.config.apiKey).toBe('resolved-mix1');
      expect(result.config.model).toBe('gpt-4');
      expect(result.metadata.name).toBe('test');
    });
  });

  describe('collectReferences', () => {
    it('returns empty array for object with no references', () => {
      const refs = utils.collectReferences({ apiKey: 'plain-value', baseUrl: 'https://api.example.com' });
      expect(refs).toEqual([]);
    });

    it('collects references from top-level fields', () => {
      const refs = utils.collectReferences({ apiKey: '@sec:local:ref1', baseUrl: 'https://api.example.com' });
      expect(refs).toEqual(['@sec:local:ref1']);
    });

    it('collects references from nested objects', () => {
      const refs = utils.collectReferences({
        outer: { apiKey: '@sec:local:nested1' },
        baseUrl: 'https://api.example.com',
      });
      expect(refs).toEqual(['@sec:local:nested1']);
    });

    it('collects references from arrays', () => {
      const refs = utils.collectReferences({
        items: [{ apiKey: '@sec:local:arr1' }, { authToken: '@sec:local:arr2' }],
      });
      expect(refs).toContain('@sec:local:arr1');
      expect(refs).toContain('@sec:local:arr2');
    });

    it('deduplicates references', () => {
      const refs = utils.collectReferences({
        a: '@sec:local:dup1',
        b: '@sec:local:dup1',
        c: { d: '@sec:local:dup1' },
      });
      expect(refs).toEqual(['@sec:local:dup1']);
    });

    it('collects from deeply nested structures', () => {
      const refs = utils.collectReferences({
        level1: {
          level2: {
            items: [
              { apiKey: '@sec:local:deep1' },
              { authToken: '@sec:local:deep2' },
            ],
          },
        },
      });
      expect(refs).toContain('@sec:local:deep1');
      expect(refs).toContain('@sec:local:deep2');
    });

    it('handles null and undefined values gracefully', () => {
      const refs = utils.collectReferences({ a: null, b: undefined, c: '@sec:local:nullsafe' });
      expect(refs).toEqual(['@sec:local:nullsafe']);
    });

    it('handles empty object', () => {
      const refs = utils.collectReferences({});
      expect(refs).toEqual([]);
    });
  });

  describe('round-trip secretize then resolve', () => {
    it('preserves sensitive values through secretize→resolve cycle', async () => {
      mockStoreSecret.mockImplementation(async (_name: string, value: string) => `@sec:local:${value.length}abc`);
      mockResolveSecret.mockImplementation(async (ref: string) => {
        const parts = ref.split(':');
        return `secret-${parts[2]}`;
      });

      const original = { apiKey: 'sk-123', baseUrl: 'https://api.example.com' };
      const secretized = await utils.secretizeObject(original, new Set(['apiKey']));
      expect(typeof secretized.apiKey).toBe('string');
      expect((secretized.apiKey as string).length).not.toBe('sk-123'.length);
    });

    it('non-sensitive fields survive the round-trip unchanged', async () => {
      const original = { apiKey: 'sk-123', model: 'gpt-4', timeout: 30 };
      const secretized = await utils.secretizeObject(original, new Set(['apiKey']));
      const resolved = await utils.resolveObject(secretized);
      expect(resolved.model).toBe('gpt-4');
      expect(resolved.timeout).toBe(30);
    });
  });
});
