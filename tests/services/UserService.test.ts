import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestContext } from '../../src/services/RequestContext';
import { ForbiddenError, NotFoundError } from '../../src/errors';

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

  const usersTable = {
    findFirst,
    findMany,
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation((v: Record<string, any>) => {
        Object.assign(mocks.lastInsertedValues, v);
        return {
          returning: vi.fn().mockResolvedValue([{
            ...v,
            profile: v.profile ?? {},
            banned: v.banned ?? false,
            banReason: v.banReason ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
          }]),
          onConflictDoNothing: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{
              ...v,
              profile: v.profile ?? {},
              banned: v.banned ?? false,
              banReason: v.banReason ?? null,
              createdAt: new Date(),
              updatedAt: new Date(),
            }]),
          }),
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
        returning: vi.fn().mockResolvedValue([{
          id: 'user_test123',
          projectId: 'proj_test123',
          profile: { name: 'Test User' },
          banned: false,
          banReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }]),
      }),
    }),
  };

  const selectMock = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
  });

  return {
    db: {
      query: { users: usersTable },
      insert: usersTable.insert,
      select: selectMock,
      update: usersTable.update,
      delete: usersTable.delete,
    },
    __mocks: { findFirst, findMany, updateReturning, ...mocks },
  };
});

vi.mock('../../src/utils/idGenerator', () => ({
  generateId: vi.fn().mockReturnValue('user_test123'),
  ID_PREFIXES: { USER: 'user' },
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

vi.mock('../../src/utils/deepMerge', () => ({
  deepMerge: vi.fn((a, b) => ({ ...a, ...b })),
}));

import { UserService } from '../../src/services/UserService';
import { db, __mocks as dbMock } from '../../src/db/index';

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

function createUserRow(overrides?: Record<string, any>) {
  return {
    id: 'user_test123',
    projectId: 'proj_test123',
    profile: { name: 'Test User' },
    banned: false,
    banReason: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('UserService', () => {
  let service: UserService;

  beforeEach(() => {
    vi.clearAllMocks();
    const mockAudit = {
      logCreate: vi.fn().mockResolvedValue(undefined),
      logUpdate: vi.fn().mockResolvedValue(undefined),
      logDelete: vi.fn().mockResolvedValue(undefined),
      getEntityAuditLogs: vi.fn().mockResolvedValue([]),
    };
    service = new UserService(mockAudit as any);
    dbMock.findFirst.mockResolvedValue(createUserRow());
    dbMock.updateReturning.mockResolvedValue([createUserRow({ updatedAt: new Date() })]);
  });

  describe('createUser', () => {
    it('creates the user and returns it', async () => {
      const result = await service.createUser('proj_test123', { profile: { name: 'New User' } }, defaultContext);
      expect(result).toBeDefined();
      expect(result.id).toBe('user_test123');
    });

    it('creates the user with a custom ID', async () => {
      const result = await service.createUser('proj_test123', { id: 'user_custom', profile: { name: 'Custom' } }, defaultContext);
      expect(result.id).toBe('user_custom');
    });

    it('throws ForbiddenError when user lacks write permission', async () => {
      await expect(
        service.createUser('proj_test123', { profile: {} }, deniedContext)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getUserById', () => {
    it('returns the user when found', async () => {
      const result = await service.getUserById('proj_test123', 'user_test123');
      expect(result).toBeDefined();
      expect(result.id).toBe('user_test123');
    });

    it('throws NotFoundError when user does not exist', async () => {
      dbMock.findFirst.mockResolvedValue(undefined);
      await expect(service.getUserById('proj_test123', 'nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('listUsers', () => {
    it('returns paginated results with total count', async () => {
      const result = await service.listUsers('proj_test123');
      expect(result).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
      expect(typeof result.total).toBe('number');
    });

    it('respects limit and offset parameters', async () => {
      await service.listUsers('proj_test123', { limit: 5, offset: 0 });
      expect(dbMock.findMany).toHaveBeenCalled();
    });

    it('applies text search', async () => {
      await service.listUsers('proj_test123', { textSearch: 'John' });
      expect(dbMock.findMany).toHaveBeenCalled();
    });
  });

  describe('updateUser', () => {
    it('updates the user and returns new state', async () => {
      const result = await service.updateUser('proj_test123', 'user_test123', { profile: { name: 'Updated' } }, defaultContext);
      expect(result).toBeDefined();
      expect(result.id).toBe('user_test123');
    });

    it('throws ForbiddenError when user lacks write permission', async () => {
      await expect(
        service.updateUser('proj_test123', 'user_test123', { profile: {} }, deniedContext)
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when user does not exist', async () => {
      dbMock.findFirst.mockResolvedValue(undefined);
      await expect(
        service.updateUser('proj_test123', 'nonexistent', { profile: {} }, defaultContext)
      ).rejects.toThrow(NotFoundError);
    });

    it('updates banned status and ban reason', async () => {
      const result = await service.updateUser('proj_test123', 'user_test123', { banned: true, banReason: 'Violation' }, defaultContext);
      expect(result).toBeDefined();
    });
  });

  describe('deleteUser', () => {
    it('deletes the user successfully', async () => {
      await expect(
        service.deleteUser('proj_test123', 'user_test123', defaultContext)
      ).resolves.toBeUndefined();
    });

    it('throws ForbiddenError when user lacks delete permission', async () => {
      await expect(
        service.deleteUser('proj_test123', 'user_test123', deniedContext)
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when user does not exist', async () => {
      dbMock.findFirst.mockResolvedValue(undefined);
      await expect(
        service.deleteUser('proj_test123', 'nonexistent', defaultContext)
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('ensureUserExists', () => {
    it('creates user if not exists', async () => {
      dbMock.findFirst.mockResolvedValue(undefined);
      const result = await service.ensureUserExists('proj_test123', 'user_new');
      expect(result).toBeDefined();
    });

    it('returns existing user if already exists', async () => {
      const result = await service.ensureUserExists('proj_test123', 'user_test123');
      expect(result.id).toBe('user_test123');
    });
  });

  describe('updateUserProfile', () => {
    it('updates profile for existing user', async () => {
      await service.updateUserProfile('proj_test123', 'user_test123', { age: 30 });
      expect(db.update).toHaveBeenCalled();
    });

    it('creates user with profile if not exists', async () => {
      dbMock.findFirst.mockResolvedValue(undefined);
      await service.updateUserProfile('proj_test123', 'user_new', { name: 'New' });
      expect(db.update).not.toHaveBeenCalled();
    });
  });

  describe('banUser', () => {
    it('bans the user successfully', async () => {
      await service.banUser('proj_test123', 'user_test123', 'Rule violation');
      expect(dbMock.updateReturning).toHaveBeenCalled();
    });

    it('throws NotFoundError when user does not exist', async () => {
      dbMock.findFirst.mockResolvedValue(undefined);
      await expect(
        service.banUser('proj_test123', 'nonexistent', 'Rule violation')
      ).rejects.toThrow(NotFoundError);
    });

    it('bans user without reason', async () => {
      await service.banUser('proj_test123', 'user_test123');
      expect(dbMock.updateReturning).toHaveBeenCalled();
    });
  });

  describe('getUserAuditLogs', () => {
    it('returns audit logs for a user', async () => {
      const result = await service.getUserAuditLogs('user_test123', 'proj_test123');
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
