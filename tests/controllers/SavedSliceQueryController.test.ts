import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';
import { UnauthorizedError, ForbiddenError } from '../../src/errors';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { SavedSliceQueryController } from '../../src/http/controllers/SavedSliceQueryController';

const testProjectId = 'proj_test001';
const testQueryId = 'query_test001';
const testContext = {
  operatorId: 'oper_test001',
  roles: ['super_admin'],
  ip: '127.0.0.1',
  userAgent: 'test/1.0',
  requestId: 'req_test001',
  timestamp: new Date('2025-01-01T00:00:00Z'),
};

const mockQuery = {
  id: testQueryId,
  projectId: testProjectId,
  name: 'Test Query',
  source: 'conversations',
  metrics: ['count'],
  dimensions: ['agent_id'],
  filters: [],
  createdBy: 'oper_test001',
  isShared: false,
  version: 1,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

const createQueryBody = {
  name: 'Test Query',
  query: { source: 'conversations', metrics: ['count'], groupBy: ['agent_id'] },
  isShared: false,
};

describe('SavedSliceQueryController', () => {
  let controller: SavedSliceQueryController;
  let service: any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    controller = new SavedSliceQueryController(service);
  });

  describe('listSavedQueries', () => {
    it('returns saved queries with 200', async () => {
      const mockList = [mockQuery];
      service.list.mockResolvedValue(mockList);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId },
      });
      (req as any).url = '/api/projects/proj_test001/analytics/saved-queries';
      (req as any).method = 'GET';
      const res = createMockResponse();

      await (controller as any).listSavedQueries(req, res);

      expect(service.list).toHaveBeenCalledWith(testProjectId, testContext);
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockList);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId } });
      (req as any).url = '/api/projects/proj_test001/analytics/saved-queries';
      (req as any).method = 'GET';
      const res = createMockResponse();

      await expect((controller as any).listSavedQueries(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking required permission', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: [] },
        params: { projectId: testProjectId },
      });
      (req as any).url = '/api/projects/proj_test001/analytics/saved-queries';
      (req as any).method = 'GET';
      const res = createMockResponse();

      await expect((controller as any).listSavedQueries(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('createSavedQuery', () => {
    it('creates a saved query and returns 201', async () => {
      service.create.mockResolvedValue(mockQuery);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId },
        body: createQueryBody,
      });
      (req as any).url = '/api/projects/proj_test001/analytics/saved-queries';
      (req as any).method = 'POST';
      const res = createMockResponse();

      await (controller as any).createSavedQuery(req, res);

      expect(service.create).toHaveBeenCalledWith(testProjectId, expect.objectContaining({ name: 'Test Query' }), testContext);
      expect((res as MockResponse).statusCode).toBe(201);
      expect((res as MockResponse).jsonBody).toBe(mockQuery);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, body: {} });
      (req as any).url = '/api/projects/proj_test001/analytics/saved-queries';
      (req as any).method = 'POST';
      const res = createMockResponse();

      await expect((controller as any).createSavedQuery(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking required permission', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: [] },
        params: { projectId: testProjectId },
        body: {},
      });
      (req as any).url = '/api/projects/proj_test001/analytics/saved-queries';
      (req as any).method = 'POST';
      const res = createMockResponse();

      await expect((controller as any).createSavedQuery(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('updateSavedQuery', () => {
    it('updates a saved query and returns 200', async () => {
      service.update.mockResolvedValue(mockQuery);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testQueryId },
        body: { name: 'Updated Query', version: 1 },
      });
      (req as any).url = '/api/projects/proj_test001/analytics/saved-queries/query_test001';
      (req as any).method = 'PUT';
      const res = createMockResponse();

      await (controller as any).updateSavedQuery(req, res);

      expect(service.update).toHaveBeenCalledWith(testQueryId, testProjectId, expect.objectContaining({ name: 'Updated Query' }), testContext);
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockQuery);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId, id: testQueryId }, body: {} });
      (req as any).url = '/api/projects/proj_test001/analytics/saved-queries/query_test001';
      (req as any).method = 'PUT';
      const res = createMockResponse();

      await expect((controller as any).updateSavedQuery(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking required permission', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: [] },
        params: { projectId: testProjectId, id: testQueryId },
        body: {},
      });
      (req as any).url = '/api/projects/proj_test001/analytics/saved-queries/query_test001';
      (req as any).method = 'PUT';
      const res = createMockResponse();

      await expect((controller as any).updateSavedQuery(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('deleteSavedQuery', () => {
    it('deletes a saved query and returns 204', async () => {
      service.delete.mockResolvedValue(undefined);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testQueryId },
        body: { version: 1 },
      });
      (req as any).url = '/api/projects/proj_test001/analytics/saved-queries/query_test001';
      (req as any).method = 'DELETE';
      const res = createMockResponse();

      await (controller as any).deleteSavedQuery(req, res);

      expect(service.delete).toHaveBeenCalledWith(testQueryId, testProjectId, 1, testContext);
      expect((res as MockResponse).statusCode).toBe(204);
      expect((res as MockResponse).sent).toBe(true);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId, id: testQueryId }, body: {} });
      (req as any).url = '/api/projects/proj_test001/analytics/saved-queries/query_test001';
      (req as any).method = 'DELETE';
      const res = createMockResponse();

      await expect((controller as any).deleteSavedQuery(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking required permission', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: [] },
        params: { projectId: testProjectId, id: testQueryId },
        body: {},
      });
      (req as any).url = '/api/projects/proj_test001/analytics/saved-queries/query_test001';
      (req as any).method = 'DELETE';
      const res = createMockResponse();

      await expect((controller as any).deleteSavedQuery(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('registerRoutes', () => {
    it('registers all saved slice query routes', () => {
      const mockRouter = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } as any;
      controller.registerRoutes(mockRouter);

      expect(mockRouter.get).toHaveBeenCalledWith('/api/projects/:projectId/analytics/saved-queries', expect.any(Function));
      expect(mockRouter.post).toHaveBeenCalledWith('/api/projects/:projectId/analytics/saved-queries', expect.any(Function));
      expect(mockRouter.put).toHaveBeenCalledWith('/api/projects/:projectId/analytics/saved-queries/:id', expect.any(Function));
      expect(mockRouter.delete).toHaveBeenCalledWith('/api/projects/:projectId/analytics/saved-queries/:id', expect.any(Function));
    });
  });

  describe('getOpenAPIPaths', () => {
    it('returns OpenAPI path definitions for all endpoints', () => {
      const paths = SavedSliceQueryController.getOpenAPIPaths();
      expect(paths.length).toBe(4);
      expect(paths.map((p) => p.method)).toEqual(['get', 'post', 'put', 'delete']);
      for (const path of paths) {
        expect(path.path.startsWith('/api/projects/{projectId}/analytics/saved-queries')).toBe(true);
        expect(path).toHaveProperty('method');
        expect(path).toHaveProperty('responses');
      }
    });
  });
});
