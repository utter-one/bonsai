import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestContext } from '../../src/services/RequestContext';
import { ForbiddenError, NotFoundError, OptimisticLockError } from '../../src/errors';

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/db/index', () => {
  const findFirst = vi.fn().mockResolvedValue({});
  const findMany = vi.fn().mockResolvedValue([]);
  let lastInsertedValues: Record<string, any> = {};
  const updateReturning = vi.fn().mockResolvedValue([]);

  const apiKeysTable = {
    findFirst,
    findMany,
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation((v: Record<string, any>) => {
        lastInsertedValues = v;
        return {
          returning: vi.fn().mockResolvedValue([{
            ...v,
            key: 'akey_live_mockkey123',
            createdAt: new Date(),
            updatedAt: new Date(),
          }]),
        };
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: updateReturning,
        }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  };

  const projectsTable = {
    findFirst: vi.fn().mockResolvedValue({}),
  };

  const selectMock = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
      orderBy: vi.fn().mockResolvedValue([]),
    }),
  });

  return {
    db: {
      query: { apiKeys: apiKeysTable, projects: projectsTable },
      insert: apiKeysTable.insert,
      select: selectMock,
      update: apiKeysTable.update,
      delete: apiKeysTable.delete,
    },
    __mocks: { findFirst, findMany, updateReturning, lastInsertedValues },
  };
});

vi.mock('../../src/utils/idGenerator', () => ({
  generateId: vi.fn().mockReturnValue('akey_test123'),
  ID_PREFIXES: { API_KEY: 'akey' },
}));

vi.mock('../../src/utils/textSearch', () => ({
  parseTextSearch: vi.fn((v: string) => ({ type: 'text', value: v })),
}));

vi.mock('../../src/utils/queryBuilder', () => ({
  buildFilterCondition: vi.fn(() => null),
  buildOrderBy: vi.fn(() => []),
}));

vi.mock('../../src/utils/pagination', () => ({
  DEFAULT_LIST_LIMIT: 100,
  MAX_LIST_LIMIT: 1000,
  countRows: vi.fn().mockResolvedValue(0),
  normalizeListLimit: vi.fn((v: number | undefined) => v ?? 100),
}));

import { ApiKeyService } from '../../src/services/ApiKeyService';
import { __mocks as dbMock } from '../../src/db/index';

const defaultContext: RequestContext = {
  operatorId: 'op_test123',
  roles: ['super_admin'],
  ip: '127.0.0.1',
  userAgent: 'TestAgent/1.0',
  requestId: 'req-123',
  timestamp: new Date('2025-01-01T00:00:00Z'),
};

const deniedContext: RequestContext = {
  ...defaultContext,
  roles: ['viewer'],
};

