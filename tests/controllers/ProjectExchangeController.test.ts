import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';
import { UnauthorizedError, ForbiddenError } from '../../src/errors';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { ProjectExchangeController } from '../../src/http/controllers/ProjectExchangeController';

const testProjectId = 'proj_test001';
const testContext = {
  operatorId: 'oper_test001',
  roles: ['super_admin'],
  ip: '127.0.0.1',
  userAgent: 'test/1.0',
  requestId: 'req_test001',
  timestamp: new Date('2025-01-01T00:00:00Z'),
};

describe('ProjectExchangeController', () => {
  let controller: ProjectExchangeController;
  let exchangeService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    exchangeService = {
      exportProject: vi.fn(),
      importProject: vi.fn(),
    };
    controller = new ProjectExchangeController(exchangeService);
  });

  describe('exportProject', () => {
    it('returns export bundle with 200', async () => {
      const mockBundle = { version: '1.0', project: { id: testProjectId, name: 'Test Project' }, entities: {} };
      exchangeService.exportProject.mockResolvedValue(mockBundle);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { id: testProjectId },
      });
      const res = createMockResponse();

      await (controller as any).exportProject(req, res);

      expect(exchangeService.exportProject).toHaveBeenCalledWith(testProjectId, testContext);
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { id: testProjectId } });
      (req as any).url = '/api/projects/test/export';
      (req as any).method = 'GET';
      const res = createMockResponse();

      await expect((controller as any).exportProject(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking PROJECT_READ', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: [] },
        params: { id: testProjectId },
      });
      (req as any).url = '/api/projects/test/export';
      (req as any).method = 'GET';
      const res = createMockResponse();

      await expect((controller as any).exportProject(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('importProject', () => {
    it('imports project and returns result with 201', async () => {
      const mockResult = { projectId: 'proj_new001', entitiesCreated: 5 };
      exchangeService.importProject.mockResolvedValue(mockResult);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        body: {
        formatVersion: 1,
        exportedAt: '2025-01-01T00:00:00.000Z',
        project: { id: 'proj_bundle001', name: 'Imported Project' },
        agents: [],
        stages: [],
        classifiers: [],
        contextTransformers: [],
        tools: [],
        globalActions: [],
        guardrails: [],
        knowledgeCategories: [],
        knowledgeItems: [],
      },
      });
      const res = createMockResponse();

      await (controller as any).importProject(req, res);

      expect(exchangeService.importProject).toHaveBeenCalledWith(expect.any(Object), testContext);
      expect((res as MockResponse).statusCode).toBe(201);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, body: {} });
      (req as any).url = '/api/projects/import';
      (req as any).method = 'POST';
      const res = createMockResponse();

      await expect((controller as any).importProject(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('registerRoutes', () => {
    it('registers all project exchange routes', () => {
      const mockRouter = { get: vi.fn(), post: vi.fn() } as any;
      controller.registerRoutes(mockRouter);

      expect(mockRouter.get).toHaveBeenCalledTimes(1);
      expect(mockRouter.post).toHaveBeenCalledTimes(1);
    });
  });

  describe('getOpenAPIPaths', () => {
    it('returns OpenAPI path definitions for all endpoints', () => {
      const paths = ProjectExchangeController.getOpenAPIPaths();
      expect(paths.length).toBe(2);
      for (const path of paths) {
        expect(path).toHaveProperty('path');
        expect(path.path.startsWith('/api/projects/')).toBe(true);
        expect(path).toHaveProperty('method');
      }
    });
  });
});
