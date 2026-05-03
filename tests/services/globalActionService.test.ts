import { describe, vi, beforeEach } from 'vitest';
import { createCrudTests } from '../helpers/crudServiceTest';
import { PERMISSIONS } from '../../src/permissions';

vi.mock('../../src/db/index', () => {
  const findFirst = vi.fn().mockResolvedValue({});
  const findMany = vi.fn().mockResolvedValue([]);
  const updateReturning = vi.fn().mockResolvedValue([]);
  const deleteReturning = vi.fn().mockResolvedValue([]);
  const selectLimit = vi.fn().mockResolvedValue([]);
  const countResult = vi.fn().mockResolvedValue([{ count: 0 }]);

  return {
    db: {
      query: { globalActions: { findFirst, findMany } },
      insert: () => ({
        values: (vals: Record<string, any>) => ({
          returning: () => Promise.resolve([{ ...vals, version: vals.version ?? 1, createdAt: vals.createdAt ?? new Date(), updatedAt: vals.updatedAt ?? new Date() }]),
        }),
      }),
      update: () => ({ set: () => ({ where: () => ({ returning: updateReturning }) }) }),
      delete: () => ({ where: () => ({ returning: deleteReturning }) }),
      select: () => ({
        from: () => ({
          where: () => {
            const chain = { limit: (n: number) => (n === 1 ? selectLimit(n) : countResult()) };
            (chain as any).then = (onfulfilled: any) => countResult().then(onfulfilled);
            return chain;
          },
        }),
      }),
    },
    __mocks: { findFirst, findMany, updateReturning, deleteReturning, selectLimit, countResult },
  };
});

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GlobalActionService } from '../../src/services/GlobalActionService';
import { __mocks as dbMock } from '../../src/db/index';

const mockAuditService = {
  logCreate: vi.fn().mockResolvedValue(undefined),
  logUpdate: vi.fn().mockResolvedValue(undefined),
  logDelete: vi.fn().mockResolvedValue(undefined),
  getEntityAuditLogs: vi.fn().mockResolvedValue([]),
};

const projectId = 'proj-test123';
const actionId = 'gac_test001';

const createActionRow = (id: string, overrides: Record<string, any> = {}) => ({
  id, projectId, name: 'Test Action', condition: null, triggerOnUserInput: true,
  triggerOnClientCommand: false, classificationTrigger: null, overrideClassifierId: null,
  parameters: [], effects: [], examples: null, tags: [], metadata: null, version: 1,
  createdAt: new Date('2025-01-01T00:00:00Z'), updatedAt: new Date('2025-01-01T00:00:00Z'),
  ...overrides,
});

const createPayload = () => ({ id: actionId, name: 'Test Action', triggerOnUserInput: true });

const resetMocks = () => {
  dbMock.findFirst.mockResolvedValue(createActionRow(actionId));
  dbMock.findMany.mockResolvedValue([]);
  dbMock.updateReturning.mockResolvedValue([createActionRow(actionId, { version: 2 })]);
  dbMock.deleteReturning.mockResolvedValue([createActionRow(actionId)]);
  dbMock.selectLimit.mockResolvedValue([]);
  dbMock.countResult.mockResolvedValue([{ count: 0 }]);
};

beforeEach(() => { vi.clearAllMocks(); resetMocks(); });

createCrudTests({
  entityName: 'globalAction',
  permissions: { write: PERMISSIONS.GLOBAL_ACTION_WRITE, delete: PERMISSIONS.GLOBAL_ACTION_DELETE },
  hasVersion: true,
  hasClone: true,
  projectId,
  createPayload,
  createEntityRow: createActionRow,
  resetMocks,
  mockNotFound: () => dbMock.findFirst.mockResolvedValue(undefined),
  mockVersionMismatch: () => dbMock.findFirst.mockResolvedValue(createActionRow(actionId, { version: 5 })),
  createService: () => ({ service: new GlobalActionService(mockAuditService as any) }),
});
