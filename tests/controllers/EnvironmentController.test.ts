import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';
import { UnauthorizedError, ForbiddenError, NotFoundError } from '../../src/errors';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { EnvironmentController } from '../../src/http/controllers/EnvironmentController';

const testEnvId = 'env_test001';
const testJobId = 'job_test001';
const testContext = {
  operatorId: 'oper_test001',
  roles: ['super_admin'],
  ip: '127.0.0.1',
  userAgent: 'test/1.0',
  requestId: 'req_test001',
  timestamp: new Date('2025-01-01T00:00:00Z'),
};

const mockEnvironment = {
  id: testEnvId,
  description: 'Test Environment',
  url: 'https://example.com',
  login: 'admin',
  version: 1,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

const createEnvBody = {
  description: 'Test Environment',
  url: 'https://example.com',
  login: 'admin',
  password: 'secret123',
};

describe('EnvironmentController', () => {
  let controller: EnvironmentController;
  let envService: any;
  let migrationService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    envService = {
      createEnvironment: vi.fn(),
      getEnvironmentById: vi.fn(),
      listEnvironments: vi.fn(),
      updateEnvironment: vi.fn(),
      deleteEnvironment: vi.fn(),
      getEnvironmentAuditLogs: vi.fn(),
    };
    migrationService = {
      startPull: vi.fn(),
      getJob: vi.fn(),
      previewRemote: vi.fn(),
    };
    controller = new EnvironmentController(envService, migrationService);
  });

  describe('createEnvironment', () => {
    it('creates an environment and returns 201', async () => {
      envService.createEnvironment.mockResolvedValue(mockEnvironment);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        body: createEnvBody,
      });
      const res = createMockResponse();

      await (controller as any).createEnvironment(req, res);

      expect(envService.createEnvironment).toHaveBeenCalledWith(expect.objectContaining({ description: 'Test Environment' }), testContext);
      expect((res as MockResponse).statusCode).toBe(201);
      expect((res as MockResponse).jsonBody).toBe(mockEnvironment);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, body: {} });
      const res = createMockResponse();

      await expect((controller as any).createEnvironment(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking ENVIRONMENT_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).createEnvironment(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getEnvironmentById', () => {
    it('returns an environment with 200', async () => {
      envService.getEnvironmentById.mockResolvedValue(mockEnvironment);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { id: testEnvId },
      });
      const res = createMockResponse();

      await (controller as any).getEnvironmentById(req, res);

      expect(envService.getEnvironmentById).toHaveBeenCalledWith(testEnvId);
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { id: testEnvId } });
      const res = createMockResponse();

      await expect((controller as any).getEnvironmentById(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('listEnvironments', () => {
    it('returns paginated environments with 200', async () => {
      const mockList = { items: [mockEnvironment], total: 1, offset: 0, limit: 25 };
      envService.listEnvironments.mockResolvedValue(mockList);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        query: {},
      });
      const res = createMockResponse();

      await (controller as any).listEnvironments(req, res);

      expect(envService.listEnvironments).toHaveBeenCalledWith(expect.any(Object));
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, query: {} });
      const res = createMockResponse();

      await expect((controller as any).listEnvironments(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('updateEnvironment', () => {
    it('updates an environment and returns 200', async () => {
      const updated = { ...mockEnvironment, description: 'Updated' };
      envService.updateEnvironment.mockResolvedValue(updated);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { id: testEnvId },
        body: { description: 'Updated', version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).updateEnvironment(req, res);

      expect(envService.updateEnvironment).toHaveBeenCalledWith(
        testEnvId,
        expect.objectContaining({ description: 'Updated', version: 1 }),
        testContext,
      );
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws ForbiddenError when lacking ENVIRONMENT_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { id: testEnvId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).updateEnvironment(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('deleteEnvironment', () => {
    it('deletes an environment and returns 204', async () => {
      envService.deleteEnvironment.mockResolvedValue(undefined);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { id: testEnvId },
        body: { version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).deleteEnvironment(req, res);

      expect(envService.deleteEnvironment).toHaveBeenCalledWith(testEnvId, 1, testContext);
      expect((res as MockResponse).statusCode).toBe(204);
    });

    it('throws ForbiddenError when lacking ENVIRONMENT_DELETE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { id: testEnvId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).deleteEnvironment(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getEnvironmentAuditLogs', () => {
    it('returns audit logs with 200', async () => {
      const mockLogs = [{ id: 'log1', action: 'create' }];
      envService.getEnvironmentAuditLogs.mockResolvedValue(mockLogs);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { id: testEnvId },
      });
      const res = createMockResponse();

      await (controller as any).getEnvironmentAuditLogs(req, res);

      expect(envService.getEnvironmentAuditLogs).toHaveBeenCalledWith(testEnvId);
      expect((res as MockResponse).statusCode).toBe(200);
    });
  });

  describe('startPull', () => {
    it('starts a pull job and returns 202', async () => {
      migrationService.startPull.mockResolvedValue(testJobId);
      const mockJob = { id: testJobId, status: 'pending', environmentId: testEnvId };
      migrationService.getJob.mockReturnValue(mockJob);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { id: testEnvId },
        body: {},
      });
      const res = createMockResponse();

      await (controller as any).startPull(req, res);

      expect(migrationService.startPull).toHaveBeenCalledWith(testEnvId, expect.any(Object), testContext);
      expect(migrationService.getJob).toHaveBeenCalledWith(testJobId);
      expect((res as MockResponse).statusCode).toBe(202);
    });

    it('throws ForbiddenError when lacking MIGRATION_IMPORT', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { id: testEnvId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).startPull(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getJob', () => {
    it('returns job status with 200', async () => {
      const mockJob = { id: testJobId, status: 'completed', environmentId: testEnvId };
      migrationService.getJob.mockReturnValue(mockJob);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { id: testEnvId, jobId: testJobId },
      });
      const res = createMockResponse();

      await (controller as any).getJob(req, res);

      expect(migrationService.getJob).toHaveBeenCalledWith(testJobId);
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws NotFoundError when job does not belong to environment', async () => {
      migrationService.getJob.mockReturnValue({ id: testJobId, environmentId: 'other_env' });
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { id: testEnvId, jobId: testJobId },
      });
      const res = createMockResponse();

      await expect((controller as any).getJob(req, res)).rejects.toThrow(NotFoundError);
    });

    it('throws NotFoundError when job is not found', async () => {
      migrationService.getJob.mockReturnValue(undefined);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { id: testEnvId, jobId: testJobId },
      });
      const res = createMockResponse();

      await expect((controller as any).getJob(req, res)).rejects.toThrow(NotFoundError);
    });
  });

  describe('previewScope', () => {
    it('returns preview scope with 200', async () => {
      const mockPreview = { totalCount: 5, projects: [] };
      migrationService.previewRemote.mockResolvedValue(mockPreview);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { id: testEnvId },
        query: {},
      });
      const res = createMockResponse();

      await (controller as any).previewScope(req, res);

      expect(migrationService.previewRemote).toHaveBeenCalledWith(testEnvId, expect.any(Object), testContext);
      expect((res as MockResponse).statusCode).toBe(200);
    });
  });

  describe('registerRoutes', () => {
    it('registers all environment routes', () => {
      const mockRouter = { post: vi.fn(), get: vi.fn(), put: vi.fn(), delete: vi.fn() } as any;
      controller.registerRoutes(mockRouter);

      expect(mockRouter.post).toHaveBeenCalledTimes(1);
      expect(mockRouter.get).toHaveBeenCalledTimes(5);
      expect(mockRouter.put).toHaveBeenCalledTimes(1);
      expect(mockRouter.delete).toHaveBeenCalledTimes(1);
    });
  });

  describe('getOpenAPIPaths', () => {
    it('returns OpenAPI path definitions for all endpoints', () => {
      const paths = EnvironmentController.getOpenAPIPaths();
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path).toHaveProperty('path');
        expect(path.path.startsWith('/api/environments')).toBe(true);
        expect(path).toHaveProperty('method');
      }
    });
  });
});
