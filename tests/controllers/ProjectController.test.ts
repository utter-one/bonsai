import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';
import { UnauthorizedError, ForbiddenError } from '../../src/errors';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { ProjectController } from '../../src/http/controllers/ProjectController';

const testProjectId = 'proj_test001';
const testContext = {
  operatorId: 'oper_test001',
  roles: ['super_admin'],
  ip: '127.0.0.1',
  userAgent: 'test/1.0',
  requestId: 'req_test001',
  timestamp: new Date('2025-01-01T00:00:00Z'),
};

const mockProject = {
  id: testProjectId,
  name: 'Test Project',
  description: null,
  version: 1,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
  archivedAt: null,
  archivedBy: null,
};

const createProjectBody = {
  name: 'Test Project',
};

describe('ProjectController', () => {
  let controller: ProjectController;
  let service: any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = {
      createProject: vi.fn(),
      getProjectById: vi.fn(),
      listProjects: vi.fn(),
      updateProject: vi.fn(),
      deleteProject: vi.fn(),
      archiveProject: vi.fn(),
      unarchiveProject: vi.fn(),
      getProjectAuditLogs: vi.fn(),
    };
    controller = new ProjectController(service);
  });

  describe('createProject', () => {
    it('creates a project and returns 201', async () => {
      service.createProject.mockResolvedValue(mockProject);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        body: createProjectBody,
      });
      const res = createMockResponse();

      await (controller as any).createProject(req, res);

      expect(service.createProject).toHaveBeenCalledWith(expect.objectContaining({ name: 'Test Project' }), testContext);
      expect((res as MockResponse).statusCode).toBe(201);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, body: {} });
      const res = createMockResponse();

      await expect((controller as any).createProject(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking PROJECT_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).createProject(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getProjectById', () => {
    it('returns a project with 200', async () => {
      service.getProjectById.mockResolvedValue(mockProject);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { id: testProjectId },
      });
      const res = createMockResponse();

      await (controller as any).getProjectById(req, res);

      expect(service.getProjectById).toHaveBeenCalledWith(testProjectId);
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { id: testProjectId } });
      const res = createMockResponse();

      await expect((controller as any).getProjectById(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('listProjects', () => {
    it('returns paginated projects with 200', async () => {
      const mockList = { items: [mockProject], total: 1 };
      service.listProjects.mockResolvedValue(mockList);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        query: {},
      });
      const res = createMockResponse();

      await (controller as any).listProjects(req, res);

      expect(service.listProjects).toHaveBeenCalledWith(expect.any(Object));
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, query: {} });
      const res = createMockResponse();

      await expect((controller as any).listProjects(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('updateProject', () => {
    it('updates a project and returns 200', async () => {
      const updated = { ...mockProject, name: 'Updated Project' };
      service.updateProject.mockResolvedValue(updated);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { id: testProjectId },
        body: { name: 'Updated Project', version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).updateProject(req, res);

      expect(service.updateProject).toHaveBeenCalledWith(
        testProjectId,
        expect.objectContaining({ name: 'Updated Project', version: 1 }),
        testContext,
      );
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws ForbiddenError when lacking PROJECT_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { id: testProjectId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).updateProject(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('deleteProject', () => {
    it('deletes a project and returns 204', async () => {
      service.deleteProject.mockResolvedValue(undefined);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { id: testProjectId },
      });
      const res = createMockResponse();

      await (controller as any).deleteProject(req, res);

      expect(service.deleteProject).toHaveBeenCalledWith(testProjectId, testContext);
      expect((res as MockResponse).statusCode).toBe(204);
    });

    it('throws ForbiddenError when lacking PROJECT_DELETE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { id: testProjectId },
      });
      const res = createMockResponse();

      await expect((controller as any).deleteProject(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('archiveProject', () => {
    it('archives a project and returns 200', async () => {
      const archived = { ...mockProject, archivedAt: new Date(), archivedBy: 'oper_test001' };
      service.archiveProject.mockResolvedValue(archived);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { id: testProjectId },
        body: { version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).archiveProject(req, res);

      expect(service.archiveProject).toHaveBeenCalledWith(testProjectId, expect.objectContaining({ version: 1 }), testContext);
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws ForbiddenError when lacking PROJECT_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { id: testProjectId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).archiveProject(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('unarchiveProject', () => {
    it('unarchives a project and returns 200', async () => {
      const unarchived = { ...mockProject, archivedAt: null, archivedBy: null };
      service.unarchiveProject.mockResolvedValue(unarchived);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { id: testProjectId },
        body: { version: 2 },
      });
      const res = createMockResponse();

      await (controller as any).unarchiveProject(req, res);

      expect(service.unarchiveProject).toHaveBeenCalledWith(testProjectId, expect.objectContaining({ version: 2 }), testContext);
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws ForbiddenError when lacking PROJECT_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { id: testProjectId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).unarchiveProject(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getProjectAuditLogs', () => {
    it('returns audit logs with 200', async () => {
      const mockLogs = [{ id: 'log1', action: 'create' }];
      service.getProjectAuditLogs.mockResolvedValue(mockLogs);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { id: testProjectId },
      });
      const res = createMockResponse();

      await (controller as any).getProjectAuditLogs(req, res);

      expect(service.getProjectAuditLogs).toHaveBeenCalledWith(testProjectId);
      expect((res as MockResponse).statusCode).toBe(200);
    });
  });

  describe('registerRoutes', () => {
    it('registers all project routes', () => {
      const mockRouter = { post: vi.fn(), get: vi.fn(), put: vi.fn(), delete: vi.fn() } as any;
      controller.registerRoutes(mockRouter);

      expect(mockRouter.post).toHaveBeenCalledTimes(3);
      expect(mockRouter.get).toHaveBeenCalledTimes(3);
      expect(mockRouter.put).toHaveBeenCalledTimes(1);
      expect(mockRouter.delete).toHaveBeenCalledTimes(1);
    });
  });

  describe('getOpenAPIPaths', () => {
    it('returns OpenAPI path definitions for all endpoints', () => {
      const paths = ProjectController.getOpenAPIPaths();
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path).toHaveProperty('path');
        expect(path.path.startsWith('/api/projects')).toBe(true);
        expect(path).toHaveProperty('method');
      }
    });
  });
});
