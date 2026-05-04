import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';
import { UnauthorizedError, ForbiddenError } from '../../src/errors';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { ScenarioRunController } from '../../src/http/controllers/ScenarioRunController';

const testProjectId = 'proj_test001';
const testRunId = 'srun_test001';
const testContext = {
  operatorId: 'oper_test001',
  roles: ['super_admin'],
  ip: '127.0.0.1',
  userAgent: 'test/1.0',
  requestId: 'req_test001',
  timestamp: new Date('2025-01-01T00:00:00Z'),
};

const mockRun = {
  id: testRunId,
  projectId: testProjectId,
  scenarioId: 'scen_test001',
  testers: { tester_001: 3, tester_002: 2 },
  totalConversations: 5,
  status: 'queued' as const,
  statusDetails: null,
  metadata: null,
  version: 1,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

const createRunBody = {
  scenarioId: 'scen_test001',
  testers: { tester_001: 3, tester_002: 2 },
};

describe('ScenarioRunController', () => {
  let controller: ScenarioRunController;
  let scenarioRunService: any;
  let executorService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    scenarioRunService = {
      createScenarioRun: vi.fn(),
      getScenarioRunById: vi.fn(),
      listScenarioRuns: vi.fn(),
      cancelScenarioRun: vi.fn(),
      deleteScenarioRun: vi.fn(),
    };
    executorService = {
      notifyNewRun: vi.fn(),
      signalCancel: vi.fn(),
      enable: vi.fn(),
      disable: vi.fn(),
      getStatus: vi.fn().mockReturnValue({ enabled: true }),
    };
    controller = new ScenarioRunController(scenarioRunService, executorService);
  });

  describe('createScenarioRun', () => {
    it('creates a scenario run and returns 201', async () => {
      scenarioRunService.createScenarioRun.mockResolvedValue(mockRun);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId },
        body: createRunBody,
      });
      (req as any).url = '/api/projects/proj_test001/scenario-runs';
      (req as any).method = 'POST';
      const res = createMockResponse();

      await (controller as any).createScenarioRun(req, res);

      expect(scenarioRunService.createScenarioRun).toHaveBeenCalledWith(testProjectId, expect.objectContaining({ scenarioId: 'scen_test001' }), testContext);
      expect(executorService.notifyNewRun).toHaveBeenCalled();
      expect((res as MockResponse).statusCode).toBe(201);
      expect((res as MockResponse).jsonBody).toBe(mockRun);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, body: {} });
      (req as any).url = '/api/projects/proj_test001/scenario-runs';
      (req as any).method = 'POST';
      const res = createMockResponse();

      await expect((controller as any).createScenarioRun(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking SCENARIO_RUN_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: [] },
        params: { projectId: testProjectId },
        body: {},
      });
      (req as any).url = '/api/projects/proj_test001/scenario-runs';
      (req as any).method = 'POST';
      const res = createMockResponse();

      await expect((controller as any).createScenarioRun(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('listScenarioRuns', () => {
    it('returns paginated scenario runs with 200', async () => {
      const mockList = { items: [mockRun], total: 1, offset: 0, limit: 25 };
      scenarioRunService.listScenarioRuns.mockResolvedValue(mockList);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId },
        query: {},
      });
      (req as any).url = '/api/projects/proj_test001/scenario-runs';
      (req as any).method = 'GET';
      const res = createMockResponse();

      await (controller as any).listScenarioRuns(req, res);

      expect(scenarioRunService.listScenarioRuns).toHaveBeenCalledWith(testProjectId, expect.any(Object));
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockList);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, query: {} });
      (req as any).url = '/api/projects/proj_test001/scenario-runs';
      (req as any).method = 'GET';
      const res = createMockResponse();

      await expect((controller as any).listScenarioRuns(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking SCENARIO_RUN_READ', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: [] },
        params: { projectId: testProjectId },
        query: {},
      });
      (req as any).url = '/api/projects/proj_test001/scenario-runs';
      (req as any).method = 'GET';
      const res = createMockResponse();

      await expect((controller as any).listScenarioRuns(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getScenarioRunById', () => {
    it('returns a scenario run with 200', async () => {
      scenarioRunService.getScenarioRunById.mockResolvedValue(mockRun);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testRunId },
      });
      (req as any).url = '/api/projects/proj_test001/scenario-runs/srun_test001';
      (req as any).method = 'GET';
      const res = createMockResponse();

      await (controller as any).getScenarioRunById(req, res);

      expect(scenarioRunService.getScenarioRunById).toHaveBeenCalledWith(testProjectId, testRunId);
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockRun);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId, id: testRunId } });
      (req as any).url = '/api/projects/proj_test001/scenario-runs/srun_test001';
      (req as any).method = 'GET';
      const res = createMockResponse();

      await expect((controller as any).getScenarioRunById(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('cancelScenarioRun', () => {
    it('cancels a scenario run and returns 200', async () => {
      const cancelledRun = { ...mockRun, status: 'cancelled' as const, statusDetails: 'Cancelled by oper_test001' };
      scenarioRunService.cancelScenarioRun.mockResolvedValue(cancelledRun);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testRunId },
      });
      (req as any).url = '/api/projects/proj_test001/scenario-runs/srun_test001/cancel';
      (req as any).method = 'POST';
      const res = createMockResponse();

      await (controller as any).cancelScenarioRun(req, res);

      expect(scenarioRunService.cancelScenarioRun).toHaveBeenCalledWith(testRunId, testProjectId, testContext.operatorId);
      expect(executorService.signalCancel).toHaveBeenCalledWith(testRunId);
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws ForbiddenError when lacking SCENARIO_RUN_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: [] },
        params: { projectId: testProjectId, id: testRunId },
      });
      (req as any).url = '/api/projects/proj_test001/scenario-runs/srun_test001/cancel';
      (req as any).method = 'POST';
      const res = createMockResponse();

      await expect((controller as any).cancelScenarioRun(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('deleteScenarioRun', () => {
    it('deletes a scenario run and returns 204', async () => {
      scenarioRunService.deleteScenarioRun.mockResolvedValue(undefined);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testRunId },
      });
      (req as any).url = '/api/projects/proj_test001/scenario-runs/srun_test001';
      (req as any).method = 'DELETE';
      const res = createMockResponse();

      await (controller as any).deleteScenarioRun(req, res);

      expect(scenarioRunService.deleteScenarioRun).toHaveBeenCalledWith(testRunId, testProjectId);
      expect((res as MockResponse).statusCode).toBe(204);
      expect((res as MockResponse).sent).toBe(true);
    });

    it('throws ForbiddenError when lacking SCENARIO_RUN_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: [] },
        params: { projectId: testProjectId, id: testRunId },
      });
      (req as any).url = '/api/projects/proj_test001/scenario-runs/srun_test001';
      (req as any).method = 'DELETE';
      const res = createMockResponse();

      await expect((controller as any).deleteScenarioRun(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getSchedulerStatus', () => {
    it('returns scheduler status with 200', async () => {
      const status = { enabled: true };
      executorService.getStatus.mockReturnValue(status);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
      });
      (req as any).url = '/api/scenario-runs/scheduler';
      (req as any).method = 'GET';
      const res = createMockResponse();

      await (controller as any).getSchedulerStatus(req, res);

      expect(executorService.getStatus).toHaveBeenCalled();
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(status);
    });

    it('throws ForbiddenError when lacking SYSTEM_CONFIG', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: [] },
      });
      (req as any).url = '/api/scenario-runs/scheduler';
      (req as any).method = 'GET';
      const res = createMockResponse();

      await expect((controller as any).getSchedulerStatus(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('updateSchedulerStatus', () => {
    it('enables scheduler when enabled is true', async () => {
      executorService.getStatus.mockReturnValue({ enabled: true });
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        body: { enabled: true },
      });
      (req as any).url = '/api/scenario-runs/scheduler';
      (req as any).method = 'PUT';
      const res = createMockResponse();

      await (controller as any).updateSchedulerStatus(req, res);

      expect(executorService.enable).toHaveBeenCalled();
      expect(executorService.disable).not.toHaveBeenCalled();
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('disables scheduler when enabled is false', async () => {
      executorService.getStatus.mockReturnValue({ enabled: false });
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        body: { enabled: false },
      });
      (req as any).url = '/api/scenario-runs/scheduler';
      (req as any).method = 'PUT';
      const res = createMockResponse();

      await (controller as any).updateSchedulerStatus(req, res);

      expect(executorService.disable).toHaveBeenCalled();
      expect(executorService.enable).not.toHaveBeenCalled();
    });
  });

  describe('registerRoutes', () => {
    it('registers all scenario run routes', () => {
      const mockRouter = { post: vi.fn(), get: vi.fn(), put: vi.fn(), delete: vi.fn() } as any;
      controller.registerRoutes(mockRouter);

      expect(mockRouter.post).toHaveBeenCalledTimes(2);
      expect(mockRouter.get).toHaveBeenCalledTimes(3);
      expect(mockRouter.delete).toHaveBeenCalledTimes(1);
      expect(mockRouter.put).toHaveBeenCalledTimes(1);
    });
  });

  describe('getOpenAPIPaths', () => {
    it('returns OpenAPI path definitions for all endpoints', () => {
      const paths = ScenarioRunController.getOpenAPIPaths();
      expect(paths.length).toBe(7);
      for (const path of paths) {
        expect(path).toHaveProperty('path');
        expect(path.path.startsWith('/api/')).toBe(true);
        expect(path).toHaveProperty('method');
      }
    });
  });
});
