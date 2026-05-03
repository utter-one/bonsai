import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EncryptedSecret } from '../../../src/utils/crypto';

vi.mock('../../../src/db/index', () => {
  const findFirst = vi.fn();
  const findMany = vi.fn().mockResolvedValue([]);
  const insertValues = vi.fn().mockResolvedValue([]);
  const deleteReturning = vi.fn().mockResolvedValue([]);
  return {
    db: {
      query: {
        secrets: {
          findFirst,
          findMany,
        },
      },
      insert: vi.fn().mockReturnValue({
        values: insertValues,
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: deleteReturning,
        }),
      }),
    },
    __mocks: { findFirst, findMany, insertValues, deleteReturning },
  };
});

vi.mock('../../../src/utils/crypto', () => {
  const encryptSecret = vi.fn();
  const decryptSecret = vi.fn();
  const parseMasterKey = vi.fn();
  return {
    encryptSecret,
    decryptSecret,
    parseMasterKey,
    __mocks: { encryptSecret, decryptSecret, parseMasterKey },
  };
});

vi.mock('../../../src/utils/idGenerator', () => {
  const generateId = vi.fn();
  return {
    generateId,
    __mocks: { generateId },
  };
});

vi.mock('../../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { LocalSecretsManager, LOCAL_SECRETS_MANAGER_NAME } from '../../../src/services/secrets/LocalSecretsManager';
import { NotFoundError, NotConfiguredError } from '../../../src/errors';
import { __mocks as dbMocks } from '../../../src/db/index';
import * as cryptoMod from '../../../src/utils/crypto';
import * as idGenMod from '../../../src/utils/idGenerator';

const mockEncryptSecret = (cryptoMod as any).__mocks.encryptSecret;
const mockDecryptSecret = (cryptoMod as any).__mocks.decryptSecret;
const mockParseMasterKey = (cryptoMod as any).__mocks.parseMasterKey;
const mockGenerateId = (idGenMod as any).__mocks.generateId;

const TEST_KEY_HEX = 'a'.repeat(64);
const MOCK_MASTER_KEY = Buffer.from(TEST_KEY_HEX, 'hex');

const createMockEncryptedSecret = (value: string): EncryptedSecret => ({
  encryptedValue: `enc:${value}`,
  iv: 'iv_base64',
  tag: 'tag_base64',
});

describe('LocalSecretsManager', () => {
  let manager: LocalSecretsManager;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MASTER_ENCRYPTION_KEY = TEST_KEY_HEX;
    mockParseMasterKey.mockReturnValue(MOCK_MASTER_KEY);
    mockGenerateId.mockReturnValue('sec_test001');
    mockEncryptSecret.mockImplementation((value: string) => createMockEncryptedSecret(value));
    mockDecryptSecret.mockImplementation(() => 'decrypted_secret_value');
    dbMocks.findFirst.mockResolvedValue({
      id: 'sec_test001',
      encryptedValue: 'enc:secret',
      iv: 'iv_base64',
      tag: 'tag_base64',
    });
    manager = new LocalSecretsManager();
  });

  afterEach(() => {
    delete process.env.MASTER_ENCRYPTION_KEY;
  });

  it('throws NotConfiguredError when MASTER_ENCRYPTION_KEY is not set', () => {
    delete process.env.MASTER_ENCRYPTION_KEY;
    expect(() => new LocalSecretsManager()).toThrow(NotConfiguredError);
  });

  it('parses master key from environment on construction', () => {
    expect(mockParseMasterKey).toHaveBeenCalledWith(TEST_KEY_HEX);
  });

  describe('storeSecret', () => {
    it('encrypts the secret value before storage', async () => {
      await manager.storeSecret('my_secret');
      expect(mockEncryptSecret).toHaveBeenCalledWith('my_secret', MOCK_MASTER_KEY);
    });

    it('generates a new ID for each secret', async () => {
      await manager.storeSecret('my_secret');
      expect(mockGenerateId).toHaveBeenCalledWith('sec');
    });

    it('inserts encrypted data into the database', async () => {
      await manager.storeSecret('my_secret');
      expect(dbMocks.insertValues).toHaveBeenCalledWith({
        id: 'sec_test001',
        encryptedValue: 'enc:my_secret',
        iv: 'iv_base64',
        tag: 'tag_base64',
      });
    });

    it('returns a reference string in the correct format', async () => {
      const ref = await manager.storeSecret('my_secret');
      expect(ref).toBe('@sec:local:sec_test001');
    });

    it('uses the correct manager name in reference', async () => {
      const ref = await manager.storeSecret('test');
      expect(ref.startsWith(`@sec:${LOCAL_SECRETS_MANAGER_NAME}:`)).toBe(true);
    });
  });

  describe('resolveSecret', () => {
    it('extracts the secret ID from the reference string', async () => {
      await manager.resolveSecret('@sec:local:sec_test001');
      expect(dbMocks.findFirst).toHaveBeenCalled();
    });

    it('decrypts and returns the plaintext value', async () => {
      const result = await manager.resolveSecret('@sec:local:sec_test001');
      expect(mockDecryptSecret).toHaveBeenCalledWith('enc:secret', 'iv_base64', 'tag_base64', MOCK_MASTER_KEY);
      expect(result).toBe('decrypted_secret_value');
    });

    it('throws NotFoundError when secret does not exist', async () => {
      dbMocks.findFirst.mockResolvedValue(null);
      await expect(manager.resolveSecret('@sec:local:sec_missing')).rejects.toThrow(NotFoundError);
    });

    it('throws NotFoundError with the reference in the message', async () => {
      dbMocks.findFirst.mockResolvedValue(null);
      await expect(manager.resolveSecret('@sec:local:sec_missing')).rejects.toThrow('Secret @sec:local:sec_missing not found');
    });
  });

  describe('deleteSecret', () => {
    it('deletes the secret from the database', async () => {
      dbMocks.deleteReturning.mockResolvedValue([{ id: 'sec_test001' }]);
      await manager.deleteSecret('@sec:local:sec_test001');
      expect(dbMocks.deleteReturning).toHaveBeenCalled();
    });

    it('throws NotFoundError when secret does not exist', async () => {
      dbMocks.deleteReturning.mockResolvedValue([]);
      await expect(manager.deleteSecret('@sec:local:sec_missing')).rejects.toThrow(NotFoundError);
    });
  });

  describe('listIds', () => {
    it('returns all secret IDs from the database', async () => {
      dbMocks.findMany.mockResolvedValue([
        { id: 'sec_001' },
        { id: 'sec_002' },
        { id: 'sec_003' },
      ]);
      const ids = await manager.listIds();
      expect(ids).toEqual(['sec_001', 'sec_002', 'sec_003']);
    });

    it('returns empty array when no secrets exist', async () => {
      dbMocks.findMany.mockResolvedValue([]);
      const ids = await manager.listIds();
      expect(ids).toEqual([]);
    });
  });

  describe('encrypt/decrypt round-trip', () => {
    it('preserves value through store and resolve', async () => {
      const originalValue = 'super_secret_password_123';
      mockEncryptSecret.mockImplementation((value: string) => createMockEncryptedSecret(value));
      mockDecryptSecret.mockReturnValue(originalValue);

      const ref = await manager.storeSecret(originalValue);
      const resolved = await manager.resolveSecret(ref);

      expect(resolved).toBe(originalValue);
    });

    it('stores multiple secrets independently', async () => {
      mockGenerateId.mockReturnValueOnce('sec_001').mockReturnValueOnce('sec_002');
      mockEncryptSecret.mockImplementation((value: string) => createMockEncryptedSecret(value));

      const ref1 = await manager.storeSecret('secret_one');
      const ref2 = await manager.storeSecret('secret_two');

      expect(ref1).toBe('@sec:local:sec_001');
      expect(ref2).toBe('@sec:local:sec_002');
    });
  });

  describe('reference parsing', () => {
    it('extracts ID from correctly formatted reference', async () => {
      dbMocks.findFirst.mockResolvedValue({
        id: 'sec_custom123',
        encryptedValue: 'enc:value',
        iv: 'iv',
        tag: 'tag',
      });
      mockDecryptSecret.mockReturnValue('value');

      await manager.resolveSecret('@sec:local:sec_custom123');
      expect(dbMocks.findFirst).toHaveBeenCalled();
    });

    it('handles references with different secret IDs', async () => {
      dbMocks.findFirst.mockResolvedValue({
        id: 'sec_another456',
        encryptedValue: 'enc:value',
        iv: 'iv',
        tag: 'tag',
      });
      mockDecryptSecret.mockReturnValue('value');

      await manager.resolveSecret('@sec:local:sec_another456');
    });
  });

  describe('error handling', () => {
    it('rejects invalid master key format on construction', () => {
      process.env.MASTER_ENCRYPTION_KEY = 'short_key';
      mockParseMasterKey.mockImplementation(() => {
        throw new Error('MASTER_ENCRYPTION_KEY must encode exactly 32 bytes');
      });
      expect(() => new LocalSecretsManager()).toThrow();
    });

    it('handles DB errors during resolve', async () => {
      dbMocks.findFirst.mockRejectedValue(new Error('connection failed'));
      await expect(manager.resolveSecret('@sec:local:sec_test001')).rejects.toThrow('connection failed');
    });

    it('handles DB errors during delete', async () => {
      dbMocks.deleteReturning.mockRejectedValue(new Error('connection failed'));
      await expect(manager.deleteSecret('@sec:local:sec_test001')).rejects.toThrow('connection failed');
    });
  });
});
