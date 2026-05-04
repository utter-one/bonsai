import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';
import { UnauthorizedError, ForbiddenError } from '../../src/errors';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { ToolController } from '../../src/http/controllers/ToolController';

const testProjectId = 'proj_test001';
const testToolId = 'tool_test001';
const testContext = {
  operatorId: 'oper_test001',
  roles: ['super_admin'],
  ip: '127.0.0.1',
  userAgent: 'test/1.0',
  requestId: 'req_test001',
  timestamp: new Date('2025-01-01T00:00:00Z'),
};

const mockTool = {
  id: testToolId,
  projectId: testProjectId,
  name: 'Test Tool',
  version: 1,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

describe('ToolController', () => {
  let controller: ToolController;
  let service: any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = {
      createTool: vi.fn(),
      getToolById: vi.fn(),
      listTools: vi.fn(),
      updateTool: vi.fn(),
      deleteTool: vi.fn(),
      getToolAuditLogs: vi.fn(),
      cloneTool: vi.fn(),
    };
    controller = new ToolController(service);
  });

  describe('createTool', () => {
    it('creates a tool and returns 201', async () => {
      service.createTool.mockResolvedValue(mockTool);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId },
        body: { name: 'Test Tool', type: 'script', code: 'return 1;' },
      });
      const res = createMockResponse();

      await (controller as any).createTool(req, res);

      expect(service.createTool).toHaveBeenCalledWith(testProjectId, expect.objectContaining({ name: 'Test Tool', type: 'script', code: 'return 1;' }), testContext);
      expect((res as MockResponse).statusCode).toBe(201);
      expect((res as MockResponse).jsonBody).toBe(mockTool);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, body: {} });
      const res = createMockResponse();

      await expect((controller as any).createTool(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking TOOL_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).createTool(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getToolById', () => {
    it('returns a tool with 200', async () => {
      service.getToolById.mockResolvedValue(mockTool);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testToolId },
      });
      const res = createMockResponse();

      await (controller as any).getToolById(req, res);

      expect(service.getToolById).toHaveBeenCalledWith(testProjectId, testToolId);
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockTool);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId, id: testToolId } });
      const res = createMockResponse();

      await expect((controller as any).getToolById(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('listTools', () => {
    it('returns paginated tools with 200', async () => {
      const mockList = { items: [mockTool], total: 1, offset: 0, limit: 25 };
      service.listTools.mockResolvedValue(mockList);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId },
        query: {},
      });
      const res = createMockResponse();

      await (controller as any).listTools(req, res);

      expect(service.listTools).toHaveBeenCalledWith(testProjectId, expect.any(Object));
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockList);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, query: {} });
      const res = createMockResponse();

      await expect((controller as any).listTools(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('updateTool', () => {
    it('updates a tool and returns 200', async () => {
      const updated = { ...mockTool, name: 'Updated Tool' };
      service.updateTool.mockResolvedValue(updated);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testToolId },
        body: { name: 'Updated Tool', type: 'script', code: 'return 2;', version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).updateTool(req, res);

      expect(service.updateTool).toHaveBeenCalledWith(
        testProjectId,
        testToolId,
        expect.objectContaining({ name: 'Updated Tool', type: 'script', code: 'return 2;', version: 1 }),
        testContext,
      );
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws ForbiddenError when lacking TOOL_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testToolId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).updateTool(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('deleteTool', () => {
    it('deletes a tool and returns 204', async () => {
      service.deleteTool.mockResolvedValue(undefined);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testToolId },
        body: { version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).deleteTool(req, res);

      expect(service.deleteTool).toHaveBeenCalledWith(testProjectId, testToolId, 1, testContext);
      expect((res as MockResponse).statusCode).toBe(204);
      expect((res as MockResponse).sent).toBe(true);
    });

    it('throws ForbiddenError when lacking TOOL_DELETE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testToolId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).deleteTool(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getToolAuditLogs', () => {
    it('returns audit logs with 200', async () => {
      const mockLogs = [{ id: 'log1', action: 'create' }];
      service.getToolAuditLogs.mockResolvedValue(mockLogs);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testToolId },
      });
      const res = createMockResponse();

      await (controller as any).getToolAuditLogs(req, res);

      expect(service.getToolAuditLogs).toHaveBeenCalledWith(testToolId, testProjectId);
      expect((res as MockResponse).statusCode).toBe(200);
    });
  });

  describe('cloneTool', () => {
    it('clones a tool and returns 201', async () => {
      const cloned = { ...mockTool, id: 'tool_cloned001', name: 'Test Tool (Copy)' };
      service.cloneTool.mockResolvedValue(cloned);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testToolId },
        body: {},
      });
      const res = createMockResponse();

      await (controller as any).cloneTool(req, res);

      expect(service.cloneTool).toHaveBeenCalledWith(testProjectId, testToolId, {}, testContext);
      expect((res as MockResponse).statusCode).toBe(201);
      expect((res as MockResponse).jsonBody).toBe(cloned);
    });

    it('throws ForbiddenError when lacking TOOL_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testToolId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).cloneTool(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('registerRoutes', () => {
    it('registers all tool routes', () => {
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
      const paths = ToolController.getOpenAPIPaths();
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path).toHaveProperty('path');
        expect(path.path.startsWith('/api/projects/{projectId}/tools')).toBe(true);
        expect(path).toHaveProperty('method');
      }
    });
  });
});
