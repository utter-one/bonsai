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

  const stagesTable = {
    findFirst,
    findMany,
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation((v: Record<string, any>) => {
        Object.assign(mocks.lastInsertedValues, v);
        return {
          returning: vi.fn().mockResolvedValue([{
            projectId: 'proj_test123',
            ...v,
            llmSettings: v.llmSettings ?? { model: 'gpt-4' },
            description: v.description ?? null,
            enterBehavior: v.enterBehavior ?? 'generate_response',
            useKnowledge: v.useKnowledge ?? false,
            knowledgeTags: v.knowledgeTags ?? [],
            useGlobalActions: v.useGlobalActions ?? true,
            globalActions: v.globalActions ?? [],
            variableDescriptors: v.variableDescriptors ?? [],
            actions: v.actions ?? {},
            defaultClassifierId: v.defaultClassifierId ?? null,
            transformerIds: v.transformerIds ?? [],
            tags: v.tags ?? [],
            metadata: v.metadata ?? {},
            version: 1,
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
        returning: vi.fn().mockResolvedValue([{
          id: 'stage_test123',
          projectId: 'proj_test123',
          name: 'Test Stage',
          description: null,
          prompt: 'You are a helpful assistant',
          llmProviderId: 'prov_test',
          llmSettings: { model: 'gpt-4' },
          agentId: 'agent_test123',
          enterBehavior: 'generate_response',
          useKnowledge: false,
          knowledgeTags: [],
          useGlobalActions: true,
          globalActions: [],
          variableDescriptors: [],
   actions: {},
          defaultClassifierId: null,
          transformerIds: [],
          tags: [],
          metadata: {},
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        }]),
      }),
    }),
  };

  const agentsTable = { findFirst: vi.fn().mockResolvedValue({ id: 'agent_test123', projectId: 'proj_test123' }) };
  const classifiersTable = { findFirst: vi.fn().mockResolvedValue({ id: 'class_test123', projectId: 'proj_test123' }) };
  const contextTransformersTable = { findMany: vi.fn().mockResolvedValue([]) };
  const globalActionsTable = { findMany: vi.fn().mockResolvedValue([]) };
  const knowledgeCategoriesTable = { findMany: vi.fn().mockResolvedValue([]) };

  const selectMock = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
  });

  return {
    db: {
      query: {
        stages: stagesTable,
        agents: agentsTable,
        classifiers: classifiersTable,
        contextTransformers: contextTransformersTable,
        globalActions: globalActionsTable,
        knowledgeCategories: knowledgeCategoriesTable,
      },
      insert: stagesTable.insert,
      select: selectMock,
      update: stagesTable.update,
      delete: stagesTable.delete,
    },
    __mocks: { findFirst, findMany, updateReturning, ...mocks },
  };
});

