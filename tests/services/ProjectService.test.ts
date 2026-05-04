import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestContext } from '../../src/services/RequestContext';
import { ForbiddenError, NotFoundError, OptimisticLockError, InvalidOperationError, ArchivedProjectError } from '../../src/errors';

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

  const projectsTable = {
    findFirst,
    findMany,
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation((v: Record<string, any>) => {
        Object.assign(mocks.lastInsertedValues, v);
        return {
          returning: vi.fn().mockResolvedValue([{
            ...v,
            description: v.description ?? null,
            asrConfig: v.asrConfig ?? null,
            acceptVoice: v.acceptVoice ?? true,
            generateVoice: v.generateVoice ?? true,
            storageConfig: v.storageConfig ?? null,
            moderationConfig: v.moderationConfig ?? null,
            costManagementConfig: v.costManagementConfig ?? null,
            constants: v.constants ?? null,
            metadata: v.metadata ?? {},
            timezone: v.timezone ?? null,
            languageCode: v.languageCode ?? null,
            autoCreateUsers: v.autoCreateUsers ?? false,
            userProfileVariableDescriptors: v.userProfileVariableDescriptors ?? [],
            defaultGuardrailClassifierId: v.defaultGuardrailClassifierId ?? null,
            sampleCopyConfig: v.sampleCopyConfig ?? null,
            startingStageId: v.startingStageId ?? null,
            conversationTimeoutSeconds: v.conversationTimeoutSeconds ?? null,
            archivedAt: null,
            archivedBy: null,
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

  const providersTable = {
    findFirst: vi.fn().mockResolvedValue(null),
  };

  const selectMock = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
  });

  const transactionMock = vi.fn().mockImplementation(async (fn) => {
    const tx = {
      query: {
        apiKeys: { findMany: vi.fn().mockResolvedValue([]) },
        stages: { findMany: vi.fn().mockResolvedValue([]) },
        knowledgeCategories: { findMany: vi.fn().mockResolvedValue([]) },
        knowledgeItems: { findMany: vi.fn().mockResolvedValue([]) },
        globalActions: { findMany: vi.fn().mockResolvedValue([]) },
        tools: { findMany: vi.fn().mockResolvedValue([]) },
        contextTransformers: { findMany: vi.fn().mockResolvedValue([]) },
        classifiers: { findMany: vi.fn().mockResolvedValue([]) },
        agents: { findMany: vi.fn().mockResolvedValue([]) },
        conversations: { findMany: vi.fn().mockResolvedValue([]) },
        users: { findMany: vi.fn().mockResolvedValue([]) },
        guardrails: { findMany: vi.fn().mockResolvedValue([]) },
        issues: { findMany: vi.fn().mockResolvedValue([]) },
      },
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    };
    return fn(tx);
  });

  return {
    db: {
      query: { projects: projectsTable, providers: providersTable },
      insert: projectsTable.insert,
      select: selectMock,
      update: projectsTable.update,
      delete: projectsTable.delete,
      transaction: transactionMock,
    },
    __mocks: { findFirst, findMany, updateReturning, ...mocks, transaction: transactionMock },
  };
});

vi.mock('../../src/utils/idGenerator', () => ({
  generateId: vi.fn().mockReturnValue('proj_test123'),
  ID_PREFIXES: { PROJECT: 'proj' },
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

import { ProjectService } from '../../src/services/ProjectService';
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

function createProjectRow(overrides?: Record<string, any>) {
  return {
    id: 'proj_test123',
    name: 'Test Project',
    description: null,
    asrConfig: null,
    acceptVoice: false,
    generateVoice: true,
    storageConfig: null,
    moderationConfig: null,
    costManagementConfig: null,
    constants: null,
    metadata: {},
    timezone: null,
    languageCode: null,
    autoCreateUsers: false,
    userProfileVariableDescriptors: [],
    defaultGuardrailClassifierId: null,
    sampleCopyConfig: null,
    startingStageId: null,
    conversationTimeoutSeconds: null,
    archivedAt: null,
    archivedBy: null,
    version: 1,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('ProjectService', () => {
  let service: ProjectService;

  beforeEach(() => {
    vi.clearAllMocks();
    const mockAudit = {
      logCreate: vi.fn().mockResolvedValue(undefined),
      logUpdate: vi.fn().mockResolvedValue(undefined),
      logDelete: vi.fn().mockResolvedValue(undefined),
      getEntityAuditLogs: vi.fn().mockResolvedValue([]),
    };
    service = new ProjectService(mockAudit as any);
    dbMock.findFirst.mockResolvedValue(createProjectRow());
    dbMock.updateReturning.mockResolvedValue([createProjectRow({ version: 2 })]);
  });

  describe('createProject', () => {
    it('creates the project and returns it', async () => {
      const result = await service.createProject({ name: 'New Project', acceptVoice: false }, defaultContext);
      expect(result).toBeDefined();
      expect(result.id).toBe('proj_test123');
      expect(result.name).toBe('New Project');
    });

    it('throws ForbiddenError when user lacks write permission', async () => {
      await expect(
        service.createProject({ name: 'New Project', acceptVoice: false }, deniedContext)
      ).rejects.toThrow(ForbiddenError);
    });

    it('requires asrConfig when acceptVoice is true', async () => {
      await expect(
        service.createProject({ name: 'Voice Project', acceptVoice: true, asrConfig: null }, defaultContext)
      ).rejects.toThrow(InvalidOperationError);
    });

    it('auto-sets acceptVoice to true by default with asrConfig', async () => {
      const result = await service.createProject({ name: 'Default Voice', asrConfig: { providerId: 'p1' } }, defaultContext);
      expect(result.acceptVoice).toBe(true);
    });
  });

  describe('getProjectById', () => {
    it('returns the project when found', async () => {
      const result = await service.getProjectById('proj_test123');
      expect(result).toBeDefined();
      expect(result.id).toBe('proj_test123');
    });

    it('throws NotFoundError when project does not exist', async () => {
      dbMock.findFirst.mockResolvedValue(undefined);
      await expect(service.getProjectById('nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('listProjects', () => {
    it('returns paginated results with total count', async () => {
      const result = await service.listProjects();
      expect(result).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
      expect(typeof result.total).toBe('number');
    });

    it('respects limit and offset parameters', async () => {
      await service.listProjects({ limit: 5, offset: 0 });
      expect(dbMock.findMany).toHaveBeenCalled();
    });
  });

  describe('updateProject', () => {
    it('updates the project and returns new state', async () => {
      const result = await service.updateProject('proj_test123', { name: 'Updated Name', version: 1 }, defaultContext);
      expect(result).toBeDefined();
      expect(result.id).toBe('proj_test123');
    });

    it('throws ForbiddenError when user lacks write permission', async () => {
      await expect(
        service.updateProject('proj_test123', { name: 'Updated', version: 1 }, deniedContext)
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when project does not exist', async () => {
      dbMock.findFirst.mockResolvedValue(undefined);
      await expect(
        service.updateProject('nonexistent', { name: 'Updated', version: 1 }, defaultContext)
      ).rejects.toThrow(NotFoundError);
    });

    it('throws OptimisticLockError on version mismatch', async () => {
      dbMock.findFirst.mockResolvedValue(createProjectRow({ version: 5 }));
      await expect(
        service.updateProject('proj_test123', { name: 'Updated', version: 1 }, defaultContext)
      ).rejects.toThrow(OptimisticLockError);
    });

    it('throws error when project is archived', async () => {
      dbMock.findFirst.mockResolvedValue(createProjectRow({
        archivedAt: new Date(),
        archivedBy: 'op_other',
      }));
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: 'proj_test123' }]),
          }),
        }),
      } as any);
      await expect(
        service.updateProject('proj_test123', { name: 'Updated', version: 1 }, defaultContext)
      ).rejects.toThrow(ArchivedProjectError);
    });
  });

  describe('deleteProject', () => {
    it('deletes the project (runs transaction)', async () => {
      await expect(
        service.deleteProject('proj_test123', defaultContext)
      ).resolves.toBeUndefined();
      expect(dbMock.transaction).toHaveBeenCalled();
    });

    it('throws ForbiddenError when user lacks delete permission', async () => {
      await expect(
        service.deleteProject('proj_test123', deniedContext)
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when project does not exist', async () => {
      dbMock.findFirst.mockResolvedValue(undefined);
      await expect(
        service.deleteProject('nonexistent', defaultContext)
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('archiveProject', () => {
    it('archives the project successfully', async () => {
      const result = await service.archiveProject('proj_test123', { version: 1 }, defaultContext);
      expect(result).toBeDefined();
      expect(result.id).toBe('proj_test123');
    });

    it('throws ArchivedProjectError when already archived', async () => {
      dbMock.findFirst.mockResolvedValue(createProjectRow({
        archivedAt: new Date(),
        archivedBy: 'op_other',
      }));
      await expect(
        service.archiveProject('proj_test123', { version: 1 }, defaultContext)
      ).rejects.toThrow(ArchivedProjectError);
    });

    it('throws OptimisticLockError on version mismatch', async () => {
      dbMock.findFirst.mockResolvedValue(createProjectRow({ version: 5 }));
      await expect(
        service.archiveProject('proj_test123', { version: 1 }, defaultContext)
      ).rejects.toThrow(OptimisticLockError);
    });

    it('throws ForbiddenError when user lacks write permission', async () => {
      await expect(
        service.archiveProject('proj_test123', { version: 1 }, deniedContext)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('unarchiveProject', () => {
    it('unarchives the project successfully', async () => {
      dbMock.findFirst.mockResolvedValue(createProjectRow({
        archivedAt: new Date(),
        archivedBy: 'op_other',
        version: 1,
      }));
      const result = await service.unarchiveProject('proj_test123', { version: 1 }, defaultContext);
      expect(result).toBeDefined();
      expect(result.id).toBe('proj_test123');
    });

    it('throws InvalidOperationError when not archived', async () => {
      dbMock.findFirst.mockResolvedValue(createProjectRow({ archivedAt: null }));
      await expect(
        service.unarchiveProject('proj_test123', { version: 1 }, defaultContext)
      ).rejects.toThrow(InvalidOperationError);
    });

    it('throws OptimisticLockError on version mismatch', async () => {
      dbMock.findFirst.mockResolvedValue(createProjectRow({
        archivedAt: new Date(),
        archivedBy: 'op_other',
        version: 5,
      }));
      await expect(
        service.unarchiveProject('proj_test123', { version: 1 }, defaultContext)
      ).rejects.toThrow(OptimisticLockError);
    });

    it('throws ForbiddenError when user lacks write permission', async () => {
      dbMock.findFirst.mockResolvedValue(createProjectRow({
        archivedAt: new Date(),
        archivedBy: 'op_other',
      }));
      await expect(
        service.unarchiveProject('proj_test123', { version: 1 }, deniedContext)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getProjectAuditLogs', () => {
    it('returns audit logs for a project', async () => {
      const result = await service.getProjectAuditLogs('proj_test123');
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
