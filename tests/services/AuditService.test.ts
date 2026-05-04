import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/db/index', () => {
  const findMany = vi.fn().mockResolvedValue([]);
  const insertReturning = vi.fn().mockResolvedValue([]);

  const auditLogsTable = {
    findMany,
  };

  return {
    db: {
      query: { auditLogs: auditLogsTable },
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: insertReturning,
        }),
      }),
    },
    __mocks: { findMany, insertReturning },
  };
});

vi.mock('../../src/utils/idGenerator', () => ({
  generateId: vi.fn().mockReturnValue('audit_test123'),
  ID_PREFIXES: { AUDIT: 'audit' },
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

vi.mock('../../src/utils/textSearch', () => ({
  parseTextSearch: vi.fn((v: string) => ({ type: 'text', value: v })),
  buildTextSearchCondition: vi.fn(() => null),
}));

import { AuditService } from '../../src/services/AuditService';
import { __mocks as dbMock } from '../../src/db/index';

describe('AuditService', () => {
  let service: AuditService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AuditService();
    dbMock.findMany.mockResolvedValue([]);
    dbMock.insertReturning.mockResolvedValue([{
      id: 'audit_test123',
      userId: 'op_test123',
      action: 'CREATE',
      entityType: 'test_entity',
      entityId: 'entity_test123',
      projectId: 'proj_test123',
      oldEntity: null,
      newEntity: { id: 'entity_test123', name: 'Test Entity' },
      createdAt: new Date(),
    }]);
  });

  describe('logCreate', () => {
    it('logs entity creation with all fields', async () => {
      const result = await service.logCreate('test_entity', 'entity_test123', { id: 'entity_test123', name: 'Test Entity', projectId: 'proj_test123' }, 'op_test123');
      expect(result).toBeDefined();
      expect(result.id).toBe('audit_test123');
    });

    it('logs entity creation without userId', async () => {
      const result = await service.logCreate('test_entity', 'entity_test123', { id: 'entity_test123', projectId: 'proj_test123' });
      expect(result).toBeDefined();
    });

    it('logs entity creation with explicit projectId override', async () => {
      const result = await service.logCreate('test_entity', 'entity_test123', { id: 'entity_test123', projectId: 'proj_original' }, 'op_test123', 'proj_override');
      expect(result).toBeDefined();
    });

    it('extracts projectId from entity when not explicitly provided', async () => {
      const result = await service.logCreate('test_entity', 'entity_test123', { id: 'entity_test123', projectId: 'proj_from_entity' }, 'op_test123');
      expect(result).toBeDefined();
    });
  });

  describe('logUpdate', () => {
    it('logs entity update with old and new entity data', async () => {
      const oldEntity = { id: 'entity_test123', name: 'Old Name', projectId: 'proj_test123' };
      const newEntity = { id: 'entity_test123', name: 'New Name', projectId: 'proj_test123' };
      const result = await service.logUpdate('test_entity', 'entity_test123', oldEntity, newEntity, 'op_test123');
      expect(result).toBeDefined();
      expect(result.id).toBe('audit_test123');
    });

    it('logs entity update without userId', async () => {
      const result = await service.logUpdate('test_entity', 'entity_test123', { id: 'entity_test123' }, { id: 'entity_test123', name: 'Updated' });
      expect(result).toBeDefined();
    });

    it('logs entity update with explicit projectId override', async () => {
      const result = await service.logUpdate('test_entity', 'entity_test123', { id: 'entity_test123' }, { id: 'entity_test123' }, 'op_test123', 'proj_override');
      expect(result).toBeDefined();
    });

    it('extracts projectId from new entity when not explicitly provided', async () => {
      const result = await service.logUpdate('test_entity', 'entity_test123', { id: 'entity_test123' }, { id: 'entity_test123', projectId: 'proj_new' }, 'op_test123');
      expect(result).toBeDefined();
    });

    it('falls back to old entity projectId when new entity lacks it', async () => {
      const result = await service.logUpdate('test_entity', 'entity_test123', { id: 'entity_test123', projectId: 'proj_old' }, { id: 'entity_test123' }, 'op_test123');
      expect(result).toBeDefined();
    });
  });

  describe('logDelete', () => {
    it('logs entity deletion with old entity data', async () => {
      const oldEntity = { id: 'entity_test123', name: 'Deleted Entity', projectId: 'proj_test123' };
      const result = await service.logDelete('test_entity', 'entity_test123', oldEntity, 'op_test123');
      expect(result).toBeDefined();
      expect(result.id).toBe('audit_test123');
    });

    it('logs entity deletion without userId', async () => {
      const result = await service.logDelete('test_entity', 'entity_test123', { id: 'entity_test123' });
      expect(result).toBeDefined();
    });

    it('logs entity deletion with explicit projectId override', async () => {
      const result = await service.logDelete('test_entity', 'entity_test123', { id: 'entity_test123' }, 'op_test123', 'proj_override');
      expect(result).toBeDefined();
    });

    it('extracts projectId from old entity when not explicitly provided', async () => {
      const result = await service.logDelete('test_entity', 'entity_test123', { id: 'entity_test123', projectId: 'proj_from_entity' }, 'op_test123');
      expect(result).toBeDefined();
    });
  });

  describe('logChange', () => {
    it('logs a custom change action', async () => {
      const result = await service.logChange({
        userId: 'op_test123',
        action: 'CUSTOM_ACTION',
        entityType: 'test_entity',
        entityId: 'entity_test123',
        projectId: 'proj_test123',
        oldEntity: { status: 'active' },
        newEntity: { status: 'inactive' },
      });
      expect(result).toBeDefined();
      expect(result.id).toBe('audit_test123');
    });

    it('logs a change without optional fields', async () => {
      const result = await service.logChange({
        action: 'CUSTOM_ACTION',
        entityType: 'test_entity',
        entityId: 'entity_test123',
      });
      expect(result).toBeDefined();
    });
  });

  describe('getEntityAuditLogs', () => {
    it('returns audit logs for a specific entity with projectId', async () => {
      const mockLogs = [
        { id: 'audit_1', action: 'CREATE', entityType: 'test_entity', entityId: 'entity_test123', projectId: 'proj_test123', createdAt: new Date() },
        { id: 'audit_2', action: 'UPDATE', entityType: 'test_entity', entityId: 'entity_test123', projectId: 'proj_test123', createdAt: new Date() },
      ];
      dbMock.findMany.mockResolvedValue(mockLogs);
      
      const result = await service.getEntityAuditLogs('test_entity', 'entity_test123', 'proj_test123');
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('audit_1');
    });

    it('returns audit logs for a specific entity without projectId', async () => {
      const mockLogs = [
        { id: 'audit_1', action: 'CREATE', entityType: 'test_entity', entityId: 'entity_test123', createdAt: new Date() },
      ];
      dbMock.findMany.mockResolvedValue(mockLogs);
      
      const result = await service.getEntityAuditLogs('test_entity', 'entity_test123');
      expect(result).toHaveLength(1);
    });

    it('returns empty array when no logs exist', async () => {
      const result = await service.getEntityAuditLogs('nonexistent_entity', 'entity_nonexistent');
      expect(result).toEqual([]);
    });
  });

  describe('getUserAuditLogs', () => {
    it('returns audit logs for a specific user with default limit', async () => {
      const mockLogs = [
        { id: 'audit_1', userId: 'op_test123', action: 'CREATE', createdAt: new Date() },
        { id: 'audit_2', userId: 'op_test123', action: 'UPDATE', createdAt: new Date() },
      ];
      dbMock.findMany.mockResolvedValue(mockLogs);
      
      const result = await service.getUserAuditLogs('op_test123');
      expect(result).toHaveLength(2);
    });

    it('returns audit logs for a specific user with custom limit', async () => {
      const mockLogs = [
        { id: 'audit_1', userId: 'op_test123', action: 'CREATE', createdAt: new Date() },
      ];
      dbMock.findMany.mockResolvedValue(mockLogs);
      
      const result = await service.getUserAuditLogs('op_test123', 50);
      expect(result).toHaveLength(1);
    });

    it('returns empty array when user has no logs', async () => {
      const result = await service.getUserAuditLogs('nonexistent_user');
      expect(result).toEqual([]);
    });
  });

  describe('listAuditLogs', () => {
    it('returns paginated audit logs with default parameters', async () => {
      const result = await service.listAuditLogs();
      expect(result).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
      expect(typeof result.total).toBe('number');
      expect(typeof result.offset).toBe('number');
    });

    it('respects limit and offset parameters', async () => {
      await service.listAuditLogs({ limit: 10, offset: 20 });
      expect(dbMock.findMany).toHaveBeenCalled();
    });

    it('applies filters when provided', async () => {
      await service.listAuditLogs({ filters: { action: { eq: 'CREATE' } } });
      expect(dbMock.findMany).toHaveBeenCalled();
    });

    it('applies text search when provided', async () => {
      await service.listAuditLogs({ textSearch: 'test_entity' });
      expect(dbMock.findMany).toHaveBeenCalled();
    });

    it('applies orderBy when provided', async () => {
      await service.listAuditLogs({ orderBy: [{ field: 'createdAt', direction: 'asc' }] });
      expect(dbMock.findMany).toHaveBeenCalled();
    });
  });
});
