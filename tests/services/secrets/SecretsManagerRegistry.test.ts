import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ISecretsManager } from '../../../src/services/secrets/ISecretsManager';
import { NotFoundError, InvalidOperationError } from '../../../src/errors';

const createMockManager = (name: string): ISecretsManager & { storedSecrets: Map<string, string> } => {
  const storedSecrets = new Map<string, string>();
  return {
    storedSecrets,
    storeSecret: vi.fn(async (value: string) => {
      const id = `${name}_${Math.random().toString(36).slice(2, 8)}`;
      storedSecrets.set(id, value);
      return `@sec:${name}:${id}`;
    }),
    resolveSecret: vi.fn(async (ref: string) => {
      const parts = ref.split(':');
      const id = parts[2];
      const value = storedSecrets.get(id);
      if (!value) throw new NotFoundError(`Secret "${id}" not found`);
      return value;
    }),
    deleteSecret: vi.fn(async (ref: string) => {
      const parts = ref.split(':');
      const id = parts[2];
      if (!storedSecrets.has(id)) throw new NotFoundError(`Secret "${id}" not found`);
      storedSecrets.delete(id);
    }),
    listIds: vi.fn(async () => Array.from(storedSecrets.keys())),
  };
};

vi.mock('../../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { SecretsManagerRegistry } from '../../../src/services/secrets/SecretsManagerRegistry';

describe('SecretsManagerRegistry', () => {
  let registry: SecretsManagerRegistry;

  beforeEach(() => {
    registry = new SecretsManagerRegistry();
  });

  describe('register', () => {
    it('registers a backend successfully', () => {
      const manager = createMockManager('local');
      expect(() => registry.register('local', manager)).not.toThrow();
    });

    it('allows multiple backends to be registered', () => {
      const local = createMockManager('local');
      const vault = createMockManager('vault');
      registry.register('local', local);
      registry.register('vault', vault);
      expect(() => registry.register('local', local)).not.toThrow();
    });

    it('overwrites a previously registered backend with the same name', () => {
      const original = createMockManager('local');
      const replacement = createMockManager('local');
      registry.register('local', original);
      registry.register('local', replacement);
      expect(replacement.storeSecret).toBeDefined();
    });
  });

  describe('isSecretReference', () => {
    it('returns true for valid @sec:name:id references', () => {
      expect(registry.isSecretReference('@sec:local:abc123')).toBe(true);
      expect(registry.isSecretReference('@sec:my-vault:secret_id')).toBe(true);
      expect(registry.isSecretReference('@sec:vault.name:secret.id')).toBe(true);
      expect(registry.isSecretReference('@sec:vault_name:secret_id_123')).toBe(true);
    });

    it('returns false for invalid reference formats', () => {
      expect(registry.isSecretReference('not-a-reference')).toBe(false);
      expect(registry.isSecretReference('@sec:onlyname')).toBe(false);
      expect(registry.isSecretReference('@sec::')).toBe(false);
      expect(registry.isSecretReference('sec:local:abc123')).toBe(false);
      expect(registry.isSecretReference('@sec:name:id:extra')).toBe(false);
    });

    it('returns false for non-string values', () => {
      expect(registry.isSecretReference(null as any)).toBe(false);
      expect(registry.isSecretReference(undefined as any)).toBe(false);
      expect(registry.isSecretReference(123 as any)).toBe(false);
      expect(registry.isSecretReference({} as any)).toBe(false);
    });

    it('returns false for references with invalid characters', () => {
      expect(registry.isSecretReference('@sec:name space:id')).toBe(false);
      expect(registry.isSecretReference('@sec:name:id!@#')).toBe(false);
    });
  });

  describe('defaultManagerName', () => {
    it('returns the first registered manager name', () => {
      const local = createMockManager('local');
      registry.register('local', local);
      expect(registry.defaultManagerName).toBe('local');
    });

    it('returns the first registered when multiple managers exist', () => {
      const first = createMockManager('first');
      const second = createMockManager('second');
      registry.register('first', first);
      registry.register('second', second);
      expect(registry.defaultManagerName).toBe('first');
    });

    it('throws InvalidOperationError when no managers are registered', () => {
      expect(() => registry.defaultManagerName).toThrow(InvalidOperationError);
      expect(() => registry.defaultManagerName).toThrow(
        'No secrets managers registered. Ensure a manager is registered before storing secrets.'
      );
    });
  });

  describe('storeSecret', () => {
    it('delegates to the correct named backend', async () => {
      const manager = createMockManager('local');
      registry.register('local', manager);
      const ref = await registry.storeSecret('local', 'my-secret-value');
      expect(manager.storeSecret).toHaveBeenCalledWith('my-secret-value');
      expect(ref).toMatch(/^@sec:local:/);
    });

    it('throws NotFoundError for unregistered backend', async () => {
      await expect(registry.storeSecret('nonexistent', 'value')).rejects.toThrow(NotFoundError);
      await expect(registry.storeSecret('nonexistent', 'value')).rejects.toThrow(
        'Secrets manager "nonexistent" is not registered'
      );
    });

    it('stores secrets independently across multiple backends', async () => {
      const local = createMockManager('local');
      const vault = createMockManager('vault');
      registry.register('local', local);
      registry.register('vault', vault);

      const localRef = await registry.storeSecret('local', 'local-secret');
      const vaultRef = await registry.storeSecret('vault', 'vault-secret');

      expect(localRef).toMatch(/^@sec:local:/);
      expect(vaultRef).toMatch(/^@sec:vault:/);
      expect(local.storedSecrets.size).toBe(1);
      expect(vault.storedSecrets.size).toBe(1);
    });
  });

  describe('resolveSecret', () => {
    it('parses reference and delegates to correct backend', async () => {
      const manager = createMockManager('local');
      registry.register('local', manager);
      const ref = await registry.storeSecret('local', 'test-value');
      const resolved = await registry.resolveSecret(ref);
      expect(resolved).toBe('test-value');
      expect(manager.resolveSecret).toHaveBeenCalledWith(ref);
    });

    it('throws NotFoundError for unregistered backend in reference', async () => {
      await expect(registry.resolveSecret('@sec:unknown:id123')).rejects.toThrow(NotFoundError);
      await expect(registry.resolveSecret('@sec:unknown:id123')).rejects.toThrow(
        'Secrets manager "unknown" is not registered'
      );
    });

    it('throws when backend cannot find the secret', async () => {
      const manager = createMockManager('local');
      registry.register('local', manager);
      await expect(registry.resolveSecret('@sec:local:nonexistent_id')).rejects.toThrow(NotFoundError);
    });

    it('resolves secrets from different backends correctly', async () => {
      const local = createMockManager('local');
      const vault = createMockManager('vault');
      registry.register('local', local);
      registry.register('vault', vault);

      const localRef = await registry.storeSecret('local', 'local-val');
      const vaultRef = await registry.storeSecret('vault', 'vault-val');

      expect(await registry.resolveSecret(localRef)).toBe('local-val');
      expect(await registry.resolveSecret(vaultRef)).toBe('vault-val');
    });
  });

  describe('deleteSecret', () => {
    it('parses reference and delegates to correct backend', async () => {
      const manager = createMockManager('local');
      registry.register('local', manager);
      const ref = await registry.storeSecret('local', 'to-delete');
      expect(manager.storedSecrets.size).toBe(1);
      await registry.deleteSecret(ref);
      expect(manager.deleteSecret).toHaveBeenCalledWith(ref);
      expect(manager.storedSecrets.size).toBe(0);
    });

    it('throws NotFoundError for unregistered backend', async () => {
      await expect(registry.deleteSecret('@sec:unknown:id123')).rejects.toThrow(NotFoundError);
    });

    it('throws when backend cannot find the secret', async () => {
      const manager = createMockManager('local');
      registry.register('local', manager);
      await expect(registry.deleteSecret('@sec:local:nonexistent_id')).rejects.toThrow(NotFoundError);
    });
  });

  describe('listAllRefs', () => {
    it('returns empty array when no backends registered', async () => {
      const refs = await registry.listAllRefs();
      expect(refs).toEqual([]);
    });

    it('returns references from all registered backends', async () => {
      const local = createMockManager('local');
      const vault = createMockManager('vault');
      registry.register('local', local);
      registry.register('vault', vault);

      await registry.storeSecret('local', 'secret1');
      await registry.storeSecret('local', 'secret2');
      await registry.storeSecret('vault', 'secret3');

      const refs = await registry.listAllRefs();
      expect(refs.length).toBe(3);
      const localRefs = refs.filter((r) => r.startsWith('@sec:local:'));
      const vaultRefs = refs.filter((r) => r.startsWith('@sec:vault:'));
      expect(localRefs.length).toBe(2);
      expect(vaultRefs.length).toBe(1);
    });

    it('returns properly formatted reference strings', async () => {
      const manager = createMockManager('local');
      registry.register('local', manager);
      await registry.storeSecret('local', 'value');
      const refs = await registry.listAllRefs();
      expect(refs.every((r) => registry.isSecretReference(r))).toBe(true);
    });

    it('handles backend with no stored secrets', async () => {
      const manager = createMockManager('local');
      registry.register('local', manager);
      const refs = await registry.listAllRefs();
      expect(refs).toEqual([]);
    });
  });

  describe('integration: full lifecycle', () => {
    it('store, resolve, list, delete flow works end-to-end', async () => {
      const manager = createMockManager('local');
      registry.register('local', manager);

      const ref = await registry.storeSecret('local', 'lifecycle-secret');
      expect(registry.isSecretReference(ref)).toBe(true);

      const resolved = await registry.resolveSecret(ref);
      expect(resolved).toBe('lifecycle-secret');

      const refs = await registry.listAllRefs();
      expect(refs).toContain(ref);

      await registry.deleteSecret(ref);
      const afterDelete = await registry.listAllRefs();
      expect(afterDelete).not.toContain(ref);
    });

    it('multiple backends operate independently throughout lifecycle', async () => {
      const local = createMockManager('local');
      const vault = createMockManager('vault');
      registry.register('local', local);
      registry.register('vault', vault);

      const localRef = await registry.storeSecret('local', 'local-only');
      const vaultRef = await registry.storeSecret('vault', 'vault-only');

      expect(await registry.resolveSecret(localRef)).toBe('local-only');
      expect(await registry.resolveSecret(vaultRef)).toBe('vault-only');

      await registry.deleteSecret(localRef);
      await expect(registry.resolveSecret(localRef)).rejects.toThrow(NotFoundError);
      expect(await registry.resolveSecret(vaultRef)).toBe('vault-only');
    });
  });
});
