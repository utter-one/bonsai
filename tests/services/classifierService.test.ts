import { describe, vi, beforeEach } from 'vitest';
import type { RequestContext } from '../../src/services/RequestContext';
import { createCrudTests } from '../helpers/crudServiceTest';
import { PERMISSIONS } from '../../src/permissions';

vi.mock('../../src/db/index', () => {
  const findFirst = vi.fn().mockResolvedValue({});
  const findMany = vi.fn().mockResolvedValue([]);
  /** Captures the last values passed to insert.values() for returning */
  let lastInsertedValues: Record<string, any> = {};
  const updateReturning = vi.fn().mockResolvedValue([]);
  const deleteReturning = vi.fn().mockResolvedValue([]);
  const selectLimit = vi.fn().mockResolvedValue([]);
  const countResult = vi.fn().mockResolvedValue([{ count: 0 }]);

  return {
    db: {
      query: { classifiers: { findFirst, findMany } },
      insert: () => ({
        values: (vals: Record<string, any>) => {
          lastInsertedValues = vals;
          return {
            returning: () => Promise.resolve([{ ...vals, version: vals.version ?? 1, createdAt: vals.createdAt ?? new Date(), updatedAt: vals.updatedAt ?? new Date() }]),
          };
        },
      }),
      update: () => ({ set: () => ({ where: () => ({ returning: updateReturning }) }) }),
      delete: () => ({ where: () => ({ returning: deleteReturning }) }),
      select: () => ({
        from: () => ({
          where: () => {
            const chain = {
              limit: (n: number) => (n === 1 ? selectLimit(n) : countResult()),
            };
            // Make awaitable for countRows which doesn't call .limit()
            (chain as any).then = (onfulfilled: any) => countResult().then(onfulfilled);
            return chain;
          },
        }),
      }),
    },
    __mocks: { findFirst, findMany, lastInsertedValues, updateReturning, deleteReturning, selectLimit, countResult },
  };
});

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { ClassifierService } from '../../src/services/ClassifierService';
import { __mocks as dbMock } from '../../src/db/index';

const mockAuditService = {
  logCreate: vi.fn().mockResolvedValue(undefined),
  logUpdate: vi.fn().mockResolvedValue(undefined),
  logDelete: vi.fn().mockResolvedValue(undefined),
  getEntityAuditLogs: vi.fn().mockResolvedValue([]),
};

const projectId = 'proj-test123';
const classifierId = 'cls_test001';

const createClassifierRow = (id: string, overrides: Record<string, any> = {}) => ({
  id, projectId, name: 'Test Classifier', description: null, prompt: 'Classify this input',
  llmProviderId: null, llmSettings: null, tags: [], metadata: null, version: 1,
  createdAt: new Date('2025-01-01T00:00:00Z'), updatedAt: new Date('2025-01-01T00:00:00Z'),
  ...overrides,
});

const createPayload = () => ({ id: classifierId, name: 'Test Classifier', prompt: 'Classify this input' });

const resetMocks = () => {
  dbMock.findFirst.mockResolvedValue(createClassifierRow(classifierId));
  dbMock.findMany.mockResolvedValue([]);
  // insert auto-returns values passed to .values() - no manual config needed
  dbMock.updateReturning.mockResolvedValue([createClassifierRow(classifierId, { version: 2 })]);
  dbMock.deleteReturning.mockResolvedValue([createClassifierRow(classifierId)]);
  dbMock.selectLimit.mockResolvedValue([]);
  dbMock.countResult.mockResolvedValue([{ count: 0 }]);
};

const mockNotFound = () => {
  dbMock.findFirst.mockResolvedValue(undefined);
};

const mockVersionMismatch = () => {
  dbMock.findFirst.mockResolvedValue(createClassifierRow(classifierId, { version: 5 }));
};

beforeEach(() => {
  vi.clearAllMocks();
  resetMocks();
});

createCrudTests({
  entityName: 'classifier',
  tableName: 'classifiers',
  permissions: { write: PERMISSIONS.CLASSIFIER_WRITE, delete: PERMISSIONS.CLASSIFIER_DELETE },
  hasVersion: true,
  hasClone: true,
  projectId,
  createPayload,
  createEntityRow: createClassifierRow,
  resetMocks,
  mockNotFound,
  mockVersionMismatch,
  createService: () => ({ service: new ClassifierService(mockAuditService as any) }),
});

describe('ClassifierService specific behavior', () => {
  let service: ClassifierService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ClassifierService(mockAuditService as any);
    resetMocks();
  });

  it('auto-generates ID when not provided', async () => {
    const payload = createPayload();
    delete (payload as any).id;
    // insert auto-returns values, including the auto-generated ID
    const ctx: RequestContext = { operatorId: 'op_test', roles: ['super_admin'], ip: '127.0.0.1', userAgent: 'test', requestId: 'req-1', timestamp: new Date() };
    const result = await service.createClassifier(projectId, payload, ctx);
    expect(result.id).toMatch(/^clas_/);
  });

  it('logs audit entry on create', async () => {
    const ctx: RequestContext = { operatorId: 'op_test', roles: ['super_admin'], ip: '127.0.0.1', userAgent: 'test', requestId: 'req-1', timestamp: new Date() };
    await service.createClassifier(projectId, createPayload(), ctx);
    expect(mockAuditService.logCreate).toHaveBeenCalledWith('classifier', classifierId, expect.any(Object), 'op_test');
  });

  it('attaches archived=true when project is not active', async () => {
    dbMock.selectLimit.mockResolvedValue([]);
    const result = await service.getClassifierById(projectId, classifierId);
    expect(result.archived).toBe(true);
  });

  it('attaches archived=false when project is active', async () => {
    dbMock.selectLimit.mockResolvedValue([{ id: projectId }]);
    const result = await service.getClassifierById(projectId, classifierId);
    expect(result.archived).toBe(false);
  });

  it('throws NotFoundError when entity does not exist', async () => {
    mockNotFound();
    await expect(service.getClassifierById(projectId, classifierId)).rejects.toThrow('not found');
  });

  it('handles version mismatch on update', async () => {
    mockVersionMismatch();
    const ctx: RequestContext = { operatorId: 'op_test', roles: ['super_admin'], ip: '127.0.0.1', userAgent: 'test', requestId: 'req-1', timestamp: new Date() };
    await expect(service.updateClassifier(projectId, classifierId, { ...createPayload(), version: 1 }, ctx)).rejects.toThrow('version mismatch');
  });
});
