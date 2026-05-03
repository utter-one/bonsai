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
      query: { agents: { findFirst, findMany } },
      insert: () => ({
        values: (vals: Record<string, any>) => ({
          returning: () => {
            // Convert undefined to null (simulates DB behavior)
            const row: Record<string, any> = {};
            for (const [k, v] of Object.entries(vals)) {
              row[k] = v === undefined ? null : v;
            }
            return Promise.resolve([{ ...row, version: row.version ?? 1, createdAt: row.createdAt ?? new Date(), updatedAt: row.updatedAt ?? new Date() }]);
          },
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

import { AgentService } from '../../src/services/AgentService';
import { __mocks as dbMock } from '../../src/db/index';

const mockAuditService = {
  logCreate: vi.fn().mockResolvedValue(undefined),
  logUpdate: vi.fn().mockResolvedValue(undefined),
  logDelete: vi.fn().mockResolvedValue(undefined),
  getEntityAuditLogs: vi.fn().mockResolvedValue([]),
};

const projectId = 'proj-test123';
const agentId = 'age_test001';

const createAgentRow = (id: string, overrides: Record<string, any> = {}) => ({
  id, projectId, name: 'Test Agent', description: null, prompt: 'You are helpful',
  ttsProviderId: null, ttsSettings: null, fillerSettings: null, tags: [], metadata: null, version: 1,
  createdAt: new Date('2025-01-01T00:00:00Z'), updatedAt: new Date('2025-01-01T00:00:00Z'),
  ...overrides,
});

const createPayload = () => ({
  id: agentId, name: 'Test Agent', prompt: 'You are helpful',
  ttsProviderId: null, ttsSettings: null, fillerSettings: null, tags: [], metadata: null,
});

const resetMocks = () => {
  dbMock.findFirst.mockResolvedValue(createAgentRow(agentId));
  dbMock.findMany.mockResolvedValue([]);
  dbMock.updateReturning.mockResolvedValue([createAgentRow(agentId, { version: 2 })]);
  dbMock.deleteReturning.mockResolvedValue([createAgentRow(agentId)]);
  dbMock.selectLimit.mockResolvedValue([]);
  dbMock.countResult.mockResolvedValue([{ count: 0 }]);
};

beforeEach(() => { vi.clearAllMocks(); resetMocks(); });

createCrudTests({
  entityName: 'agent',
  permissions: { write: PERMISSIONS.AGENT_WRITE, delete: PERMISSIONS.AGENT_DELETE },
  hasVersion: true,
  hasClone: true,
  projectId,
  createPayload,
  createEntityRow: createAgentRow,
  resetMocks,
  mockNotFound: () => dbMock.findFirst.mockResolvedValue(undefined),
  mockVersionMismatch: () => dbMock.findFirst.mockResolvedValue(createAgentRow(agentId, { version: 5 })),
  createService: () => ({ service: new AgentService(mockAuditService as any) }),
});
