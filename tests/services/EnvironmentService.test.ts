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
  const mocks = { lastInsertedValues: {} as Record<string, any> };
  const updateReturning = vi.fn().mockResolvedValue([]);
  const deleteReturning = vi.fn().mockResolvedValue([]);

  const environmentsTable = {
    findFirst,
    findMany,
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation((v: Record<string, any>) => {
        Object.assign(mocks.lastInsertedValues, v);
        return {
          returning: vi.fn().mockResolvedValue([{
            ...v,
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
      where: vi.fn().mockReturnValue({
        returning: deleteReturning,
      }),
    }),
  };

  return {
    db: {
      query: { environments: environmentsTable },
      insert: environmentsTable.insert,
      update: environmentsTable.update,
      delete: environmentsTable.delete,
    },
    __mocks: { findFirst, findMany, updateReturning, deleteReturning, ...mocks },
  };
});

vi.mock('../../src/utils/idGenerator', () => ({
  generateId: vi.fn().mockReturnValue('env_test123'),
  ID_PREFIXES: { ENVIRONMENT: 'env' },
}));

vi.mock('../../src/utils/textSearch', () => ({
  parseTextSearch: vi.fn((v: string) => ({ type: 'text', value: v })),
  buildTextSearchCondition: vi.fn(() => null),
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

vi.mock('../../src/services/secrets/SecretsManagerRegistry', () => ({
  SecretsManagerRegistry: vi.fn().mockImplementation(() => ({
    isSecretReference: vi.fn().mockReturnValue(false),
    storeSecret: vi.fn().mockResolvedValue('secret://ref'),
    defaultManagerName: 'default-manager',
  })),
}));

import { EnvironmentService } from '../../src/services/EnvironmentService';
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

function createEnvRow(overrides?: Record<string, any>) {
  return {
    id: 'env_test123',
    description: 'Test Environment',
    url: 'https://example.com',
    login: 'admin',
    password: 'secret://ref',
    version: 1,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('EnvironmentService', () => {
  let service: EnvironmentService;

  beforeEach(() => {
    vi.clearAllMocks();
    const mockAudit = {
      logCreate: vi.fn().mockResolvedValue(undefined),
      logUpdate: vi.fn().mockResolvedValue(undefined),
      logDelete: vi.fn().mockResolvedValue(undefined),
      getEntityAuditLogs: vi.fn().mockResolvedValue([]),
    };
    const mockSecrets = {
      isSecretReference: vi.fn().mockReturnValue(false),
      storeSecret: vi.fn().mockResolvedValue('secret://ref'),
      defaultManagerName: 'default-manager',
    };
    service = new EnvironmentService(mockAudit as any, mockSecrets as any);
    dbMock.findFirst.mockResolvedValue(createEnvRow());
    dbMock.updateReturning.mockResolvedValue([createEnvRow({ version: 2 })]);
    dbMock.deleteReturning.mockResolvedValue([createEnvRow()]);
  });

  describe('createEnvironment', () => {
    it('creates the environment and returns it', async () => {
      const result = await service.createEnvironment(
        { id: 'env_test123', description: 'Test Env', url: 'https://example.com', login: 'admin', password: 'secret123' },
        defaultContext
      );
      expect(result).toBeDefined();
      expect(result.id).toBe('env_test123');
      expect(result.description).toBe('Test Env');
    });

    it('auto-generates ID when not provided', async () => {
      await service.createEnvironment({ description: 'No ID', url: 'https://example.com', login: 'admin', password: 'pass' }, defaultContext);
      expect(dbMock.lastInsertedValues.id).toBe('env_test123');
    });

    it('throws ForbiddenError when user lacks write permission', async () => {
      await expect(
        service.createEnvironment({ id: 'env_new', description: 'Test', password: 'pass' }, deniedContext)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getEnvironmentById', () => {
    it('returns the environment when found', async () => {
      const result = await service.getEnvironmentById('env_test123');
      expect(result).toBeDefined();
      expect(result.id).toBe('env_test123');
    });

    it('throws NotFoundError when environment does not exist', async () => {
      dbMock.findFirst.mockResolvedValue(undefined);
      await expect(service.getEnvironmentById('nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('listEnvironments', () => {
    it('returns paginated results with total count', async () => {
      const result = await service.listEnvironments();
      expect(result).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
      expect(typeof result.total).toBe('number');
      expect(typeof result.offset).toBe('number');
      expect(typeof result.limit).toBe('number');
    });

    it('respects limit and offset parameters', async () => {
      const result = await service.listEnvironments({ limit: 5, offset: 0 });
      expect(result.limit).toBe(5);
      expect(result.offset).toBe(0);
    });
  });

  describe('updateEnvironment', () => {
    it('updates the environment and returns new state', async () => {
      const result = await service.updateEnvironment('env_test123', { description: 'Updated', version: 1 }, defaultContext);
      expect(result).toBeDefined();
      expect(result.id).toBe('env_test123');
    });

    it('throws ForbiddenError when user lacks write permission', async () => {
      await expect(
        service.updateEnvironment('env_test123', { description: 'Updated', version: 1 }, deniedContext)
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when environment does not exist', async () => {
      dbMock.findFirst.mockResolvedValue(undefined);
      await expect(
        service.updateEnvironment('nonexistent', { description: 'Updated', version: 1 }, defaultContext)
      ).rejects.toThrow(NotFoundError);
    });

    it('throws OptimisticLockError on version mismatch', async () => {
      dbMock.findFirst.mockResolvedValue(createEnvRow({ version: 5 }));
      await expect(
        service.updateEnvironment('env_test123', { description: 'Updated', version: 1 }, defaultContext)
      ).rejects.toThrow(OptimisticLockError);
    });
  });

  describe('deleteEnvironment', () => {
    it('deletes the environment successfully', async () => {
      await expect(
        service.deleteEnvironment('env_test123', 1, defaultContext)
      ).resolves.toBeUndefined();
    });

    it('throws ForbiddenError when user lacks delete permission', async () => {
      await expect(
        service.deleteEnvironment('env_test123', 1, deniedContext)
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when environment does not exist', async () => {
      dbMock.findFirst.mockResolvedValue(undefined);
      await expect(
        service.deleteEnvironment('nonexistent', 1, defaultContext)
      ).rejects.toThrow(NotFoundError);
    });

    it('throws OptimisticLockError on version mismatch', async () => {
      dbMock.findFirst.mockResolvedValue(createEnvRow({ version: 5 }));
      await expect(
        service.deleteEnvironment('env_test123', 1, defaultContext)
      ).rejects.toThrow(OptimisticLockError);
    });
  });

  describe('getEnvironmentAuditLogs', () => {
    it('returns audit logs for an environment', async () => {
      const result = await service.getEnvironmentAuditLogs('env_test123');
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
