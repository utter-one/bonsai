import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestContext } from '../../src/services/RequestContext';
import { ForbiddenError, NotFoundError, OptimisticLockError, ValidationError } from '../../src/errors';

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

  const operatorsTable = {
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
      query: { operators: operatorsTable },
      insert: operatorsTable.insert,
      update: operatorsTable.update,
      delete: operatorsTable.delete,
    },
    __mocks: { findFirst, findMany, updateReturning, deleteReturning, ...mocks },
  };
});

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

import { OperatorService } from '../../src/services/OperatorService';
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

function createOperatorRow(overrides?: Record<string, any>) {
  return {
    id: 'op_test123',
    name: 'Test Operator',
    roles: ['content_manager'],
    password: 'hashed_password',
    metadata: {},
    version: 1,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('OperatorService', () => {
  let service: OperatorService;
  let mockAuthService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthService = {
      hashPassword: vi.fn().mockResolvedValue('hashed_pw'),
      verifyPassword: vi.fn().mockResolvedValue(true),
    };
    const mockAudit = {
      logCreate: vi.fn().mockResolvedValue(undefined),
      logUpdate: vi.fn().mockResolvedValue(undefined),
      logDelete: vi.fn().mockResolvedValue(undefined),
      getEntityAuditLogs: vi.fn().mockResolvedValue([]),
    };
    service = new OperatorService(mockAudit as any, mockAuthService);
    dbMock.findFirst.mockResolvedValue(createOperatorRow());
    dbMock.updateReturning.mockResolvedValue([createOperatorRow({ version: 2 })]);
    dbMock.deleteReturning.mockResolvedValue([createOperatorRow()]);
  });

  describe('createOperator', () => {
    it('creates the operator and returns it', async () => {
      const result = await service.createOperator(
        { id: 'op_new@test.com', name: 'New Op', roles: ['content_manager'], password: 'pass123' },
        defaultContext
      );
      expect(result).toBeDefined();
      expect(result.id).toBe('op_new@test.com');
      expect(result.name).toBe('New Op');
      expect(result.roles).toEqual(['content_manager']);
    });

    it('throws ForbiddenError when user lacks write permission', async () => {
      await expect(
        service.createOperator({ id: 'op_new', name: 'New', roles: ['viewer'], password: 'pass' }, deniedContext)
      ).rejects.toThrow(ForbiddenError);
    });

    it('removes duplicate roles', async () => {
      await service.createOperator(
        { id: 'op_dedup', name: 'Dup', roles: ['viewer', 'viewer'], password: 'pass' },
        defaultContext
      );
      expect(dbMock.lastInsertedValues.roles).toEqual(['viewer']);
    });

    it('throws error for invalid role', async () => {
      await expect(
        service.createOperator({ id: 'op_invalid', name: 'Inv', roles: ['invalid_role'], password: 'pass' }, defaultContext)
      ).rejects.toThrow(/Invalid roles/);
    });
  });

  describe('getOperatorById', () => {
    it('returns the operator when found', async () => {
      const result = await service.getOperatorById('op_test123');
      expect(result).toBeDefined();
      expect(result.id).toBe('op_test123');
    });

    it('throws NotFoundError when operator does not exist', async () => {
      dbMock.findFirst.mockResolvedValue(undefined);
      await expect(service.getOperatorById('nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('listOperators', () => {
    it('returns paginated results with total count', async () => {
      const result = await service.listOperators();
      expect(result).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
      expect(typeof result.total).toBe('number');
      expect(typeof result.offset).toBe('number');
      expect(typeof result.limit).toBe('number');
    });

    it('respects limit and offset parameters', async () => {
      const result = await service.listOperators({ limit: 5, offset: 0 });
      expect(result.limit).toBe(5);
      expect(result.offset).toBe(0);
    });
  });

  describe('updateOperator', () => {
    it('updates the operator and returns new state', async () => {
      const result = await service.updateOperator('op_test123', { name: 'Updated Name', version: 1 }, defaultContext);
      expect(result).toBeDefined();
      expect(result.id).toBe('op_test123');
    });

    it('throws ForbiddenError when user lacks write permission', async () => {
      await expect(
        service.updateOperator('op_test123', { name: 'Updated', version: 1 }, deniedContext)
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when operator does not exist', async () => {
      dbMock.findFirst.mockResolvedValue(undefined);
      await expect(
        service.updateOperator('nonexistent', { name: 'Updated', version: 1 }, defaultContext)
      ).rejects.toThrow(NotFoundError);
    });

    it('throws OptimisticLockError on version mismatch', async () => {
      dbMock.findFirst.mockResolvedValue(createOperatorRow({ version: 5 }));
      await expect(
        service.updateOperator('op_test123', { name: 'Updated', version: 1 }, defaultContext)
      ).rejects.toThrow(OptimisticLockError);
    });
  });

  describe('deleteOperator', () => {
    it('deletes the operator successfully', async () => {
      await expect(
        service.deleteOperator('op_test123', 1, defaultContext)
      ).resolves.toBeUndefined();
    });

    it('throws ForbiddenError when user lacks delete permission', async () => {
      await expect(
        service.deleteOperator('op_test123', 1, deniedContext)
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when operator does not exist', async () => {
      dbMock.findFirst.mockResolvedValue(undefined);
      await expect(
        service.deleteOperator('nonexistent', 1, defaultContext)
      ).rejects.toThrow(NotFoundError);
    });

    it('throws OptimisticLockError on version mismatch', async () => {
      dbMock.findFirst.mockResolvedValue(createOperatorRow({ version: 5 }));
      await expect(
        service.deleteOperator('op_test123', 1, defaultContext)
      ).rejects.toThrow(OptimisticLockError);
    });
  });

  describe('getProfile', () => {
    it('returns the profile of the logged-in operator', async () => {
      const result = await service.getProfile(defaultContext);
      expect(result).toBeDefined();
      expect(result.id).toBe('op_test123');
    });

    it('throws NotFoundError when operator does not exist', async () => {
      dbMock.findFirst.mockResolvedValue(undefined);
      await expect(service.getProfile(defaultContext)).rejects.toThrow(NotFoundError);
    });
  });

  describe('updateProfile', () => {
    it('updates the profile with name change', async () => {
      const result = await service.updateProfile({ name: 'New Name' }, defaultContext);
      expect(result).toBeDefined();
      expect(result.id).toBe('op_test123');
    });

    it('verifies old password when changing password', async () => {
      await service.updateProfile({ oldPassword: 'oldpass', newPassword: 'newpass' }, defaultContext);
      expect(mockAuthService.verifyPassword).toHaveBeenCalledWith('oldpass', 'hashed_password');
    });

    it('throws ValidationError when old password is invalid', async () => {
      mockAuthService.verifyPassword.mockResolvedValue(false);
      await expect(
        service.updateProfile({ oldPassword: 'wrong', newPassword: 'newpass' }, defaultContext)
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError when old password is missing with new password', async () => {
      await expect(
        service.updateProfile({ newPassword: 'newpass' }, defaultContext)
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('getOperatorAuditLogs', () => {
    it('returns audit logs for an operator', async () => {
      const result = await service.getOperatorAuditLogs('op_test123');
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
