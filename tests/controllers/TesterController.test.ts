import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';
import { UnauthorizedError, ForbiddenError } from '../../src/errors';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { TesterController } from '../../src/http/controllers/TesterController';

const testProjectId = 'proj_test001';
const testTesterId = 'testr_test001';
const testContext = {
  operatorId: 'oper_test001',
  roles: ['super_admin'],
  ip: '127.0.0.1',
  userAgent: 'test/1.0',
  requestId: 'req_test001',
  timestamp: new Date('2025-01-01T00:00:00Z'),
};

const mockTester = {
  id: testTesterId,
  projectId: testProjectId,
  name: 'Test Tester',
  description: 'A test persona',
  prompt: 'You are a customer calling for support.',
  hangUpPrompt: null,
  llmProviderId: null,
  llmSettings: {},
  userProfile: null,
  tags: [],
  metadata: null,
  version: 1,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

const createTesterBody = {
  name: 'Test Tester',
  prompt: 'You are a customer calling for support.',
};

describe('TesterController', () => {
  let controller: TesterController;
  let service: any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = {
      createTester: vi.fn(),
      getTesterById: vi.fn(),
      listTesters: vi.fn(),
      updateTester: vi.fn(),
      deleteTester: vi.fn(),
      getTesterAuditLogs: vi.fn(),
    };
    controller = new TesterController(service);
  });

  describe('createTester', () => {
    it('creates a tester and returns 201', async () => {
      service.createTester.mockResolvedValue(mockTester);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId },
        body: createTesterBody,
      });
      const res = createMockResponse();

      await (controller as any).createTester(req, res);

      expect(service.createTester).toHaveBeenCalledWith(testProjectId, expect.objectContaining({ name: 'Test Tester' }), testContext);
      expect((res as MockResponse).statusCode).toBe(201);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, body: {} });
      const res = createMockResponse();

      await expect((controller as any).createTester(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking TESTER_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).createTester(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getTesterById', () => {
    it('returns a tester with 200', async () => {
      service.getTesterById.mockResolvedValue(mockTester);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testTesterId },
      });
      const res = createMockResponse();

      await (controller as any).getTesterById(req, res);

      expect(service.getTesterById).toHaveBeenCalledWith(testProjectId, testTesterId);
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId, id: testTesterId } });
      const res = createMockResponse();

      await expect((controller as any).getTesterById(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('listTesters', () => {
    it('returns paginated testers with 200', async () => {
      const mockList = { items: [mockTester], total: 1, offset: 0, limit: 25 };
      service.listTesters.mockResolvedValue(mockList);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId },
        query: {},
      });
      const res = createMockResponse();

      await (controller as any).listTesters(req, res);

      expect(service.listTesters).toHaveBeenCalledWith(testProjectId, expect.any(Object));
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, query: {} });
      const res = createMockResponse();

      await expect((controller as any).listTesters(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('updateTester', () => {
    it('updates a tester and returns 200', async () => {
      const updated = { ...mockTester, name: 'Updated Tester' };
      service.updateTester.mockResolvedValue(updated);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testTesterId },
        body: { name: 'Updated Tester', version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).updateTester(req, res);

      expect(service.updateTester).toHaveBeenCalledWith(
        testProjectId,
        testTesterId,
        expect.objectContaining({ name: 'Updated Tester', version: 1 }),
        testContext,
      );
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws ForbiddenError when lacking TESTER_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testTesterId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).updateTester(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('deleteTester', () => {
    it('deletes a tester and returns 204', async () => {
      service.deleteTester.mockResolvedValue(undefined);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testTesterId },
        body: { version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).deleteTester(req, res);

      expect(service.deleteTester).toHaveBeenCalledWith(testProjectId, testTesterId, 1, testContext);
      expect((res as MockResponse).statusCode).toBe(204);
    });

    it('throws ForbiddenError when lacking TESTER_DELETE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testTesterId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).deleteTester(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getTesterAuditLogs', () => {
    it('returns audit logs with 200', async () => {
      const mockLogs = [{ id: 'log1', action: 'create' }];
      service.getTesterAuditLogs.mockResolvedValue(mockLogs);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testTesterId },
      });
      const res = createMockResponse();

      await (controller as any).getTesterAuditLogs(req, res);

      expect(service.getTesterAuditLogs).toHaveBeenCalledWith(testTesterId, testProjectId);
      expect((res as MockResponse).statusCode).toBe(200);
    });
  });

  describe('registerRoutes', () => {
    it('registers all tester routes', () => {
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
      const paths = TesterController.getOpenAPIPaths();
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path).toHaveProperty('path');
        expect(path.path.startsWith('/api/projects/{projectId}/testers')).toBe(true);
        expect(path).toHaveProperty('method');
      }
    });
  });
});
