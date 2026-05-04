import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';
import { UnauthorizedError, ForbiddenError } from '../../src/errors';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { ContextTransformerController } from '../../src/http/controllers/ContextTransformerController';

const testProjectId = 'proj_test001';
const testTransformerId = 'ctxtrans_test001';
const testContext = {
  operatorId: 'oper_test001',
  roles: ['super_admin'],
  ip: '127.0.0.1',
  userAgent: 'test/1.0',
  requestId: 'req_test001',
  timestamp: new Date('2025-01-01T00:00:00Z'),
};

const mockTransformer = {
  id: testTransformerId,
  projectId: testProjectId,
  name: 'Test Context Transformer',
  version: 1,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

const createContextTransformerBody = {
  name: 'Test Context Transformer',
  prompt: 'Transform the context.',
  llmProviderId: 'llm_test001',
  llmSettings: { model: 'gpt-4' },
};

describe('ContextTransformerController', () => {
  let controller: ContextTransformerController;
  let service: any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = {
      createContextTransformer: vi.fn(),
      getContextTransformerById: vi.fn(),
      listContextTransformers: vi.fn(),
      updateContextTransformer: vi.fn(),
      deleteContextTransformer: vi.fn(),
      getContextTransformerAuditLogs: vi.fn(),
      cloneContextTransformer: vi.fn(),
    };
    controller = new ContextTransformerController(service);
  });

  describe('createContextTransformer', () => {
    it('creates a context transformer and returns 201', async () => {
      service.createContextTransformer.mockResolvedValue(mockTransformer);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId },
        body: createContextTransformerBody,
      });
      const res = createMockResponse();

      await (controller as any).createContextTransformer(req, res);

      expect(service.createContextTransformer).toHaveBeenCalledWith(testProjectId, expect.objectContaining({ name: 'Test Context Transformer' }), testContext);
      expect((res as MockResponse).statusCode).toBe(201);
      expect((res as MockResponse).jsonBody).toBe(mockTransformer);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, body: {} });
      const res = createMockResponse();

      await expect((controller as any).createContextTransformer(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking CONTEXT_TRANSFORMER_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).createContextTransformer(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getContextTransformerById', () => {
    it('returns a context transformer with 200', async () => {
      service.getContextTransformerById.mockResolvedValue(mockTransformer);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testTransformerId },
      });
      const res = createMockResponse();

      await (controller as any).getContextTransformerById(req, res);

      expect(service.getContextTransformerById).toHaveBeenCalledWith(testProjectId, testTransformerId);
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockTransformer);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId, id: testTransformerId } });
      const res = createMockResponse();

      await expect((controller as any).getContextTransformerById(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('listContextTransformers', () => {
    it('returns paginated context transformers with 200', async () => {
      const mockList = { items: [mockTransformer], total: 1, offset: 0, limit: 25 };
      service.listContextTransformers.mockResolvedValue(mockList);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId },
        query: {},
      });
      const res = createMockResponse();

      await (controller as any).listContextTransformers(req, res);

      expect(service.listContextTransformers).toHaveBeenCalledWith(testProjectId, expect.any(Object));
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockList);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, query: {} });
      const res = createMockResponse();

      await expect((controller as any).listContextTransformers(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('updateContextTransformer', () => {
    it('updates a context transformer and returns 200', async () => {
      const updated = { ...mockTransformer, name: 'Updated Transformer' };
      service.updateContextTransformer.mockResolvedValue(updated);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testTransformerId },
        body: { name: 'Updated Transformer', version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).updateContextTransformer(req, res);

      expect(service.updateContextTransformer).toHaveBeenCalledWith(
        testProjectId,
        testTransformerId,
        expect.objectContaining({ name: 'Updated Transformer', version: 1 }),
        testContext,
      );
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws ForbiddenError when lacking CONTEXT_TRANSFORMER_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testTransformerId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).updateContextTransformer(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('deleteContextTransformer', () => {
    it('deletes a context transformer and returns 204', async () => {
      service.deleteContextTransformer.mockResolvedValue(undefined);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testTransformerId },
        body: { version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).deleteContextTransformer(req, res);

      expect(service.deleteContextTransformer).toHaveBeenCalledWith(testProjectId, testTransformerId, 1, testContext);
      expect((res as MockResponse).statusCode).toBe(204);
      expect((res as MockResponse).sent).toBe(true);
    });

    it('throws ForbiddenError when lacking CONTEXT_TRANSFORMER_DELETE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testTransformerId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).deleteContextTransformer(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getContextTransformerAuditLogs', () => {
    it('returns audit logs with 200', async () => {
      const mockLogs = [{ id: 'log1', action: 'create' }];
      service.getContextTransformerAuditLogs.mockResolvedValue(mockLogs);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testTransformerId },
      });
      const res = createMockResponse();

      await (controller as any).getContextTransformerAuditLogs(req, res);

      expect(service.getContextTransformerAuditLogs).toHaveBeenCalledWith(testTransformerId, testProjectId);
      expect((res as MockResponse).statusCode).toBe(200);
    });
  });

  describe('cloneContextTransformer', () => {
    it('clones a context transformer and returns 201', async () => {
      const cloned = { ...mockTransformer, id: 'ctxtrans_cloned001', name: 'Test Context Transformer (Copy)' };
      service.cloneContextTransformer.mockResolvedValue(cloned);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testTransformerId },
        body: {},
      });
      const res = createMockResponse();

      await (controller as any).cloneContextTransformer(req, res);

      expect(service.cloneContextTransformer).toHaveBeenCalledWith(testProjectId, testTransformerId, {}, testContext);
      expect((res as MockResponse).statusCode).toBe(201);
      expect((res as MockResponse).jsonBody).toBe(cloned);
    });

    it('throws ForbiddenError when lacking CONTEXT_TRANSFORMER_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testTransformerId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).cloneContextTransformer(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('registerRoutes', () => {
    it('registers all context transformer routes', () => {
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
      const paths = ContextTransformerController.getOpenAPIPaths();
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path).toHaveProperty('path');
        expect(path.path.startsWith('/api/projects/{projectId}/context-transformers')).toBe(true);
        expect(path).toHaveProperty('method');
      }
    });
  });
});
