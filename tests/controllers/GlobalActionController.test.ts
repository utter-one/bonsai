import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';
import { UnauthorizedError, ForbiddenError } from '../../src/errors';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GlobalActionController } from '../../src/http/controllers/GlobalActionController';

const testProjectId = 'proj_test001';
const testActionId = 'globalact_test001';
const testContext = {
  operatorId: 'oper_test001',
  roles: ['super_admin'],
  ip: '127.0.0.1',
  userAgent: 'test/1.0',
  requestId: 'req_test001',
  timestamp: new Date('2025-01-01T00:00:00Z'),
};

const mockAction = {
  id: testActionId,
  projectId: testProjectId,
  name: 'Test Global Action',
  version: 1,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

describe('GlobalActionController', () => {
  let controller: GlobalActionController;
  let service: any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = {
      createGlobalAction: vi.fn(),
      getGlobalActionById: vi.fn(),
      listGlobalActions: vi.fn(),
      updateGlobalAction: vi.fn(),
      deleteGlobalAction: vi.fn(),
      getGlobalActionAuditLogs: vi.fn(),
      cloneGlobalAction: vi.fn(),
    };
    controller = new GlobalActionController(service);
  });

  describe('createGlobalAction', () => {
    it('creates a global action and returns 201', async () => {
      service.createGlobalAction.mockResolvedValue(mockAction);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId },
        body: { name: 'Test Global Action' },
      });
      const res = createMockResponse();

      await (controller as any).createGlobalAction(req, res);

      expect(service.createGlobalAction).toHaveBeenCalledWith(testProjectId, expect.objectContaining({ name: 'Test Global Action' }), testContext);
      expect((res as MockResponse).statusCode).toBe(201);
      expect((res as MockResponse).jsonBody).toBe(mockAction);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, body: {} });
      const res = createMockResponse();

      await expect((controller as any).createGlobalAction(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking GLOBAL_ACTION_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).createGlobalAction(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getGlobalActionById', () => {
    it('returns a global action with 200', async () => {
      service.getGlobalActionById.mockResolvedValue(mockAction);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testActionId },
      });
      const res = createMockResponse();

      await (controller as any).getGlobalActionById(req, res);

      expect(service.getGlobalActionById).toHaveBeenCalledWith(testProjectId, testActionId);
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockAction);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId, id: testActionId } });
      const res = createMockResponse();

      await expect((controller as any).getGlobalActionById(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('listGlobalActions', () => {
    it('returns paginated global actions with 200', async () => {
      const mockList = { items: [mockAction], total: 1, offset: 0, limit: 25 };
      service.listGlobalActions.mockResolvedValue(mockList);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId },
        query: {},
      });
      const res = createMockResponse();

      await (controller as any).listGlobalActions(req, res);

      expect(service.listGlobalActions).toHaveBeenCalledWith(testProjectId, expect.any(Object));
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockList);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, query: {} });
      const res = createMockResponse();

      await expect((controller as any).listGlobalActions(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('updateGlobalAction', () => {
    it('updates a global action and returns 200', async () => {
      const updated = { ...mockAction, name: 'Updated Action' };
      service.updateGlobalAction.mockResolvedValue(updated);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testActionId },
        body: { name: 'Updated Action', version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).updateGlobalAction(req, res);

      expect(service.updateGlobalAction).toHaveBeenCalledWith(
        testProjectId,
        testActionId,
        expect.objectContaining({ name: 'Updated Action', version: 1 }),
        testContext,
      );
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws ForbiddenError when lacking GLOBAL_ACTION_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testActionId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).updateGlobalAction(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('deleteGlobalAction', () => {
    it('deletes a global action and returns 204', async () => {
      service.deleteGlobalAction.mockResolvedValue(undefined);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testActionId },
        body: { version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).deleteGlobalAction(req, res);

      expect(service.deleteGlobalAction).toHaveBeenCalledWith(testProjectId, testActionId, 1, testContext);
      expect((res as MockResponse).statusCode).toBe(204);
      expect((res as MockResponse).sent).toBe(true);
    });

    it('throws ForbiddenError when lacking GLOBAL_ACTION_DELETE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testActionId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).deleteGlobalAction(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getGlobalActionAuditLogs', () => {
    it('returns audit logs with 200', async () => {
      const mockLogs = [{ id: 'log1', action: 'create' }];
      service.getGlobalActionAuditLogs.mockResolvedValue(mockLogs);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testActionId },
      });
      const res = createMockResponse();

      await (controller as any).getGlobalActionAuditLogs(req, res);

      expect(service.getGlobalActionAuditLogs).toHaveBeenCalledWith(testActionId, testProjectId);
      expect((res as MockResponse).statusCode).toBe(200);
    });
  });

  describe('cloneGlobalAction', () => {
    it('clones a global action and returns 201', async () => {
      const cloned = { ...mockAction, id: 'globalact_cloned001', name: 'Test Global Action (Copy)' };
      service.cloneGlobalAction.mockResolvedValue(cloned);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testActionId },
        body: {},
      });
      const res = createMockResponse();

      await (controller as any).cloneGlobalAction(req, res);

      expect(service.cloneGlobalAction).toHaveBeenCalledWith(testProjectId, testActionId, {}, testContext);
      expect((res as MockResponse).statusCode).toBe(201);
      expect((res as MockResponse).jsonBody).toBe(cloned);
    });

    it('throws ForbiddenError when lacking GLOBAL_ACTION_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testActionId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).cloneGlobalAction(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('registerRoutes', () => {
    it('registers all global action routes', () => {
      const mockRouter = { post: vi.fn(), get: vi.fn(), put: vi.fn(), delete: vi.fn() } as any;
      controller.registerRoutes(mockRouter);

      expect(mockRouter.post).toHaveBeenCalledTimes(2);
      expect(mockRouter.get).toHaveBeenCalledTimes(3);
      expect(mockRouter.put).toHaveBeenCalledTimes(1);
      expect(mockRouter.delete).toHaveBeenCalledTimes(1);
    });
  });

  describe('getOpenAPIPaths', () => {
    it('returns OpenAPI path definitions for all endpoints', () => {
      const paths = GlobalActionController.getOpenAPIPaths();
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path).toHaveProperty('path');
        expect(path.path.startsWith('/api/projects/{projectId}/global-actions')).toBe(true);
        expect(path).toHaveProperty('method');
      }
    });
  });
});
