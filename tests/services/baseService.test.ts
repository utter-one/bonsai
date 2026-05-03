import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestContext } from '../../src/services/RequestContext';
import type { Permission } from '../../src/permissions';
import { PERMISSIONS } from '../../src/permissions';
import { ForbiddenError, ArchivedProjectError } from '../../src/errors';

// Mock the db module before importing BaseService
vi.mock('../../src/db/index', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(),
  },
}));

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { BaseService } from '../../src/services/BaseService';
import { db } from '../../src/db/index';

// Concrete test implementation of BaseService
class TestService extends BaseService {
  public testHasPermission(context: RequestContext | undefined, permission: Permission): boolean {
    return this.hasPermission(context, permission);
  }

  public testRequirePermission(context: RequestContext | undefined, ...permissions: Permission[]): void {
    return this.requirePermission(context, ...permissions);
  }

  public testLogOperation(context: RequestContext | undefined, operation: string, details?: Record<string, any>): void {
    return this.logOperation(context, operation, details);
  }

  public async testRequireProjectNotArchived(projectId: string): Promise<void> {
    return this.requireProjectNotArchived(projectId);
  }

  public async testIsProjectActive(projectId: string): Promise<boolean> {
    return this.isProjectActive(projectId);
  }
}

const createMockContext = (overrides: Partial<RequestContext> = {}): RequestContext => ({
  operatorId: 'op_test123',
  roles: ['content_manager'],
  ip: '127.0.0.1',
  userAgent: 'TestAgent/1.0',
  requestId: 'req-123',
  timestamp: new Date('2025-01-01T00:00:00Z'),
  ...overrides,
});

describe('BaseService', () => {
  let service: TestService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TestService();
  });

  describe('hasPermission', () => {
    it('returns false when context is undefined', () => {
      expect(service.testHasPermission(undefined, PERMISSIONS.PROJECT_READ)).toBe(false);
    });

    it('returns true when user has the permission via role', () => {
      const context = createMockContext({ roles: ['super_admin'] });
      expect(service.testHasPermission(context, PERMISSIONS.PROJECT_READ)).toBe(true);
    });

    it('returns false when user lacks the permission', () => {
      const context = createMockContext({ roles: ['viewer'] });
      expect(service.testHasPermission(context, PERMISSIONS.PROJECT_WRITE)).toBe(false);
    });

    it('correctly resolves role-based permissions', () => {
      const context = createMockContext({ roles: ['developer'] });
      expect(service.testHasPermission(context, PERMISSIONS.AGENT_READ)).toBe(true);
      expect(service.testHasPermission(context, PERMISSIONS.SYSTEM_CONFIG)).toBe(true);
    });

    it('returns false for an unknown role', () => {
      const context = createMockContext({ roles: ['nonexistent_role'] });
      expect(service.testHasPermission(context, PERMISSIONS.PROJECT_READ)).toBe(false);
    });
  });

  describe('requirePermission', () => {
    it('throws ForbiddenError when context is undefined', () => {
      expect(() => service.testRequirePermission(undefined, PERMISSIONS.PROJECT_READ)).toThrow(ForbiddenError);
      expect(() => service.testRequirePermission(undefined, PERMISSIONS.PROJECT_READ)).toThrow('Authentication required');
    });

    it('throws ForbiddenError when user lacks required permissions', () => {
      const context = createMockContext({ roles: ['viewer'] });
      expect(() => service.testRequirePermission(context, PERMISSIONS.PROJECT_WRITE)).toThrow(ForbiddenError);
    });

    it('does not throw when user has the permission', () => {
      const context = createMockContext({ roles: ['super_admin'] });
      expect(() => service.testRequirePermission(context, PERMISSIONS.PROJECT_READ)).not.toThrow();
    });

    it('requires ALL specified permissions', () => {
      const context = createMockContext({ roles: ['content_manager'] });
      // content_manager has project:* but not system:config
      expect(() => service.testRequirePermission(context, PERMISSIONS.PROJECT_READ, PERMISSIONS.SYSTEM_CONFIG)).toThrow(ForbiddenError);
    });

    it('passes when user has all required permissions', () => {
      const context = createMockContext({ roles: ['super_admin'] });
      expect(() => service.testRequirePermission(context, PERMISSIONS.PROJECT_READ, PERMISSIONS.USER_WRITE, PERMISSIONS.AGENT_DELETE)).not.toThrow();
    });

    it('accepts multiple roles and grants if any role has the permission', () => {
      const context = createMockContext({ roles: ['viewer', 'developer'] });
      expect(() => service.testRequirePermission(context, PERMISSIONS.SYSTEM_CONFIG)).not.toThrow();
    });
  });

  describe('logOperation', () => {
    it('does not throw with valid context', () => {
      const context = createMockContext();
      expect(() => service.testLogOperation(context, 'test-operation', { key: 'value' })).not.toThrow();
    });

    it('does not throw with undefined context', () => {
      expect(() => service.testLogOperation(undefined, 'test-operation')).not.toThrow();
    });

    it('does not throw without details', () => {
      const context = createMockContext();
      expect(() => service.testLogOperation(context, 'test-operation')).not.toThrow();
    });
  });

  describe('requireProjectNotArchived', () => {
    it('throws ArchivedProjectError when project is archived', async () => {
      vi.mocked(db.limit).mockResolvedValueOnce([{ id: 'proj-123' }]);

      await expect(service.testRequireProjectNotArchived('proj-123')).rejects.toThrow(ArchivedProjectError);
    });

    it('includes the project id in the error message', async () => {
      vi.mocked(db.limit).mockResolvedValueOnce([{ id: 'proj-abc' }]);

      await expect(service.testRequireProjectNotArchived('proj-abc')).rejects.toThrow(
        'Project proj-abc is archived and cannot be modified'
      );
    });

    it('does not throw when project is not archived', async () => {
      vi.mocked(db.limit).mockResolvedValueOnce([]);

      await expect(service.testRequireProjectNotArchived('proj-active')).resolves.toBeUndefined();
    });

    it('queries the database via the fluent chain', async () => {
      vi.mocked(db.limit).mockResolvedValueOnce([]);

      await service.testRequireProjectNotArchived('proj-456');

      expect(db.select).toHaveBeenCalled();
      expect(db.limit).toHaveBeenCalledWith(1);
    });
  });

  describe('isProjectActive', () => {
    it('returns true when project is in active_projects', async () => {
      vi.mocked(db.limit).mockResolvedValueOnce([{ id: 'proj-active' }]);

      const result = await service.testIsProjectActive('proj-active');
      expect(result).toBe(true);
    });

    it('returns false when project is not in active_projects', async () => {
      vi.mocked(db.limit).mockResolvedValueOnce([]);

      const result = await service.testIsProjectActive('proj-inactive');
      expect(result).toBe(false);
    });
  });
});
