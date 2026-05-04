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
  let lastInsertedValues: Record<string, any> = {};
  const updateReturning = vi.fn().mockResolvedValue([]);
  const deleteReturning = vi.fn().mockResolvedValue([]);

  const selectMock = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
  });

  const insertMock = vi.fn().mockReturnValue({
    values: vi.fn().mockImplementation((v) => {
      lastInsertedValues = v;
      return {
        returning: vi.fn().mockResolvedValue([{
          ...v,
          id: 1,
          stage: v.stage ?? null,
          conversationId: v.conversationId ?? null,
          eventIndex: v.eventIndex ?? null,
          userId: v.userId ?? null,
          comments: v.comments ?? '',
          createdAt: new Date(),
          updatedAt: new Date(),
        }]),
      };
    }),
  });

  const updateMock = vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: updateReturning,
      }),
    }),
  });

  const deleteMock = vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({
      returning: deleteReturning,
    }),
  });

  const issuesTable = {
    findFirst,
    findMany,
    insert: insertMock,
    update: updateMock,
    delete: deleteMock,
  };

  return {
    db: {
      query: { issues: issuesTable },
      insert: insertMock,
      select: selectMock,
      update: updateMock,
      delete: deleteMock,
    },
    __mocks: { findFirst, findMany, updateReturning, deleteReturning, lastInsertedValues },
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

import { IssueService } from '../../src/services/IssueService';
import { db, __mocks as dbMock } from '../../src/db/index';
import type { CreateIssueRequest } from '../../src/http/contracts/issue';

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

function createIssuePayload(): CreateIssueRequest {
  return {
    projectId: '__test_project__',
    environment: 'production',
    buildVersion: '1.0.0',
    severity: 'high',
    category: 'bug',
    bugDescription: 'Something broke',
    expectedBehaviour: 'Should not break',
    status: 'open',
  };
}

function createIssueRow(overrides?: Record<string, any>) {
  return {
    id: 1,
    projectId: '__test_project__',
    environment: 'production',
    buildVersion: '1.0.0',
    stage: null,
    conversationId: null,
    eventIndex: null,
    userId: null,
    severity: 'high',
    category: 'bug',
    bugDescription: 'Something broke',
    expectedBehaviour: 'Should not break',
    comments: '',
    status: 'open',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('IssueService', () => {
  let service: IssueService;

  beforeEach(() => {
    vi.clearAllMocks();
    const mockAudit = {
      logCreate: vi.fn().mockResolvedValue(undefined),
      logUpdate: vi.fn().mockResolvedValue(undefined),
      logDelete: vi.fn().mockResolvedValue(undefined),
      getEntityAuditLogs: vi.fn().mockResolvedValue([]),
    };
    service = new IssueService(mockAudit as any);
    dbMock.findFirst.mockResolvedValue(createIssueRow());
    dbMock.updateReturning.mockResolvedValue([createIssueRow()]);
    dbMock.deleteReturning.mockResolvedValue([createIssueRow()]);
  });

  describe('createIssue', () => {
    it('creates the issue and returns it', async () => {
      const payload = createIssuePayload();
      const result = await service.createIssue(payload, defaultContext);
      expect(result).toBeDefined();
      expect(result.projectId).toBe(payload.projectId);
      expect(result.environment).toBe(payload.environment);
    });

    it('throws ForbiddenError when user lacks write permission', async () => {
      await expect(service.createIssue(createIssuePayload(), deniedContext)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getIssueById', () => {
    it('returns the issue when found', async () => {
      const result = await service.getIssueById(1);
      expect(result).toBeDefined();
      expect(result.id).toBe(1);
    });

    it('throws NotFoundError when issue does not exist', async () => {
      dbMock.findFirst.mockResolvedValue(undefined);
      await expect(service.getIssueById(999)).rejects.toThrow(NotFoundError);
    });
  });

  describe('listIssues', () => {
    it('returns paginated results with total count', async () => {
      const result = await service.listIssues();
      expect(result).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
      expect(typeof result.total).toBe('number');
      expect(typeof result.offset).toBe('number');
      expect(typeof result.limit).toBe('number');
    });

    it('respects limit and offset parameters', async () => {
      const result = await service.listIssues({ limit: 5, offset: 0 });
      expect(result.limit).toBe(5);
      expect(result.offset).toBe(0);
    });
  });

  describe('updateIssue', () => {
    it('updates the issue and returns the new state', async () => {
      const result = await service.updateIssue(1, { status: 'resolved' }, defaultContext);
      expect(result).toBeDefined();
      expect(result.id).toBe(1);
    });

    it('throws ForbiddenError when user lacks write permission', async () => {
      await expect(service.updateIssue(1, { status: 'resolved' }, deniedContext)).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when issue does not exist', async () => {
      dbMock.findFirst.mockResolvedValue(undefined);
      await expect(service.updateIssue(999, { status: 'resolved' }, defaultContext)).rejects.toThrow(NotFoundError);
    });
  });

  describe('deleteIssue', () => {
    it('deletes the issue successfully', async () => {
      await expect(service.deleteIssue(1, defaultContext)).resolves.toBeUndefined();
    });

    it('throws ForbiddenError when user lacks delete permission', async () => {
      await expect(service.deleteIssue(1, deniedContext)).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when issue does not exist', async () => {
      dbMock.findFirst.mockResolvedValue(undefined);
      await expect(service.deleteIssue(999, defaultContext)).rejects.toThrow(NotFoundError);
    });
  });

  describe('getIssueAuditLogs', () => {
    it('returns audit logs for an issue', async () => {
      const result = await service.getIssueAuditLogs(1);
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
