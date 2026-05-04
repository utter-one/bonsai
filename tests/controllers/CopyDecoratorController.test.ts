import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';
import { UnauthorizedError, ForbiddenError } from '../../src/errors';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { CopyDecoratorController } from '../../src/http/controllers/CopyDecoratorController';

const testProjectId = 'proj_test001';
const testDecoratorId = 'copydec_test001';
const testContext = {
  operatorId: 'oper_test001',
  roles: ['super_admin'],
  ip: '127.0.0.1',
  userAgent: 'test/1.0',
  requestId: 'req_test001',
  timestamp: new Date('2025-01-01T00:00:00Z'),
};

const mockDecorator = {
  id: testDecoratorId,
  projectId: testProjectId,
  name: 'Test Copy Decorator',
  template: '{{content}}',
  version: 1,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

const createDecoratorBody = { name: 'Test Copy Decorator', template: '{{content}}' };

describe('CopyDecoratorController', () => {
  let controller: CopyDecoratorController;
  let service: any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = {
      createCopyDecorator: vi.fn(),
      getCopyDecoratorById: vi.fn(),
      listCopyDecorators: vi.fn(),
      updateCopyDecorator: vi.fn(),
      deleteCopyDecorator: vi.fn(),
      getCopyDecoratorAuditLogs: vi.fn(),
    };
    controller = new CopyDecoratorController(service);
  });

  describe('createCopyDecorator', () => {
    it('creates a copy decorator and returns 201', async () => {
      service.createCopyDecorator.mockResolvedValue(mockDecorator);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId },
        body: createDecoratorBody,
      });
      const res = createMockResponse();

      await (controller as any).createCopyDecorator(req, res);

      expect(service.createCopyDecorator).toHaveBeenCalledWith(testProjectId, expect.any(Object), testContext);
      expect((res as MockResponse).statusCode).toBe(201);
      expect((res as MockResponse).jsonBody).toBe(mockDecorator);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, body: {} });
      const res = createMockResponse();

      await expect((controller as any).createCopyDecorator(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking COPY_DECORATOR_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).createCopyDecorator(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getCopyDecoratorById', () => {
    it('returns a copy decorator with 200', async () => {
      service.getCopyDecoratorById.mockResolvedValue(mockDecorator);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testDecoratorId },
      });
      const res = createMockResponse();

      await (controller as any).getCopyDecoratorById(req, res);

      expect(service.getCopyDecoratorById).toHaveBeenCalledWith(testProjectId, testDecoratorId);
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockDecorator);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId, id: testDecoratorId } });
      const res = createMockResponse();

      await expect((controller as any).getCopyDecoratorById(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('listCopyDecorators', () => {
    it('returns paginated copy decorators with 200', async () => {
      const mockList = { items: [mockDecorator], total: 1, offset: 0, limit: 25 };
      service.listCopyDecorators.mockResolvedValue(mockList);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId },
        query: {},
      });
      const res = createMockResponse();

      await (controller as any).listCopyDecorators(req, res);

      expect(service.listCopyDecorators).toHaveBeenCalledWith(testProjectId, expect.any(Object));
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockList);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, query: {} });
      const res = createMockResponse();

      await expect((controller as any).listCopyDecorators(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('updateCopyDecorator', () => {
    it('updates a copy decorator and returns 200', async () => {
      const updated = { ...mockDecorator, name: 'Updated Decorator' };
      service.updateCopyDecorator.mockResolvedValue(updated);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testDecoratorId },
        body: { name: 'Updated Decorator', version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).updateCopyDecorator(req, res);

      expect(service.updateCopyDecorator).toHaveBeenCalledWith(
        testProjectId,
        testDecoratorId,
        expect.objectContaining({ name: 'Updated Decorator', version: 1 }),
        testContext,
      );
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws ForbiddenError when lacking COPY_DECORATOR_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testDecoratorId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).updateCopyDecorator(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('deleteCopyDecorator', () => {
    it('deletes a copy decorator and returns 204', async () => {
      service.deleteCopyDecorator.mockResolvedValue(undefined);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testDecoratorId },
        body: { version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).deleteCopyDecorator(req, res);

      expect(service.deleteCopyDecorator).toHaveBeenCalledWith(testProjectId, testDecoratorId, 1, testContext);
      expect((res as MockResponse).statusCode).toBe(204);
      expect((res as MockResponse).sent).toBe(true);
    });

    it('throws ForbiddenError when lacking COPY_DECORATOR_DELETE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testDecoratorId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).deleteCopyDecorator(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getCopyDecoratorAuditLogs', () => {
    it('returns audit logs with 200', async () => {
      const mockLogs = [{ id: 'log1', action: 'create' }];
      service.getCopyDecoratorAuditLogs.mockResolvedValue(mockLogs);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testDecoratorId },
      });
      const res = createMockResponse();

      await (controller as any).getCopyDecoratorAuditLogs(req, res);

      expect(service.getCopyDecoratorAuditLogs).toHaveBeenCalledWith(testDecoratorId, testProjectId);
      expect((res as MockResponse).statusCode).toBe(200);
    });
  });

  describe('registerRoutes', () => {
    it('registers all copy decorator routes', () => {
      const mockRouter = { post: vi.fn(), get: vi.fn(), put: vi.fn(), delete: vi.fn() } as any;
      controller.registerRoutes(mockRouter);

      expect(mockRouter.post).toHaveBeenCalledTimes(1);
      expect(mockRouter.get).toHaveBeenCalledTimes(3);
      expect(mockRouter.put).toHaveBeenCalledTimes(1);
      expect(mockRouter.delete).toHaveBeenCalledTimes(1);
    });
  });

  describe('getOpenAPIPaths', () => {
    it('returns OpenAPI path definitions for all endpoints', () => {
      const paths = CopyDecoratorController.getOpenAPIPaths();
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path).toHaveProperty('path');
        expect(path.path.startsWith('/api/projects/{projectId}/copy-decorators')).toBe(true);
        expect(path).toHaveProperty('method');
      }
    });
  });
});
