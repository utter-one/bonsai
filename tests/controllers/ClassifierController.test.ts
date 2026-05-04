import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';
import { UnauthorizedError, ForbiddenError } from '../../src/errors';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { ClassifierController } from '../../src/http/controllers/ClassifierController';

const testProjectId = 'proj_test001';
const testClassifierId = 'class_test001';
const testContext = {
  operatorId: 'oper_test001',
  roles: ['super_admin'],
  ip: '127.0.0.1',
  userAgent: 'test/1.0',
  requestId: 'req_test001',
  timestamp: new Date('2025-01-01T00:00:00Z'),
};

const mockClassifier = {
  id: testClassifierId,
  projectId: testProjectId,
  name: 'Test Classifier',
  version: 1,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

const createClassifierBody = {
  name: 'Test Classifier',
  prompt: 'Classify the user input.',
  llmProviderId: 'llm_test001',
  llmSettings: { model: 'gpt-4' },
};

describe('ClassifierController', () => {
  let controller: ClassifierController;
  let service: any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = {
      createClassifier: vi.fn(),
      getClassifierById: vi.fn(),
      listClassifiers: vi.fn(),
      updateClassifier: vi.fn(),
      deleteClassifier: vi.fn(),
      getClassifierAuditLogs: vi.fn(),
      cloneClassifier: vi.fn(),
    };
    controller = new ClassifierController(service);
  });

  describe('createClassifier', () => {
    it('creates a classifier and returns 201', async () => {
      service.createClassifier.mockResolvedValue(mockClassifier);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId },
        body: createClassifierBody,
      });
      const res = createMockResponse();

      await (controller as any).createClassifier(req, res);

      expect(service.createClassifier).toHaveBeenCalledWith(testProjectId, expect.objectContaining({ name: 'Test Classifier' }), testContext);
      expect((res as MockResponse).statusCode).toBe(201);
      expect((res as MockResponse).jsonBody).toBe(mockClassifier);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, body: {} });
      const res = createMockResponse();

      await expect((controller as any).createClassifier(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking CLASSIFIER_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).createClassifier(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getClassifierById', () => {
    it('returns a classifier with 200', async () => {
      service.getClassifierById.mockResolvedValue(mockClassifier);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testClassifierId },
      });
      const res = createMockResponse();

      await (controller as any).getClassifierById(req, res);

      expect(service.getClassifierById).toHaveBeenCalledWith(testProjectId, testClassifierId);
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockClassifier);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId, id: testClassifierId } });
      const res = createMockResponse();

      await expect((controller as any).getClassifierById(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('listClassifiers', () => {
    it('returns paginated classifiers with 200', async () => {
      const mockList = { items: [mockClassifier], total: 1, offset: 0, limit: 25 };
      service.listClassifiers.mockResolvedValue(mockList);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId },
        query: {},
      });
      const res = createMockResponse();

      await (controller as any).listClassifiers(req, res);

      expect(service.listClassifiers).toHaveBeenCalledWith(testProjectId, expect.any(Object));
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockList);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, query: {} });
      const res = createMockResponse();

      await expect((controller as any).listClassifiers(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('updateClassifier', () => {
    it('updates a classifier and returns 200', async () => {
      const updated = { ...mockClassifier, name: 'Updated Classifier' };
      service.updateClassifier.mockResolvedValue(updated);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testClassifierId },
        body: { name: 'Updated Classifier', version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).updateClassifier(req, res);

      expect(service.updateClassifier).toHaveBeenCalledWith(
        testProjectId,
        testClassifierId,
        expect.objectContaining({ name: 'Updated Classifier', version: 1 }),
        testContext,
      );
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws ForbiddenError when lacking CLASSIFIER_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testClassifierId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).updateClassifier(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('deleteClassifier', () => {
    it('deletes a classifier and returns 204', async () => {
      service.deleteClassifier.mockResolvedValue(undefined);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testClassifierId },
        body: { version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).deleteClassifier(req, res);

      expect(service.deleteClassifier).toHaveBeenCalledWith(testProjectId, testClassifierId, 1, testContext);
      expect((res as MockResponse).statusCode).toBe(204);
      expect((res as MockResponse).sent).toBe(true);
    });

    it('throws ForbiddenError when lacking CLASSIFIER_DELETE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testClassifierId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).deleteClassifier(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getClassifierAuditLogs', () => {
    it('returns audit logs with 200', async () => {
      const mockLogs = [{ id: 'log1', action: 'create' }];
      service.getClassifierAuditLogs.mockResolvedValue(mockLogs);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testClassifierId },
      });
      const res = createMockResponse();

      await (controller as any).getClassifierAuditLogs(req, res);

      expect(service.getClassifierAuditLogs).toHaveBeenCalledWith(testClassifierId, testProjectId);
      expect((res as MockResponse).statusCode).toBe(200);
    });
  });

  describe('cloneClassifier', () => {
    it('clones a classifier and returns 201', async () => {
      const cloned = { ...mockClassifier, id: 'class_cloned001', name: 'Test Classifier (Copy)' };
      service.cloneClassifier.mockResolvedValue(cloned);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testClassifierId },
        body: {},
      });
      const res = createMockResponse();

      await (controller as any).cloneClassifier(req, res);

      expect(service.cloneClassifier).toHaveBeenCalledWith(testProjectId, testClassifierId, {}, testContext);
      expect((res as MockResponse).statusCode).toBe(201);
      expect((res as MockResponse).jsonBody).toBe(cloned);
    });

    it('throws ForbiddenError when lacking CLASSIFIER_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testClassifierId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).cloneClassifier(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('registerRoutes', () => {
    it('registers all classifier routes', () => {
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
      const paths = ClassifierController.getOpenAPIPaths();
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path).toHaveProperty('path');
        expect(path.path.startsWith('/api/projects/{projectId}/classifiers')).toBe(true);
        expect(path).toHaveProperty('method');
      }
    });
  });
});
