import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';
import { UnauthorizedError, ForbiddenError } from '../../src/errors';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { ScenarioConversationController } from '../../src/http/controllers/ScenarioConversationController';

const testProjectId = 'proj_test001';
const testConvId = 'sconv_test001';

const mockConversation = {
  id: testConvId,
  projectId: testProjectId,
  scenarioRunId: 'srun_test001',
  status: 'completed' as const,
  conversationId: null,
  results: null,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

describe('ScenarioConversationController', () => {
  let controller: ScenarioConversationController;
  let service: any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = {
      getScenarioConversationById: vi.fn(),
      listScenarioConversations: vi.fn(),
    };
    controller = new ScenarioConversationController(service);
  });

  describe('listScenarioConversations', () => {
    it('returns paginated scenario conversations with 200', async () => {
      const mockList = { items: [mockConversation], total: 1, offset: 0, limit: 25 };
      service.listScenarioConversations.mockResolvedValue(mockList);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId },
        query: {},
      });
      (req as any).url = '/api/projects/proj_test001/scenario-conversations';
      (req as any).method = 'GET';
      const res = createMockResponse();

      await (controller as any).listScenarioConversations(req, res);

      expect(service.listScenarioConversations).toHaveBeenCalledWith(testProjectId, expect.any(Object));
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockList);
    });

    it('returns conversations filtered by scenarioRunId', async () => {
      const mockList = { items: [mockConversation], total: 1, offset: 0, limit: 25 };
      service.listScenarioConversations.mockResolvedValue(mockList);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId },
        query: { scenarioRunId: 'srun_test001' },
      });
      (req as any).url = '/api/projects/proj_test001/scenario-conversations';
      (req as any).method = 'GET';
      const res = createMockResponse();

      await (controller as any).listScenarioConversations(req, res);

      expect(service.listScenarioConversations).toHaveBeenCalled();
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, query: {} });
      (req as any).url = '/api/projects/proj_test001/scenario-conversations';
      (req as any).method = 'GET';
      const res = createMockResponse();

      await expect((controller as any).listScenarioConversations(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking SCENARIO_RUN_READ', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: [] },
        params: { projectId: testProjectId },
        query: {},
      });
      (req as any).url = '/api/projects/proj_test001/scenario-conversations';
      (req as any).method = 'GET';
      const res = createMockResponse();

      await expect((controller as any).listScenarioConversations(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getScenarioConversationById', () => {
    it('returns a scenario conversation with 200', async () => {
      service.getScenarioConversationById.mockResolvedValue(mockConversation);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testConvId },
      });
      (req as any).url = '/api/projects/proj_test001/scenario-conversations/sconv_test001';
      (req as any).method = 'GET';
      const res = createMockResponse();

      await (controller as any).getScenarioConversationById(req, res);

      expect(service.getScenarioConversationById).toHaveBeenCalledWith(testProjectId, testConvId);
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockConversation);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId, id: testConvId } });
      (req as any).url = '/api/projects/proj_test001/scenario-conversations/sconv_test001';
      (req as any).method = 'GET';
      const res = createMockResponse();

      await expect((controller as any).getScenarioConversationById(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking SCENARIO_RUN_READ', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: [] },
        params: { projectId: testProjectId, id: testConvId },
      });
      (req as any).url = '/api/projects/proj_test001/scenario-conversations/sconv_test001';
      (req as any).method = 'GET';
      const res = createMockResponse();

      await expect((controller as any).getScenarioConversationById(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('registerRoutes', () => {
    it('registers all scenario conversation routes', () => {
      const mockRouter = { get: vi.fn(), post: vi.fn() } as any;
      controller.registerRoutes(mockRouter);

      expect(mockRouter.get).toHaveBeenCalledTimes(2);
      expect(mockRouter.post).not.toHaveBeenCalled();
    });
  });

  describe('getOpenAPIPaths', () => {
    it('returns OpenAPI path definitions for all endpoints', () => {
      const paths = ScenarioConversationController.getOpenAPIPaths();
      expect(paths.length).toBe(2);
      for (const path of paths) {
        expect(path).toHaveProperty('path');
        expect(path.path.startsWith('/api/projects/{projectId}/scenario-conversations')).toBe(true);
        expect(path).toHaveProperty('method');
      }
    });
  });
});
