import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KnowledgeService } from '../../src/services/KnowledgeService';
import { ForbiddenError, NotFoundError, OptimisticLockError } from '../../src/errors';
import type { RequestContext } from '../../src/services/RequestContext';
import { PERMISSIONS } from '../../src/permissions';

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../src/db/index', () => {
  const catFindFirst = vi.fn().mockResolvedValue({});
  const catFindMany = vi.fn().mockResolvedValue([]);
  const itemFindFirst = vi.fn().mockResolvedValue({});
  const itemFindMany = vi.fn().mockResolvedValue([]);
  const mocks = { lastInsertedValues: {} as Record<string, any> };
  const updateReturning = vi.fn().mockResolvedValue([]);
  const deleteReturning = vi.fn().mockResolvedValue([]);

  const mockInsert = () => vi.fn().mockReturnValue({
    values: vi.fn().mockImplementation((v) => {
      Object.assign(mocks.lastInsertedValues, v);
      return {
        returning: vi.fn().mockResolvedValue([{
          ...v,
          createdAt: new Date(),
          updatedAt: new Date(),
        }]),
      };
    }),
  });

  const mockUpdate = () => vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: updateReturning,
      }),
    }),
  });

  const mockDelete = () => vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({
      returning: deleteReturning,
    }),
  });

  const selectMock = vi.fn().mockImplementation((args) => {
    // Check if this is a count query (has count property)
    const isCountQuery = args && typeof args === 'object' && 'count' in args;

    if (isCountQuery) {
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue([{ count: 0 }]),
        }),
      };
    }

    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    };
  });

  return {
    db: {
      query: {
        knowledgeCategories: {
          findFirst: catFindFirst,
          findMany: catFindMany,
          insert: mockInsert(),
          update: mockUpdate(),
          delete: mockDelete(),
        },
        knowledgeItems: {
          findFirst: itemFindFirst,
          findMany: itemFindMany,
          insert: mockInsert(),
          update: mockUpdate(),
          delete: mockDelete(),
        },
      },
      select: selectMock,
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockImplementation((v) => {
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
    },
    __mocks: { catFindFirst, catFindMany, itemFindFirst, itemFindMany, updateReturning, deleteReturning, lastInsertedValues: mocks.lastInsertedValues },
  };
});

vi.mock('../../src/utils/idGenerator', () => ({
  generateId: vi.fn().mockReturnValue('kc_auto001'),
  ID_PREFIXES: {
    KNOWLEDGE_CATEGORY: 'kc_',
    KNOWLEDGE_ITEM: 'ki_',
  },
}));

const { __mocks: dbMock } = await import('../../src/db/index');

