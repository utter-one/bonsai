import { describe, vi, beforeEach } from 'vitest';
import type { RequestContext } from '../../src/services/RequestContext';
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
      query: { guardrails: { findFirst, findMany } },
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

import { GuardrailService } from '../../src/services/GuardrailService';
import { __mocks as dbMock } from '../../src/db/index';

const mockAuditService = {
  logCreate: vi.fn().mockResolvedValue(undefined),
  logUpdate: vi.fn().mockResolvedValue(undefined),
  logDelete: vi.fn().mockResolvedValue(undefined),
  getEntityAuditLogs: vi.fn().mockResolvedValue([]),
};

const projectId = 'proj-test123';
const guardrailId = 'grl_test001';

const createGuardrailRow = (id: string, overrides: Record<string, any> = {}) => ({
  id, projectId, name: 'Test Guardrail', condition: null, classificationTrigger: null,
  effects: [], examples: null, tags: [], metadata: null, version: 1,
  createdAt: new Date('2025-01-01T00:00:00Z'), updatedAt: new Date('2025-01-01T00:00:00Z'),
  ...overrides,
});

const createPayload = () => ({ id: guardrailId, name: 'Test Guardrail', effects: [] });

const resetMocks = () => {
  dbMock.findFirst.mockResolvedValue(createGuardrailRow(guardrailId));
  dbMock.findMany.mockResolvedValue([]);
  dbMock.updateReturning.mockResolvedValue([createGuardrailRow(guardrailId, { version: 2 })]);
  dbMock.deleteReturning.mockResolvedValue([createGuardrailRow(guardrailId)]);
  dbMock.selectLimit.mockResolvedValue([]);
  dbMock.countResult.mockResolvedValue([{ count: 0 }]);
};

beforeEach(() => {
  vi.clearAllMocks();
  resetMocks();
});

createCrudTests({
  entityName: 'guardrail',
  permissions: { write: PERMISSIONS.GUARDRAIL_WRITE, delete: PERMISSIONS.GUARDRAIL_DELETE },
  hasVersion: true,
  hasClone: true,
  projectId,
  createPayload,
  createEntityRow: createGuardrailRow,
  resetMocks,
  mockNotFound: () => dbMock.findFirst.mockResolvedValue(undefined),
  mockVersionMismatch: () => dbMock.findFirst.mockResolvedValue(createGuardrailRow(guardrailId, { version: 5 })),
  createService: () => ({ service: new GuardrailService(mockAuditService as any) }),
});
