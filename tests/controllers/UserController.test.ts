import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';
import { UnauthorizedError, ForbiddenError } from '../../src/errors';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { UserController } from '../../src/http/controllers/UserController';

const testProjectId = 'proj_test001';
const testUserId = 'user_test001';
const testContext = {
  operatorId: 'oper_test001',
  roles: ['super_admin'],
  ip: '127.0.0.1',
  userAgent: 'test/1.0',
  requestId: 'req_test001',
  timestamp: new Date('2025-01-01T00:00:00Z'),
};

const mockUser = {
  id: testUserId,
  projectId: testProjectId,
  profile: { name: 'Test User' },
  banned: false,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

describe('UserController', () => {
  let controller: UserController;
  let service: any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = {
      createUser: vi.fn(),
      getUserById: vi.fn(),
      listUsers: vi.fn(),
      updateUser: vi.fn(),
      deleteUser: vi.fn(),
      getUserAuditLogs: vi.fn(),
    };
    controller = new UserController(service);
  });

  describe('createUser', () => {
    it('creates a user and returns 201', async () => {
      service.createUser.mockResolvedValue(mockUser);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId },
        body: { profile: { name: 'Test User' } },
      });
      const res = createMockResponse();

      await (controller as any).createUser(req, res);

      expect(service.createUser).toHaveBeenCalledWith(testProjectId, { profile: { name: 'Test User' } }, testContext);
      expect((res as MockResponse).statusCode).toBe(201);
      expect((res as MockResponse).jsonBody).toBe(mockUser);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, body: { profile: {} } });
      const res = createMockResponse();

      await expect((controller as any).createUser(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking USER_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId },
        body: { profile: {} },
      });
      const res = createMockResponse();

      await expect((controller as any).createUser(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getUserById', () => {
    it('returns a user with 200', async () => {
      service.getUserById.mockResolvedValue(mockUser);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testUserId },
      });
      const res = createMockResponse();

      await (controller as any).getUserById(req, res);

      expect(service.getUserById).toHaveBeenCalledWith(testProjectId, testUserId);
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockUser);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId, id: testUserId } });
      const res = createMockResponse();

      await expect((controller as any).getUserById(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('listUsers', () => {
    it('returns paginated users with 200', async () => {
      const mockList = { items: [mockUser], total: 1, offset: 0, limit: 25 };
      service.listUsers.mockResolvedValue(mockList);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId },
        query: {},
      });
      const res = createMockResponse();

      await (controller as any).listUsers(req, res);

      expect(service.listUsers).toHaveBeenCalledWith(testProjectId, expect.any(Object));
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockList);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, query: {} });
      const res = createMockResponse();

      await expect((controller as any).listUsers(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('updateUser', () => {
    it('updates a user and returns 200', async () => {
      const updated = { ...mockUser, profile: { name: 'Updated' } };
      service.updateUser.mockResolvedValue(updated);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testUserId },
        body: { profile: { name: 'Updated' } },
      });
      const res = createMockResponse();

      await (controller as any).updateUser(req, res);

      expect(service.updateUser).toHaveBeenCalledWith(
        testProjectId,
        testUserId,
        expect.objectContaining({ profile: { name: 'Updated' } }),
        testContext,
      );
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws ForbiddenError when lacking USER_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testUserId },
        body: { profile: {} },
      });
      const res = createMockResponse();

      await expect((controller as any).updateUser(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('deleteUser', () => {
    it('deletes a user and returns 204', async () => {
      service.deleteUser.mockResolvedValue(undefined);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testUserId },
      });
      const res = createMockResponse();

      await (controller as any).deleteUser(req, res);

      expect(service.deleteUser).toHaveBeenCalledWith(testProjectId, testUserId, testContext);
      expect((res as MockResponse).statusCode).toBe(204);
      expect((res as MockResponse).sent).toBe(true);
    });

    it('throws ForbiddenError when lacking USER_DELETE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testUserId },
      });
      const res = createMockResponse();

      await expect((controller as any).deleteUser(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getUserAuditLogs', () => {
    it('returns audit logs with 200', async () => {
      const mockLogs = [{ id: 'log1', action: 'create' }];
      service.getUserAuditLogs.mockResolvedValue(mockLogs);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testUserId },
      });
      const res = createMockResponse();

      await (controller as any).getUserAuditLogs(req, res);

      expect(service.getUserAuditLogs).toHaveBeenCalledWith(testUserId, testProjectId);
      expect((res as MockResponse).statusCode).toBe(200);
    });
  });

  describe('registerRoutes', () => {
    it('registers all user routes', () => {
      const mockRouter = { post: vi.fn(), get: vi.fn(), put: vi.fn(), delete: vi.fn() } as any;
      controller.registerRoutes(mockRouter);

      expect(mockRouter.post).toHaveBeenCalledTimes(1);
      expect(mockRouter.get).toHaveBeenCalledTimes(3);
      expect(mockRouter.put).toHaveBeenCalledTimes(1);
      expect(mockRouter.delete).toHaveBeenCalledTimes(1);
    });
  });
});
