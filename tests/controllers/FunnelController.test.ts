import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';
import { UnauthorizedError, ForbiddenError } from '../../src/errors';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { FunnelController } from '../../src/http/controllers/FunnelController';

const testProjectId = 'proj_test001';
const testQueryId = 'funnelquery_test001';
const testContext = {
  operatorId: 'oper_test001',
  roles: ['super_admin'],
  ip: '127.0.0.1',
  userAgent: 'test/1.0',
  requestId: 'req_test001',
  timestamp: new Date('2025-01-01T00:00:00Z'),
};

const mockFunnelResult = {
  steps: [
    { name: 'Step 1', userCount: 100, conversionRate: 1.0 },
    { name: 'Step 2', userCount: 80, conversionRate: 0.8 },
  ],
  totalUsers: 100,
};

const mockSavedQuery = {
  id: testQueryId,
  projectId: testProjectId,
  name: 'Test Funnel Query',
  query: { steps: [{ eventName: 'page_view' }] },
  createdBy: 'oper_test001',
  isShared: false,
  version: 1,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

const funnelRequestBody = {
  steps: [
    { eventType: 'enter_stage', params: { stageName: 'Welcome' } },
    { eventType: 'end_stage', params: { stageName: 'Welcome' } },
  ],
};

const createSavedQueryBody = {
  name: 'Test Funnel Query',
  query: {
    steps: [
      { eventType: 'enter_stage', params: { stageName: 'Welcome' } },
      { eventType: 'end_stage', params: { stageName: 'Welcome' } },
    ],
  },
  isShared: false,
};

describe('FunnelController', () => {
  let controller: FunnelController;
  let funnelQueryService: any;
  let savedFunnelQueryService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    funnelQueryService = {
      runQuery: vi.fn(),
    };
    savedFunnelQueryService = {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    controller = new FunnelController(funnelQueryService, savedFunnelQueryService);
  });

  describe('runFunnelQuery', () => {
    it('runs a funnel query and returns 200', async () => {
      funnelQueryService.runQuery.mockResolvedValue(mockFunnelResult);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: {},
        query: { projectId: testProjectId },
        body: funnelRequestBody,
      });
      (req as any).url = '/api/projects/proj_test001/analytics/funnels/query';
      (req as any).method = 'POST';
      const res = createMockResponse();

      await (controller as any).runFunnelQuery(req, res);

      expect(funnelQueryService.runQuery).toHaveBeenCalledWith(testProjectId, expect.objectContaining({ steps: expect.any(Array) }), testContext, undefined);
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockFunnelResult);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, query: {}, body: {} });
      (req as any).url = '/api/projects/proj_test001/analytics/funnels/query';
      (req as any).method = 'POST';
      const res = createMockResponse();

      await expect((controller as any).runFunnelQuery(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking required permission', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: [] },
        params: { projectId: testProjectId },
        query: {},
        body: {},
      });
      (req as any).url = '/api/projects/proj_test001/analytics/funnels/query';
      (req as any).method = 'POST';
      const res = createMockResponse();

      await expect((controller as any).runFunnelQuery(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('listSavedQueries', () => {
    it('returns saved funnel queries with 200', async () => {
      const mockList = [mockSavedQuery];
      savedFunnelQueryService.list.mockResolvedValue(mockList);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId },
      });
      (req as any).url = '/api/projects/proj_test001/analytics/funnels/saved-queries';
      (req as any).method = 'GET';
      const res = createMockResponse();

      await (controller as any).listSavedQueries(req, res);

      expect(savedFunnelQueryService.list).toHaveBeenCalledWith(testProjectId, testContext);
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockList);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId } });
      (req as any).url = '/api/projects/proj_test001/analytics/funnels/saved-queries';
      (req as any).method = 'GET';
      const res = createMockResponse();

      await expect((controller as any).listSavedQueries(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking required permission', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: [] },
        params: { projectId: testProjectId },
      });
      (req as any).url = '/api/projects/proj_test001/analytics/funnels/saved-queries';
      (req as any).method = 'GET';
      const res = createMockResponse();

      await expect((controller as any).listSavedQueries(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('createSavedQuery', () => {
    it('creates a saved funnel query and returns 201', async () => {
      savedFunnelQueryService.create.mockResolvedValue(mockSavedQuery);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId },
        body: createSavedQueryBody,
      });
      (req as any).url = '/api/projects/proj_test001/analytics/funnels/saved-queries';
      (req as any).method = 'POST';
      const res = createMockResponse();

      await (controller as any).createSavedQuery(req, res);

      expect(savedFunnelQueryService.create).toHaveBeenCalledWith(testProjectId, expect.objectContaining({ name: 'Test Funnel Query' }), testContext);
      expect((res as MockResponse).statusCode).toBe(201);
      expect((res as MockResponse).jsonBody).toBe(mockSavedQuery);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, body: {} });
      (req as any).url = '/api/projects/proj_test001/analytics/funnels/saved-queries';
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
      (req as any).url = '/api/projects/proj_test001/analytics/funnels/saved-queries';
      (req as any).method = 'POST';
      const res = createMockResponse();

      await expect((controller as any).createSavedQuery(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('updateSavedQuery', () => {
    it('updates a saved funnel query and returns 200', async () => {
      savedFunnelQueryService.update.mockResolvedValue(mockSavedQuery);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testQueryId },
        body: { name: 'Updated Funnel Query', version: 1 },
      });
      (req as any).url = '/api/projects/proj_test001/analytics/funnels/saved-queries/funnelquery_test001';
      (req as any).method = 'PUT';
      const res = createMockResponse();

      await (controller as any).updateSavedQuery(req, res);

      expect(savedFunnelQueryService.update).toHaveBeenCalledWith(testQueryId, testProjectId, expect.objectContaining({ name: 'Updated Funnel Query' }), testContext);
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockSavedQuery);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId, id: testQueryId }, body: {} });
      (req as any).url = '/api/projects/proj_test001/analytics/funnels/saved-queries/funnelquery_test001';
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
      (req as any).url = '/api/projects/proj_test001/analytics/funnels/saved-queries/funnelquery_test001';
      (req as any).method = 'PUT';
      const res = createMockResponse();

      await expect((controller as any).updateSavedQuery(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('deleteSavedQuery', () => {
    it('deletes a saved funnel query and returns 204', async () => {
      savedFunnelQueryService.delete.mockResolvedValue(undefined);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testQueryId },
        body: { version: 1 },
      });
      (req as any).url = '/api/projects/proj_test001/analytics/funnels/saved-queries/funnelquery_test001';
      (req as any).method = 'DELETE';
      const res = createMockResponse();

      await (controller as any).deleteSavedQuery(req, res);

      expect(savedFunnelQueryService.delete).toHaveBeenCalledWith(testQueryId, testProjectId, 1, testContext);
      expect((res as MockResponse).statusCode).toBe(204);
      expect((res as MockResponse).sent).toBe(true);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId, id: testQueryId }, body: {} });
      (req as any).url = '/api/projects/proj_test001/analytics/funnels/saved-queries/funnelquery_test001';
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
      (req as any).url = '/api/projects/proj_test001/analytics/funnels/saved-queries/funnelquery_test001';
      (req as any).method = 'DELETE';
      const res = createMockResponse();

      await expect((controller as any).deleteSavedQuery(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('registerRoutes', () => {
    it('registers all funnel routes', () => {
      const mockRouter = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } as any;
      controller.registerRoutes(mockRouter);

      expect(mockRouter.post).toHaveBeenCalledWith('/api/projects/:projectId/analytics/funnels/query', expect.any(Function));
      expect(mockRouter.get).toHaveBeenCalledWith('/api/projects/:projectId/analytics/funnels/saved-queries', expect.any(Function));
      expect(mockRouter.post).toHaveBeenCalledWith('/api/projects/:projectId/analytics/funnels/saved-queries', expect.any(Function));
      expect(mockRouter.put).toHaveBeenCalledWith('/api/projects/:projectId/analytics/funnels/saved-queries/:id', expect.any(Function));
      expect(mockRouter.delete).toHaveBeenCalledWith('/api/projects/:projectId/analytics/funnels/saved-queries/:id', expect.any(Function));
    });
  });

  describe('getOpenAPIPaths', () => {
    it('returns OpenAPI path definitions for all endpoints', () => {
      const paths = FunnelController.getOpenAPIPaths();
      expect(paths.length).toBe(5);
      expect(paths.map((p) => p.method)).toEqual(['post', 'get', 'post', 'put', 'delete']);
      for (const path of paths) {
        expect(path.path.startsWith('/api/projects/{projectId}/analytics/funnels')).toBe(true);
        expect(path).toHaveProperty('method');
        expect(path).toHaveProperty('responses');
      }
    });
  });
});