vi.mock('../../src/utils/idGenerator', () => ({
  generateId: vi.fn().mockReturnValue('stage_test123'),
  ID_PREFIXES: { STAGE: 'stage' },
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

import { StageService } from '../../src/services/StageService';
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

const testLlmSettings = { model: 'gpt-4' };

function createStageRow(overrides?: Record<string, any>) {
  return {
    id: 'stage_test123',
    projectId: 'proj_test123',
    name: 'Test Stage',
    description: null,
    prompt: 'You are a helpful assistant',
    llmProviderId: 'prov_test',
    llmSettings: testLlmSettings,
    agentId: 'agent_test123',
    enterBehavior: 'generate_response',
    useKnowledge: false,
    knowledgeTags: [],
    useGlobalActions: true,
    globalActions: [],
    variableDescriptors: [],
    actions: {},
    defaultClassifierId: null,
    transformerIds: [],
    tags: [],
    metadata: {},
    version: 1,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('StageService', () => {
  let service: StageService;

 beforeEach(() => {
    vi.clearAllMocks();
    const mockAudit = {
      logCreate: vi.fn().mockResolvedValue(undefined),
      logUpdate: vi.fn().mockResolvedValue(undefined),
      logDelete: vi.fn().mockResolvedValue(undefined),
      getEntityAuditLogs: vi.fn().mockResolvedValue([]),
    };
    service = new StageService(mockAudit as any);
    dbMock.findFirst.mockResolvedValue(createStageRow());
    dbMock.updateReturning.mockResolvedValue([createStageRow({ version: 2 })]);
    dbMock.findMany.mockResolvedValue([]);
  });

  describe('createStage', () => {
    it('creates the stage and returns it', async () => {
      const result = await service.createStage('proj_test123', {
        name: 'New Stage',
        prompt: 'System prompt',
        llmProviderId: 'prov_test',
        llmSettings: testLlmSettings,
        agentId: 'agent_test123',
      }, defaultContext);
      expect(result).toBeDefined();
      expect(result.id).toBe('stage_test123');
    });

    it('creates the stage with a custom ID', async () => {
      const result = await service.createStage('proj_test123', {
        id: 'stage_custom',
        name: 'Custom Stage',
        prompt: 'System prompt',
        llmProviderId: 'prov_test',
        llmSettings: testLlmSettings,
        agentId: 'agent_test123',
      }, defaultContext);
      expect(result.id).toBe('stage_custom');
    });

    it('throws ForbiddenError when user lacks write permission', async () => {
      await expect(
        service.createStage('proj_test123', {
          name: 'New Stage',
          prompt: 'System prompt',
          llmProviderId: 'prov_test',
          llmSettings: testLlmSettings,
          agentId: 'agent_test123',
        }, deniedContext)
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws error when referenced agent does not exist', async () => {
      const agentsFindFirst = (db.query.agents as any).findFirst;
      agentsFindFirst.mockResolvedValueOnce(undefined);
      await expect(
        service.createStage('proj_test123', {
          name: 'New Stage',
          prompt: 'System prompt',
          llmProviderId: 'prov_test',
          llmSettings: testLlmSettings,
          agentId: 'agent_nonexistent',
        }, defaultContext)
      ).rejects.toThrow();
    });
  });

  describe('getStageById', () => {
    it('returns the stage when found', async () => {
      const result = await service.getStageById('proj_test123', 'stage_test123');
      expect(result).toBeDefined();
      expect(result.id).toBe('stage_test123');
    });

    it('throws NotFoundError when stage does not exist', async () => {
      dbMock.findFirst.mockResolvedValue(undefined);
      await expect(service.getStageById('proj_test123', 'nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('listStages', () => {
    it('returns paginated results with total count', async () => {
      const result = await service.listStages('proj_test123');
      expect(result).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
      expect(typeof result.total).toBe('number');
    });

    it('respects limit and offset parameters', async () => {
      await service.listStages('proj_test123', { limit: 5, offset: 0 });
      expect(dbMock.findMany).toHaveBeenCalled();
    });
  });

  describe('updateStage', () => {
    it('updates the stage and returns new state', async () => {
      const result = await service.updateStage('proj_test123', 'stage_test123', {
        name: 'Updated Stage',
        version: 1,
      }, defaultContext);
      expect(result).toBeDefined();
      expect(result.id).toBe('stage_test123');
    });

    it('throws ForbiddenError when user lacks write permission', async () => {
      await expect(
        service.updateStage('proj_test123', 'stage_test123', { name: 'Updated', version: 1 }, deniedContext)
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when stage does not exist', async () => {
      dbMock.findFirst.mockResolvedValue(undefined);
      await expect(
        service.updateStage('proj_test123', 'nonexistent', { name: 'Updated', version: 1 }, defaultContext)
      ).rejects.toThrow(NotFoundError);
    });

    it('throws OptimisticLockError on version mismatch', async () => {
      dbMock.findFirst.mockResolvedValue(createStageRow({ version: 5 }));
      await expect(
        service.updateStage('proj_test123', 'stage_test123', { name: 'Updated', version: 1 }, defaultContext)
      ).rejects.toThrow(OptimisticLockError);
    });

   it('validates referenced entities on update', async () => {
      const agentsFindFirst = (db.query.agents as any).findFirst;
      agentsFindFirst.mockResolvedValueOnce(undefined);
      await expect(
        service.updateStage('proj_test123', 'stage_test123', {
          name: 'Updated Stage',
          agentId: 'agent_nonexistent',
          version: 1,
        }, defaultContext)
      ).rejects.toThrow();
    });
  });

  describe('deleteStage', () => {
    it('deletes the stage successfully', async () => {
      await expect(
        service.deleteStage('proj_test123', 'stage_test123', 1, defaultContext)
      ).resolves.toBeUndefined();
    });

    it('throws ForbiddenError when user lacks delete permission', async () => {
      await expect(
        service.deleteStage('proj_test123', 'stage_test123', 1, deniedContext)
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when stage does not exist', async () => {
      dbMock.findFirst.mockResolvedValue(undefined);
      await expect(
        service.deleteStage('proj_test123', 'nonexistent', 1, defaultContext)
      ).rejects.toThrow(NotFoundError);
    });

    it('throws OptimisticLockError on version mismatch', async () => {
      dbMock.findFirst.mockResolvedValue(createStageRow({ version: 5 }));
      await expect(
        service.deleteStage('proj_test123', 'stage_test123', 1, defaultContext)
      ).rejects.toThrow(OptimisticLockError);
    });
  });

  describe('cloneStage', () => {
    it('clones the stage with new name', async () => {
      const result = await service.cloneStage('proj_test123', 'stage_test123', {
        name: 'Cloned Stage',
      }, defaultContext);
      expect(result).toBeDefined();
    });

    it('throws ForbiddenError when user lacks write permission', async () => {
      await expect(
        service.cloneStage('proj_test123', 'stage_test123', { name: 'Cloned' }, deniedContext)
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when stage does not exist', async () => {
      dbMock.findFirst.mockResolvedValue(undefined);
      await expect(
        service.cloneStage('proj_test123', 'nonexistent', { name: 'Cloned' }, defaultContext)
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('getStageAuditLogs', () => {
    it('returns audit logs for a stage', async () => {
      const result = await service.getStageAuditLogs('stage_test123', 'proj_test123');
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
