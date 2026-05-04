import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';
import { UnauthorizedError, ForbiddenError } from '../../src/errors';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { StageController } from '../../src/http/controllers/StageController';

const testProjectId = 'proj_test001';
const testStageId = 'stage_test001';
const testContext = {
  operatorId: 'oper_test001',
  roles: ['super_admin'],
  ip: '127.0.0.1',
  userAgent: 'test/1.0',
  requestId: 'req_test001',
  timestamp: new Date('2025-01-01T00:00:00Z'),
};

const mockStage = {
  id: testStageId,
  projectId: testProjectId,
  name: 'Test Stage',
  version: 1,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

describe('StageController', () => {
  let controller: StageController;
  let service: any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = {
      createStage: vi.fn(),
      getStageById: vi.fn(),
      listStages: vi.fn(),
      updateStage: vi.fn(),
      deleteStage: vi.fn(),
      getStageAuditLogs: vi.fn(),
      cloneStage: vi.fn(),
    };
    controller = new StageController(service);
  });

  describe('createStage', () => {
    it('creates a stage and returns 201', async () => {
      service.createStage.mockResolvedValue(mockStage);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId },
        body: { name: 'Test Stage', prompt: 'Test prompt', llmProviderId: 'provider_test001', llmSettings: { model: 'gpt-4o' }, agentId: 'agent_test001' },
      });
      const res = createMockResponse();

      await (controller as any).createStage(req, res);

      expect(service.createStage).toHaveBeenCalledWith(testProjectId, expect.objectContaining({ name: 'Test Stage' }), testContext);
      expect((res as MockResponse).statusCode).toBe(201);
      expect((res as MockResponse).jsonBody).toBe(mockStage);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, body: {} });
      const res = createMockResponse();

      await expect((controller as any).createStage(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking STAGE_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).createStage(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getStageById', () => {
    it('returns a stage with 200', async () => {
      service.getStageById.mockResolvedValue(mockStage);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testStageId },
      });
      const res = createMockResponse();

      await (controller as any).getStageById(req, res);

      expect(service.getStageById).toHaveBeenCalledWith(testProjectId, testStageId);
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockStage);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId, id: testStageId } });
      const res = createMockResponse();

      await expect((controller as any).getStageById(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('listStages', () => {
    it('returns paginated stages with 200', async () => {
      const mockList = { items: [mockStage], total: 1, offset: 0, limit: 25 };
      service.listStages.mockResolvedValue(mockList);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId },
        query: {},
      });
      const res = createMockResponse();

      await (controller as any).listStages(req, res);

      expect(service.listStages).toHaveBeenCalledWith(testProjectId, expect.any(Object));
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockList);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, query: {} });
      const res = createMockResponse();

      await expect((controller as any).listStages(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('updateStage', () => {
    it('updates a stage and returns 200', async () => {
      const updated = { ...mockStage, name: 'Updated Stage' };
      service.updateStage.mockResolvedValue(updated);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testStageId },
        body: { name: 'Updated Stage', version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).updateStage(req, res);

      expect(service.updateStage).toHaveBeenCalledWith(
        testProjectId,
        testStageId,
        expect.objectContaining({ name: 'Updated Stage' }),
        testContext,
      );
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws ForbiddenError when lacking STAGE_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testStageId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).updateStage(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('deleteStage', () => {
    it('deletes a stage and returns 204', async () => {
      service.deleteStage.mockResolvedValue(undefined);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testStageId },
        body: { version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).deleteStage(req, res);

      expect(service.deleteStage).toHaveBeenCalledWith(testProjectId, testStageId, 1, testContext);
      expect((res as MockResponse).statusCode).toBe(204);
      expect((res as MockResponse).sent).toBe(true);
    });

    it('throws ForbiddenError when lacking STAGE_DELETE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testStageId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).deleteStage(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getStageAuditLogs', () => {
    it('returns audit logs with 200', async () => {
      const mockLogs = [{ id: 'log1', action: 'create' }];
      service.getStageAuditLogs.mockResolvedValue(mockLogs);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testStageId },
      });
      const res = createMockResponse();

      await (controller as any).getStageAuditLogs(req, res);

      expect(service.getStageAuditLogs).toHaveBeenCalledWith(testStageId, testProjectId);
      expect((res as MockResponse).statusCode).toBe(200);
    });
  });

  describe('cloneStage', () => {
    it('clones a stage and returns 201', async () => {
      const cloned = { ...mockStage, id: 'stage_cloned001', name: 'Test Stage (Copy)' };
      service.cloneStage.mockResolvedValue(cloned);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testStageId },
        body: {},
      });
      const res = createMockResponse();

      await (controller as any).cloneStage(req, res);

      expect(service.cloneStage).toHaveBeenCalledWith(testProjectId, testStageId, {}, testContext);
      expect((res as MockResponse).statusCode).toBe(201);
      expect((res as MockResponse).jsonBody).toBe(cloned);
    });

    it('throws ForbiddenError when lacking STAGE_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testStageId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).cloneStage(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('registerRoutes', () => {
    it('registers all stage routes', () => {
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
      const paths = StageController.getOpenAPIPaths();
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path).toHaveProperty('path');
        expect(path.path.startsWith('/api/projects/{projectId}/stages')).toBe(true);
        expect(path).toHaveProperty('method');
      }
    });
  });
});