function createApiKeyRow(overrides?: Record<string, any>) {
  return {
    id: 'akey_test123',
    projectId: '__test_project__',
    name: 'Test Key',
    key: 'akey_live_mockkey123',
    isActive: true,
    metadata: {},
    keySettings: null,
    version: 1,
    lastUsedAt: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('ApiKeyService', () => {
  let service: ApiKeyService;

  beforeEach(() => {
    vi.clearAllMocks();
    const mockAudit = {
      logCreate: vi.fn().mockResolvedValue(undefined),
      logUpdate: vi.fn().mockResolvedValue(undefined),
      logDelete: vi.fn().mockResolvedValue(undefined),
      getEntityAuditLogs: vi.fn().mockResolvedValue([]),
    };
    service = new ApiKeyService(mockAudit as any);
    dbMock.findFirst.mockResolvedValue(createApiKeyRow());
    dbMock.updateReturning.mockResolvedValue([createApiKeyRow()]);
  });

  describe('createApiKey', () => {
    it('creates the API key and returns it with full key', async () => {
      const result = await service.createApiKey('__test_project__', { name: 'Test Key' }, defaultContext);
      expect(result).toBeDefined();
      expect(result.id).toBe('akey_test123');
      expect(result.name).toBe('Test Key');
      expect(result.key).toBeDefined();
      expect(result.keyPreview).toMatch(/^akey_live_[^ ]+\.\.\.$/);
    });

    it('throws ForbiddenError when user lacks write permission', async () => {
      await expect(
        service.createApiKey('__test_project__', { name: 'Test Key' }, deniedContext)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getApiKeyById', () => {
    it('returns the API key when found', async () => {
      const result = await service.getApiKeyById('__test_project__', 'akey_test123');
      expect(result).toBeDefined();
      expect(result.id).toBe('akey_test123');
      expect(result.keyPreview).toBe('akey_live_mo...');
    });

    it('throws NotFoundError when API key does not exist', async () => {
      dbMock.findFirst.mockResolvedValue(undefined);
      await expect(
        service.getApiKeyById('__test_project__', 'nonexistent')
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('getApiKeyByKey', () => {
    it('returns the API key when found and active', async () => {
      const result = await service.getApiKeyByKey('akey_live_mockkey123');
      expect(result).toBeDefined();
      expect(result.id).toBe('akey_test123');
    });

    it('throws NotFoundError for inactive key', async () => {
      dbMock.findFirst.mockResolvedValue(undefined);
      await expect(service.getApiKeyByKey('invalid_key')).rejects.toThrow(NotFoundError);
    });
  });

  describe('listApiKeys', () => {
    it('returns paginated results with total count', async () => {
      const result = await service.listApiKeys('__test_project__');
      expect(result).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
      expect(typeof result.total).toBe('number');
    });

    it('respects limit and offset parameters', async () => {
      await service.listApiKeys('__test_project__', { limit: 5, offset: 10 });
      expect(dbMock.findMany).toHaveBeenCalled();
    });
  });

  describe('updateApiKey', () => {
    it('updates the API key and returns new state', async () => {
      const result = await service.updateApiKey('__test_project__', 'akey_test123', { name: 'Updated Key', version: 1 }, defaultContext);
      expect(result).toBeDefined();
      expect(result.id).toBe('akey_test123');
    });

    it('throws ForbiddenError when user lacks write permission', async () => {
      await expect(
        service.updateApiKey('__test_project__', 'akey_test123', { name: 'Updated', version: 1 }, deniedContext)
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when API key does not exist', async () => {
      dbMock.findFirst.mockResolvedValue(undefined);
      await expect(
        service.updateApiKey('__test_project__', 'nonexistent', { name: 'Updated', version: 1 }, defaultContext)
      ).rejects.toThrow(NotFoundError);
    });

    it('throws OptimisticLockError on version mismatch', async () => {
      dbMock.findFirst.mockResolvedValue(createApiKeyRow({ version: 3 }));
      await expect(
        service.updateApiKey('__test_project__', 'akey_test123', { name: 'Updated', version: 1 }, defaultContext)
      ).rejects.toThrow(OptimisticLockError);
    });
  });

  describe('deleteApiKey', () => {
    it('deletes the API key successfully', async () => {
      await expect(
        service.deleteApiKey('__test_project__', 'akey_test123', 1, defaultContext)
      ).resolves.toBeUndefined();
    });

    it('throws ForbiddenError when user lacks delete permission', async () => {
      await expect(
        service.deleteApiKey('__test_project__', 'akey_test123', 1, deniedContext)
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when API key does not exist', async () => {
      dbMock.findFirst.mockResolvedValue(undefined);
      await expect(
        service.deleteApiKey('__test_project__', 'nonexistent', 1, defaultContext)
      ).rejects.toThrow(NotFoundError);
    });

    it('throws OptimisticLockError on version mismatch', async () => {
      dbMock.findFirst.mockResolvedValue(createApiKeyRow({ version: 5 }));
      await expect(
        service.deleteApiKey('__test_project__', 'akey_test123', 1, defaultContext)
      ).rejects.toThrow(OptimisticLockError);
    });
  });

  describe('getApiKeyAuditLogs', () => {
    it('returns audit logs for an API key', async () => {
      const result = await service.getApiKeyAuditLogs('akey_test123', '__test_project__');
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('getKeyPreview', () => {
    it('truncates key to first 12 chars with ellipsis', async () => {
      const result = await service.getApiKeyById('__test_project__', 'akey_test123');
      expect(result.keyPreview).toBe('akey_live_mo...');
      expect(result.keyPreview.length).toBe(15);
    });
  });
});
