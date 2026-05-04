import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';
import { UnauthorizedError, ForbiddenError } from '../../src/errors';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { ScenarioController } from '../../src/http/controllers/ScenarioController';

const testProjectId = 'proj_test001';
const testScenarioId = 'scen_test001';
const testContext = {
  operatorId: 'oper_test001',
  roles: ['super_admin'],
  ip: '127.0.0.1',
  userAgent: 'test/1.0',
  requestId: 'req_test001',
  timestamp: new Date('2025-01-01T00:00:00Z'),
};

const mockScenario = {
  id: testScenarioId,
  projectId: testProjectId,
  name: 'Test Scenario',
  description: 'A test scenario',
  language: 'en-US',
  startingStageId: 'stage_001',
  maxTurns: 10,
  endingStageIds: ['stage_end'],
  personaCanHangUp: false,
  conversationOpener: null,
  dataExtraction: null,
  contextTransformerId: null,
  dataPostProcessingExpected: null,
  tags: [],
  metadata: null,
  version: 1,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

const createScenarioBody = {
  name: 'Test Scenario',
  language: 'en-US',
  startingStageId: 'stage_001',
  maxTurns: 10,
};

describe('ScenarioController', () => {
  let controller: ScenarioController;
  let service: any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = {
      createScenario: vi.fn(),
      getScenarioById: vi.fn(),
      listScenarios: vi.fn(),
      updateScenario: vi.fn(),
      deleteScenario: vi.fn(),
      getScenarioAuditLogs: vi.fn(),
    };
    controller = new ScenarioController(service);
  });

  describe('createScenario', () => {
    it('creates a scenario and returns 201', async () => {
      service.createScenario.mockResolvedValue(mockScenario);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId },
        body: createScenarioBody,
      });
      const res = createMockResponse();

      await (controller as any).createScenario(req, res);

      expect(service.createScenario).toHaveBeenCalledWith(testProjectId, expect.objectContaining({ name: 'Test Scenario' }), testContext);
      expect((res as MockResponse).statusCode).toBe(201);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, body: {} });
      const res = createMockResponse();

      await expect((controller as any).createScenario(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking SCENARIO_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).createScenario(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getScenarioById', () => {
    it('returns a scenario with 200', async () => {
      service.getScenarioById.mockResolvedValue(mockScenario);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testScenarioId },
      });
      const res = createMockResponse();

      await (controller as any).getScenarioById(req, res);

      expect(service.getScenarioById).toHaveBeenCalledWith(testProjectId, testScenarioId);
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId, id: testScenarioId } });
      const res = createMockResponse();

      await expect((controller as any).getScenarioById(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('listScenarios', () => {
    it('returns paginated scenarios with 200', async () => {
      const mockList = { items: [mockScenario], total: 1, offset: 0, limit: 25 };
      service.listScenarios.mockResolvedValue(mockList);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId },
        query: {},
      });
      const res = createMockResponse();

      await (controller as any).listScenarios(req, res);

      expect(service.listScenarios).toHaveBeenCalledWith(testProjectId, expect.any(Object));
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, query: {} });
      const res = createMockResponse();

      await expect((controller as any).listScenarios(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('updateScenario', () => {
    it('updates a scenario and returns 200', async () => {
      const updated = { ...mockScenario, name: 'Updated Scenario' };
      service.updateScenario.mockResolvedValue(updated);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testScenarioId },
        body: { name: 'Updated Scenario', version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).updateScenario(req, res);

      expect(service.updateScenario).toHaveBeenCalledWith(
        testProjectId,
        testScenarioId,
        expect.objectContaining({ name: 'Updated Scenario', version: 1 }),
        testContext,
      );
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws ForbiddenError when lacking SCENARIO_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testScenarioId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).updateScenario(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('deleteScenario', () => {
    it('deletes a scenario and returns 204', async () => {
      service.deleteScenario.mockResolvedValue(undefined);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testScenarioId },
        body: { version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).deleteScenario(req, res);

      expect(service.deleteScenario).toHaveBeenCalledWith(testProjectId, testScenarioId, 1, testContext);
      expect((res as MockResponse).statusCode).toBe(204);
    });

    it('throws ForbiddenError when lacking SCENARIO_DELETE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testScenarioId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).deleteScenario(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getScenarioAuditLogs', () => {
    it('returns audit logs with 200', async () => {
      const mockLogs = [{ id: 'log1', action: 'create' }];
      service.getScenarioAuditLogs.mockResolvedValue(mockLogs);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testScenarioId },
      });
      const res = createMockResponse();

      await (controller as any).getScenarioAuditLogs(req, res);

      expect(service.getScenarioAuditLogs).toHaveBeenCalledWith(testScenarioId, testProjectId);
      expect((res as MockResponse).statusCode).toBe(200);
    });
  });

  describe('registerRoutes', () => {
    it('registers all scenario routes', () => {
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
      const paths = ScenarioController.getOpenAPIPaths();
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path).toHaveProperty('path');
        expect(path.path.startsWith('/api/projects/{projectId}/scenarios')).toBe(true);
        expect(path).toHaveProperty('method');
      }
    });
  });
});
