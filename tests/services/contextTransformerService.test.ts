import { describe, vi, beforeEach } from 'vitest';
import type { RequestContext } from '../../src/services/RequestContext';
import { createCrudTests } from '../helpers/crudServiceTest';
import { PERMISSIONS } from '../../src/permissions';

vi.mock('../../src/db/index', () => {
  const findFirst = vi.fn().mockResolvedValue({});
  const findMany = vi.fn().mockResolvedValue([]);
  let lastInsertedValues: Record<string, any> = {};
  const updateReturning = vi.fn().mockResolvedValue([]);
  const deleteReturning = vi.fn().mockResolvedValue([]);
  const selectLimit = vi.fn().mockResolvedValue([]);
  const countResult = vi.fn().mockResolvedValue([{ count: 0 }]);

  return {
    db: {
      query: { contextTransformers: { findFirst, findMany } },
      insert: () => ({
        values: (vals: Record<string, any>) => {
          lastInsertedValues = vals;
          const row: Record<string, any> = {};
          for (const [k, v] of Object.entries(vals)) {
            row[k] = v === undefined ? null : v;
          }
          return {
            returning: () => Promise.resolve([{ ...row, version: row.version ?? 1, createdAt: row.createdAt ?? new Date(), updatedAt: row.updatedAt ?? new Date() }]),
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

import { ContextTransformerService } from '../../src/services/ContextTransformerService';
import { __mocks as dbMock } from '../../src/db/index';

const mockAuditService = {
  logCreate: vi.fn().mockResolvedValue(undefined),
  logUpdate: vi.fn().mockResolvedValue(undefined),
  logDelete: vi.fn().mockResolvedValue(undefined),
  getEntityAuditLogs: vi.fn().mockResolvedValue([]),
};

const projectId = 'proj-test123';
const transformerId = 'tran_test001';

const createTransformerRow = (id: string, overrides: Record<string, any> = {}) => ({
  id, projectId, name: 'Test Transformer', prompt: 'Transform this', description: null,
  contextFields: [], llmProviderId: 'prov-openai', llmSettings: { model: 'gpt-4' },
  tags: [], metadata: null, version: 1,
  createdAt: new Date('2025-01-01T00:00:00Z'), updatedAt: new Date('2025-01-01T00:00:00Z'),
  ...overrides,
});

const createPayload = () => ({
  id: transformerId,
  name: 'Test Transformer',
  prompt: 'Transform this',
  llmProviderId: 'prov-openai',
  llmSettings: { model: 'gpt-4' },
});

const resetMocks = () => {
  dbMock.findFirst.mockResolvedValue(createTransformerRow(transformerId));
  dbMock.findMany.mockResolvedValue([]);
  dbMock.updateReturning.mockResolvedValue([createTransformerRow(transformerId, { version: 2 })]);
  dbMock.deleteReturning.mockResolvedValue([createTransformerRow(transformerId)]);
  dbMock.selectLimit.mockResolvedValue([]);
  dbMock.countResult.mockResolvedValue([{ count: 0 }]);
};

const mockNotFound = () => {
  dbMock.findFirst.mockResolvedValue(undefined);
};

const mockVersionMismatch = () => {
  dbMock.findFirst.mockResolvedValue(createTransformerRow(transformerId, { version: 5 }));
};

beforeEach(() => {
  vi.clearAllMocks();
  resetMocks();
});

createCrudTests({
  entityName: 'contextTransformer',
  permissions: { write: PERMISSIONS.CONTEXT_TRANSFORMER_WRITE, delete: PERMISSIONS.CONTEXT_TRANSFORMER_DELETE },
  hasVersion: true,
  hasClone: true,
  projectId,
  createPayload,
  createEntityRow: createTransformerRow,
  resetMocks,
  mockNotFound,
  mockVersionMismatch,
  createService: () => ({ service: new ContextTransformerService(mockAuditService as any) }),
});

describe('ContextTransformerService specific behavior', () => {
  let service: ContextTransformerService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ContextTransformerService(mockAuditService as any);
    resetMocks();
  });

  it('auto-generates ID when not provided', async () => {
    const payload = createPayload();
    delete (payload as any).id;
    const ctx: RequestContext = { operatorId: 'op_test', roles: ['super_admin'], ip: '127.0.0.1', userAgent: 'test', requestId: 'req-1', timestamp: new Date() };
    const result = await service.createContextTransformer(projectId, payload, ctx);
    expect(result.id).toMatch(/^tran_/);
  });

  it('logs audit entry on create', async () => {
    const ctx: RequestContext = { operatorId: 'op_test', roles: ['super_admin'], ip: '127.0.0.1', userAgent: 'test', requestId: 'req-1', timestamp: new Date() };
    await service.createContextTransformer(projectId, createPayload(), ctx);
    expect(mockAuditService.logCreate).toHaveBeenCalledWith('context_transformer', transformerId, expect.any(Object), 'op_test');
  });

  it('attaches archived=true when project is not active', async () => {
    dbMock.selectLimit.mockResolvedValue([]);
    const result = await service.getContextTransformerById(projectId, transformerId);
    expect(result.archived).toBe(true);
  });

  it('attaches archived=false when project is active', async () => {
    dbMock.selectLimit.mockResolvedValue([{ id: projectId }]);
    const result = await service.getContextTransformerById(projectId, transformerId);
    expect(result.archived).toBe(false);
  });

  it('throws NotFoundError when entity does not exist', async () => {
    mockNotFound();
    await expect(service.getContextTransformerById(projectId, transformerId)).rejects.toThrow('not found');
  });

  it('handles version mismatch on update', async () => {
    mockVersionMismatch();
    const ctx: RequestContext = { operatorId: 'op_test', roles: ['super_admin'], ip: '127.0.0.1', userAgent: 'test', requestId: 'req-1', timestamp: new Date() };
    await expect(service.updateContextTransformer(projectId, transformerId, { ...createPayload(), version: 1 }, ctx)).rejects.toThrow('version mismatch');
  });
});
