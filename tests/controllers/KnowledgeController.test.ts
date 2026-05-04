import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';
import { UnauthorizedError, ForbiddenError } from '../../src/errors';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { KnowledgeController } from '../../src/http/controllers/KnowledgeController';

const testProjectId = 'proj_test001';
const testCategoryId = 'kcat_test001';
const testItemId = 'kitem_test001';
const testContext = {
  operatorId: 'oper_test001',
  roles: ['super_admin'],
  ip: '127.0.0.1',
  userAgent: 'test/1.0',
  requestId: 'req_test001',
  timestamp: new Date('2025-01-01T00:00:00Z'),
};

const mockCategory = {
  id: testCategoryId,
  projectId: testProjectId,
  name: 'Test Category',
  promptTrigger: '/help',
  tags: ['support'],
  order: 0,
  version: 1,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

const mockItem = {
  id: testItemId,
  projectId: testProjectId,
  categoryId: testCategoryId,
  question: 'What is your policy?',
  answer: 'Our policy is...',
  order: 0,
  version: 1,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

const createCategoryBody = {
  name: 'Test Category',
  promptTrigger: '/help',
};

const createItemBody = {
  categoryId: testCategoryId,
  question: 'What is your policy?',
  answer: 'Our policy is...',
};

describe('KnowledgeController', () => {
  let controller: KnowledgeController;
  let service: any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = {
      createKnowledgeCategory: vi.fn(),
      getKnowledgeCategoryById: vi.fn(),
      listKnowledgeCategories: vi.fn(),
      updateKnowledgeCategory: vi.fn(),
      deleteKnowledgeCategory: vi.fn(),
      createKnowledgeItem: vi.fn(),
      getKnowledgeItemById: vi.fn(),
      listKnowledgeItems: vi.fn(),
      updateKnowledgeItem: vi.fn(),
      deleteKnowledgeItem: vi.fn(),
      getItemsByCategory: vi.fn(),
      getKnowledgeCategoryAuditLogs: vi.fn(),
      getKnowledgeItemAuditLogs: vi.fn(),
    };
    controller = new KnowledgeController(service);
  });

  // ============================================================
  // CATEGORY TESTS
  // ============================================================

  describe('createKnowledgeCategory', () => {
    it('creates a knowledge category and returns 201', async () => {
      service.createKnowledgeCategory.mockResolvedValue(mockCategory);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId },
        body: createCategoryBody,
      });
      const res = createMockResponse();

      await (controller as any).createKnowledgeCategory(req, res);

      expect(service.createKnowledgeCategory).toHaveBeenCalledWith(testProjectId, expect.objectContaining({ name: 'Test Category' }), testContext);
      expect((res as MockResponse).statusCode).toBe(201);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, body: {} });
      const res = createMockResponse();

      await expect((controller as any).createKnowledgeCategory(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking KNOWLEDGE_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).createKnowledgeCategory(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getKnowledgeCategoryById', () => {
    it('returns a knowledge category with 200', async () => {
      service.getKnowledgeCategoryById.mockResolvedValue(mockCategory);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testCategoryId },
      });
      const res = createMockResponse();

      await (controller as any).getKnowledgeCategoryById(req, res);

      expect(service.getKnowledgeCategoryById).toHaveBeenCalledWith(testProjectId, testCategoryId);
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId, id: testCategoryId } });
      const res = createMockResponse();

      await expect((controller as any).getKnowledgeCategoryById(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('listKnowledgeCategories', () => {
    it('returns paginated categories with 200', async () => {
      const mockList = { items: [mockCategory], total: 1, offset: 0, limit: 25 };
      service.listKnowledgeCategories.mockResolvedValue(mockList);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId },
        query: {},
      });
      const res = createMockResponse();

      await (controller as any).listKnowledgeCategories(req, res);

      expect(service.listKnowledgeCategories).toHaveBeenCalledWith(testProjectId, expect.any(Object));
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, query: {} });
      const res = createMockResponse();

      await expect((controller as any).listKnowledgeCategories(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('updateKnowledgeCategory', () => {
    it('updates a knowledge category and returns 200', async () => {
      const updated = { ...mockCategory, name: 'Updated' };
      service.updateKnowledgeCategory.mockResolvedValue(updated);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testCategoryId },
        body: { name: 'Updated', version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).updateKnowledgeCategory(req, res);

      expect(service.updateKnowledgeCategory).toHaveBeenCalledWith(
        testProjectId,
        testCategoryId,
        expect.objectContaining({ name: 'Updated', version: 1 }),
        testContext,
      );
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws ForbiddenError when lacking KNOWLEDGE_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testCategoryId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).updateKnowledgeCategory(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('deleteKnowledgeCategory', () => {
    it('deletes a knowledge category and returns 204', async () => {
      service.deleteKnowledgeCategory.mockResolvedValue(undefined);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testCategoryId },
        body: { version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).deleteKnowledgeCategory(req, res);

      expect(service.deleteKnowledgeCategory).toHaveBeenCalledWith(testProjectId, testCategoryId, 1, testContext);
      expect((res as MockResponse).statusCode).toBe(204);
    });

    it('throws ForbiddenError when lacking KNOWLEDGE_DELETE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testCategoryId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).deleteKnowledgeCategory(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  // ============================================================
  // ITEM TESTS
  // ============================================================

  describe('createKnowledgeItem', () => {
    it('creates a knowledge item and returns 201', async () => {
      service.createKnowledgeItem.mockResolvedValue(mockItem);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId },
        body: createItemBody,
      });
      const res = createMockResponse();

      await (controller as any).createKnowledgeItem(req, res);

      expect(service.createKnowledgeItem).toHaveBeenCalledWith(testProjectId, expect.objectContaining({ question: 'What is your policy?' }), testContext);
      expect((res as MockResponse).statusCode).toBe(201);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, body: {} });
      const res = createMockResponse();

      await expect((controller as any).createKnowledgeItem(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking KNOWLEDGE_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).createKnowledgeItem(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getKnowledgeItemById', () => {
    it('returns a knowledge item with 200', async () => {
      service.getKnowledgeItemById.mockResolvedValue(mockItem);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testItemId },
      });
      const res = createMockResponse();

      await (controller as any).getKnowledgeItemById(req, res);

      expect(service.getKnowledgeItemById).toHaveBeenCalledWith(testProjectId, testItemId);
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId, id: testItemId } });
      const res = createMockResponse();

      await expect((controller as any).getKnowledgeItemById(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('listKnowledgeItems', () => {
    it('returns paginated items with 200', async () => {
      const mockList = { items: [mockItem], total: 1, offset: 0, limit: 25 };
      service.listKnowledgeItems.mockResolvedValue(mockList);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId },
        query: {},
      });
      const res = createMockResponse();

      await (controller as any).listKnowledgeItems(req, res);

      expect(service.listKnowledgeItems).toHaveBeenCalledWith(testProjectId, expect.any(Object));
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, query: {} });
      const res = createMockResponse();

      await expect((controller as any).listKnowledgeItems(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('updateKnowledgeItem', () => {
    it('updates a knowledge item and returns 200', async () => {
      const updated = { ...mockItem, question: 'Updated question' };
      service.updateKnowledgeItem.mockResolvedValue(updated);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testItemId },
        body: { question: 'Updated question', version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).updateKnowledgeItem(req, res);

      expect(service.updateKnowledgeItem).toHaveBeenCalledWith(
        testProjectId,
        testItemId,
        expect.objectContaining({ question: 'Updated question', version: 1 }),
        testContext,
      );
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws ForbiddenError when lacking KNOWLEDGE_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testItemId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).updateKnowledgeItem(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('deleteKnowledgeItem', () => {
    it('deletes a knowledge item and returns 204', async () => {
      service.deleteKnowledgeItem.mockResolvedValue(undefined);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testItemId },
        body: { version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).deleteKnowledgeItem(req, res);

      expect(service.deleteKnowledgeItem).toHaveBeenCalledWith(testProjectId, testItemId, 1, testContext);
      expect((res as MockResponse).statusCode).toBe(204);
    });

    it('throws ForbiddenError when lacking KNOWLEDGE_DELETE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testItemId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).deleteKnowledgeItem(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getItemsByCategory', () => {
    it('returns items for a category with 200', async () => {
      service.getItemsByCategory.mockResolvedValue([mockItem]);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, categoryId: testCategoryId },
      });
      const res = createMockResponse();

      await (controller as any).getItemsByCategory(req, res);

      expect(service.getItemsByCategory).toHaveBeenCalledWith(testProjectId, testCategoryId);
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId, categoryId: testCategoryId } });
      const res = createMockResponse();

      await expect((controller as any).getItemsByCategory(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('getKnowledgeCategoryAuditLogs', () => {
    it('returns category audit logs with 200', async () => {
      const mockLogs = [{ id: 'log1', action: 'create' }];
      service.getKnowledgeCategoryAuditLogs.mockResolvedValue(mockLogs);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testCategoryId },
      });
      const res = createMockResponse();

      await (controller as any).getKnowledgeCategoryAuditLogs(req, res);

      expect(service.getKnowledgeCategoryAuditLogs).toHaveBeenCalledWith(testCategoryId, testProjectId);
      expect((res as MockResponse).statusCode).toBe(200);
    });
  });

  describe('getKnowledgeItemAuditLogs', () => {
    it('returns item audit logs with 200', async () => {
      const mockLogs = [{ id: 'log1', action: 'create' }];
      service.getKnowledgeItemAuditLogs.mockResolvedValue(mockLogs);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testItemId },
      });
      const res = createMockResponse();

      await (controller as any).getKnowledgeItemAuditLogs(req, res);

      expect(service.getKnowledgeItemAuditLogs).toHaveBeenCalledWith(testItemId, testProjectId);
      expect((res as MockResponse).statusCode).toBe(200);
    });
  });

  describe('registerRoutes', () => {
    it('registers all knowledge routes', () => {
      const mockRouter = { post: vi.fn(), get: vi.fn(), put: vi.fn(), delete: vi.fn() } as any;
      controller.registerRoutes(mockRouter);

      expect(mockRouter.post).toHaveBeenCalledTimes(2);
      expect(mockRouter.get).toHaveBeenCalledTimes(7);
      expect(mockRouter.put).toHaveBeenCalledTimes(2);
      expect(mockRouter.delete).toHaveBeenCalledTimes(2);
    });
  });

  describe('getOpenAPIPaths', () => {
    it('returns OpenAPI path definitions for all endpoints', () => {
      const paths = KnowledgeController.getOpenAPIPaths();
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path).toHaveProperty('path');
        expect(path.path.startsWith('/api/projects/{projectId}/knowledge')).toBe(true);
        expect(path).toHaveProperty('method');
      }
    });
  });
});