describe('KnowledgeService', () => {
  const defaultContext: RequestContext = {
    operatorId: 'op_test123',
    roles: ['super_admin'],
    ip: '127.0.0.1',
    userAgent: 'TestAgent/1.0',
    requestId: 'req_test123',
    timestamp: new Date().toISOString(),
  };

  const deniedContext: RequestContext = {
    operatorId: 'op_denied123',
    roles: ['viewer'],
    ip: '127.0.0.1',
    userAgent: 'TestAgent/1.0',
    requestId: 'req_test124',
    timestamp: new Date().toISOString(),
  };

  const testProjectId = '__test_project__';

  const createCategoryRow = (overrides?: any) => ({
    id: 'kc_test001',
    projectId: testProjectId,
    name: 'Test Category',
    promptTrigger: 'test trigger',
    tags: [],
    order: 0,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [],
    ...overrides,
  });

  const createItemRow = (overrides?: any) => ({
    id: 'ki_test001',
    projectId: testProjectId,
    categoryId: 'kc_test001',
    question: 'Test Question',
    answer: 'Test Answer',
    order: 0,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  let service: KnowledgeService;
  let mockAudit: { logCreate: ReturnType<typeof vi.fn>; logUpdate: ReturnType<typeof vi.fn>; logDelete: ReturnType<typeof vi.fn>; getEntityAuditLogs: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAudit = {
      logCreate: vi.fn().mockResolvedValue(undefined),
      logUpdate: vi.fn().mockResolvedValue(undefined),
      logDelete: vi.fn().mockResolvedValue(undefined),
      getEntityAuditLogs: vi.fn().mockResolvedValue([]),
    };
    service = new KnowledgeService(mockAudit as any);
    dbMock.catFindFirst.mockResolvedValue(createCategoryRow());
    dbMock.catFindMany.mockResolvedValue([createCategoryRow()]);
    dbMock.itemFindFirst.mockResolvedValue(createItemRow());
    dbMock.itemFindMany.mockResolvedValue([createItemRow()]);
    dbMock.updateReturning.mockResolvedValue([createCategoryRow({ version: 2 })]);
    dbMock.deleteReturning.mockResolvedValue([createCategoryRow()]);
  });

  describe('createKnowledgeCategory', () => {
    it('creates the category and returns it', async () => {
      const result = await service.createKnowledgeCategory(testProjectId, { id: 'kc_test001', name: 'New Category', promptTrigger: 'test trigger' }, defaultContext);
      expect(result).toBeDefined();
      expect(result.id).toBe('kc_test001');
      expect(result.name).toBe('New Category');
    });

    it('generates ID when not provided', async () => {
      const result = await service.createKnowledgeCategory(testProjectId, { name: 'Auto ID Category', promptTrigger: 'test trigger' }, defaultContext);
      expect(result.id).toBe('kc_auto001');
    });

    it('logs audit entry on successful creation', async () => {
      await service.createKnowledgeCategory(testProjectId, { id: 'kc_test001', name: 'Audited Category', promptTrigger: 'test trigger' }, defaultContext);
      expect(mockAudit.logCreate).toHaveBeenCalledWith('knowledge_category', 'kc_test001', expect.any(Object), 'op_test123');
    });

    it('throws ForbiddenError when user lacks write permission', async () => {
      await expect(
        service.createKnowledgeCategory(testProjectId, { id: 'kc_test001', name: 'New Category', promptTrigger: 'test trigger' }, deniedContext)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getKnowledgeCategoryById', () => {
    it('returns the category when found', async () => {
      const result = await service.getKnowledgeCategoryById(testProjectId, 'kc_test001');
      expect(result).toBeDefined();
      expect(result.id).toBe('kc_test001');
    });

    it('throws NotFoundError when category not found', async () => {
      dbMock.catFindFirst.mockResolvedValue(undefined);
      await expect(
        service.getKnowledgeCategoryById(testProjectId, 'kc_nonexistent')
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('listKnowledgeCategories', () => {
    it('returns paginated categories list', async () => {
      dbMock.catFindMany.mockResolvedValue([createCategoryRow()]);
      const result = await service.listKnowledgeCategories(testProjectId, { limit: 10, offset: 0 });
      expect(result).toBeDefined();
    });

    it('returns empty list when no categories exist', async () => {
      dbMock.catFindMany.mockResolvedValue([]);
      const result = await service.listKnowledgeCategories(testProjectId);
      expect(result).toBeDefined();
    });
  });

  describe('updateKnowledgeCategory', () => {
    it('updates the category and returns new state', async () => {
      dbMock.catFindFirst.mockResolvedValue(createCategoryRow());
      dbMock.updateReturning.mockResolvedValue([createCategoryRow({ version: 2 })]);
      const result = await service.updateKnowledgeCategory(testProjectId, 'kc_test001', { name: 'Updated Category', version: 1 }, defaultContext);
      expect(result).toBeDefined();
      expect(result.id).toBe('kc_test001');
    });

    it('logs audit entry on successful update', async () => {
      dbMock.catFindFirst.mockResolvedValue(createCategoryRow());
      dbMock.updateReturning.mockResolvedValue([createCategoryRow({ version: 2 })]);
      await service.updateKnowledgeCategory(testProjectId, 'kc_test001', { name: 'Updated Audited', version: 1 }, defaultContext);
      expect(mockAudit.logUpdate).toHaveBeenCalledWith('knowledge_category', 'kc_test001', expect.any(Object), expect.any(Object), 'op_test123', testProjectId);
    });

    it('throws OptimisticLockError when version mismatch', async () => {
      dbMock.catFindFirst.mockResolvedValue(createCategoryRow({ version: 5 }));
      await expect(
        service.updateKnowledgeCategory(testProjectId, 'kc_test001', { name: 'Updated', version: 1 }, defaultContext)
      ).rejects.toThrow(OptimisticLockError);
    });

    it('throws NotFoundError when category not found', async () => {
      dbMock.catFindFirst.mockResolvedValue(undefined);
      await expect(
        service.updateKnowledgeCategory(testProjectId, 'kc_nonexistent', { name: 'Updated', version: 1 }, defaultContext)
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError when user lacks write permission', async () => {
      await expect(
        service.updateKnowledgeCategory(testProjectId, 'kc_test001', { name: 'Updated', version: 1 }, deniedContext)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('deleteKnowledgeCategory', () => {
    it('deletes the category successfully', async () => {
      dbMock.catFindFirst.mockResolvedValue(createCategoryRow());
      await expect(
        service.deleteKnowledgeCategory(testProjectId, 'kc_test001', 1, defaultContext)
      ).resolves.toBeUndefined();
    });

    it('logs audit entry on successful deletion', async () => {
      dbMock.catFindFirst.mockResolvedValue(createCategoryRow());
      await service.deleteKnowledgeCategory(testProjectId, 'kc_test001', 1, defaultContext);
      expect(mockAudit.logDelete).toHaveBeenCalledWith('knowledge_category', 'kc_test001', expect.any(Object), 'op_test123', testProjectId);
    });

    it('throws OptimisticLockError when version mismatch', async () => {
      dbMock.catFindFirst.mockResolvedValue(createCategoryRow({ version: 5 }));
      await expect(
        service.deleteKnowledgeCategory(testProjectId, 'kc_test001', 1, defaultContext)
      ).rejects.toThrow(OptimisticLockError);
    });

    it('throws NotFoundError when category not found', async () => {
      dbMock.catFindFirst.mockResolvedValue(undefined);
      await expect(
        service.deleteKnowledgeCategory(testProjectId, 'kc_nonexistent', 1, defaultContext)
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError when user lacks delete permission', async () => {
      dbMock.catFindFirst.mockResolvedValue(createCategoryRow());
      await expect(
        service.deleteKnowledgeCategory(testProjectId, 'kc_test001', 1, deniedContext)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('createKnowledgeItem', () => {
    it('creates the item and returns it', async () => {
      const result = await service.createKnowledgeItem(testProjectId, { id: 'ki_test001', categoryId: 'kc_test001', question: 'Q?', answer: 'A!' }, defaultContext);
      expect(result).toBeDefined();
      expect(result.id).toBe('ki_test001');
      expect(result.question).toBe('Q?');
    });

    it('generates ID when not provided', async () => {
      const result = await service.createKnowledgeItem(testProjectId, { categoryId: 'kc_test001', question: 'Q?', answer: 'A!' }, defaultContext);
      expect(result.id).toBe('kc_auto001');
    });

    it('logs audit entry on successful creation', async () => {
      await service.createKnowledgeItem(testProjectId, { id: 'ki_test001', categoryId: 'kc_test001', question: 'Q?', answer: 'A!' }, defaultContext);
      expect(mockAudit.logCreate).toHaveBeenCalledWith('knowledge_item', 'ki_test001', expect.any(Object), 'op_test123', testProjectId);
    });

    it('throws ForbiddenError when user lacks write permission', async () => {
      await expect(
        service.createKnowledgeItem(testProjectId, { id: 'ki_test001', categoryId: 'kc_test001', question: 'Q?', answer: 'A!' }, deniedContext)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getKnowledgeItemById', () => {
    it('returns the item when found', async () => {
      dbMock.itemFindFirst.mockResolvedValue(createItemRow());
      const result = await service.getKnowledgeItemById(testProjectId, 'ki_test001');
      expect(result).toBeDefined();
      expect(result.id).toBe('ki_test001');
    });

    it('throws NotFoundError when item not found', async () => {
      dbMock.itemFindFirst.mockResolvedValue(undefined);
      await expect(
        service.getKnowledgeItemById(testProjectId, 'ki_nonexistent')
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('listKnowledgeItems', () => {
    it('returns paginated items list', async () => {
      dbMock.itemFindMany.mockResolvedValue([createItemRow()]);
      const result = await service.listKnowledgeItems(testProjectId, { limit: 10, offset: 0 });
      expect(result).toBeDefined();
    });

    it('returns empty list when no items exist', async () => {
      dbMock.itemFindMany.mockResolvedValue([]);
      const result = await service.listKnowledgeItems(testProjectId);
      expect(result).toBeDefined();
    });
  });

  describe('updateKnowledgeItem', () => {
    it('updates the item and returns new state', async () => {
      dbMock.itemFindFirst.mockResolvedValue(createItemRow());
      dbMock.updateReturning.mockResolvedValue([createItemRow({ version: 2 })]);
      const result = await service.updateKnowledgeItem(testProjectId, 'ki_test001', { question: 'Updated Q?', answer: 'Updated A!', version: 1 }, defaultContext);
      expect(result).toBeDefined();
      expect(result.id).toBe('ki_test001');
    });

    it('logs audit entry on successful update', async () => {
      dbMock.itemFindFirst.mockResolvedValue(createItemRow());
      dbMock.updateReturning.mockResolvedValue([createItemRow({ version: 2 })]);
      await service.updateKnowledgeItem(testProjectId, 'ki_test001', { question: 'Audited Q?', answer: 'A!', version: 1 }, defaultContext);
      expect(mockAudit.logUpdate).toHaveBeenCalledWith('knowledge_item', 'ki_test001', expect.any(Object), expect.any(Object), 'op_test123', testProjectId);
    });

    it('throws OptimisticLockError when version mismatch', async () => {
      dbMock.itemFindFirst.mockResolvedValue(createItemRow({ version: 5 }));
      await expect(
        service.updateKnowledgeItem(testProjectId, 'ki_test001', { question: 'Q?', answer: 'A!', version: 1 }, defaultContext)
      ).rejects.toThrow(OptimisticLockError);
    });

    it('throws NotFoundError when item not found', async () => {
      dbMock.itemFindFirst.mockResolvedValue(undefined);
      await expect(
        service.updateKnowledgeItem(testProjectId, 'ki_nonexistent', { question: 'Q?', answer: 'A!', version: 1 }, defaultContext)
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError when user lacks write permission', async () => {
      await expect(
        service.updateKnowledgeItem(testProjectId, 'ki_test001', { question: 'Q?', answer: 'A!', version: 1 }, deniedContext)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('deleteKnowledgeItem', () => {
    it('deletes the item successfully', async () => {
      dbMock.itemFindFirst.mockResolvedValue(createItemRow());
      await expect(
        service.deleteKnowledgeItem(testProjectId, 'ki_test001', 1, defaultContext)
      ).resolves.toBeUndefined();
    });

    it('logs audit entry on successful deletion', async () => {
      dbMock.itemFindFirst.mockResolvedValue(createItemRow());
      await service.deleteKnowledgeItem(testProjectId, 'ki_test001', 1, defaultContext);
      expect(mockAudit.logDelete).toHaveBeenCalledWith('knowledge_item', 'ki_test001', expect.any(Object), 'op_test123', testProjectId);
    });

    it('throws OptimisticLockError when version mismatch', async () => {
      dbMock.itemFindFirst.mockResolvedValue(createItemRow({ version: 5 }));
      await expect(
        service.deleteKnowledgeItem(testProjectId, 'ki_test001', 1, defaultContext)
      ).rejects.toThrow(OptimisticLockError);
    });

    it('throws NotFoundError when item not found', async () => {
      dbMock.itemFindFirst.mockResolvedValue(undefined);
      await expect(
        service.deleteKnowledgeItem(testProjectId, 'ki_nonexistent', 1, defaultContext)
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError when user lacks delete permission', async () => {
      dbMock.itemFindFirst.mockResolvedValue(createItemRow());
      await expect(
        service.deleteKnowledgeItem(testProjectId, 'ki_test001', 1, deniedContext)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getItemsByCategory', () => {
    it('returns items for the category', async () => {
      dbMock.itemFindMany.mockResolvedValue([createItemRow(), createItemRow({ id: 'ki_test002' })]);
      const result = await service.getItemsByCategory(testProjectId, 'kc_test001');
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('returns empty array when no items in category', async () => {
      dbMock.itemFindMany.mockResolvedValue([]);
      const result = await service.getItemsByCategory(testProjectId, 'kc_test001');
      expect(result).toEqual([]);
    });
  });

  describe('getCategoriesByTags', () => {
    it('returns categories matching tags', async () => {
      dbMock.catFindMany.mockResolvedValue([
        createCategoryRow({ id: 'kc_001', tags: ['tag1'] }),
        createCategoryRow({ id: 'kc_002', tags: ['tag2'] }),
        createCategoryRow({ id: 'kc_003', tags: ['tag1', 'tag3'] }),
      ]);
      const result = await service.getCategoriesByTags(testProjectId, ['tag1']);
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('returns empty array when no categories match', async () => {
      dbMock.catFindMany.mockResolvedValue([
        createCategoryRow({ id: 'kc_001', tags: ['tag1'] }),
        createCategoryRow({ id: 'kc_002', tags: ['tag2'] }),
      ]);
      const result = await service.getCategoriesByTags(testProjectId, ['nonexistent']);
      expect(result).toEqual([]);
    });
  });

  describe('getKnowledgeCategoryAuditLogs', () => {
    it('delegates to audit service', async () => {
      mockAudit.getEntityAuditLogs.mockResolvedValue([{ action: 'create' }]);
      const result = await service.getKnowledgeCategoryAuditLogs('kc_test001', testProjectId);
      expect(mockAudit.getEntityAuditLogs).toHaveBeenCalledWith('knowledge_category', 'kc_test001', testProjectId);
      expect(result).toEqual([{ action: 'create' }]);
    });
  });

  describe('getKnowledgeItemAuditLogs', () => {
    it('delegates to audit service', async () => {
      mockAudit.getEntityAuditLogs.mockResolvedValue([{ action: 'update' }]);
      const result = await service.getKnowledgeItemAuditLogs('ki_test001', testProjectId);
      expect(mockAudit.getEntityAuditLogs).toHaveBeenCalledWith('knowledge_item', 'ki_test001', testProjectId);
      expect(result).toEqual([{ action: 'update' }]);
    });
  });
});
