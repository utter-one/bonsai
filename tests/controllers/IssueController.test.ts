import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';
import { UnauthorizedError, ForbiddenError } from '../../src/errors';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { IssueController } from '../../src/http/controllers/IssueController';

const testProjectId = 'proj_test001';
const testIssueId = '1';
const testContext = {
  operatorId: 'oper_test001',
  roles: ['super_admin'],
  ip: '127.0.0.1',
  userAgent: 'test/1.0',
  requestId: 'req_test001',
  timestamp: new Date('2025-01-01T00:00:00Z'),
};

const mockIssue = {
  id: 1,
  projectId: testProjectId,
  environment: 'production',
  buildVersion: '1.0.0',
  stage: null,
  conversationId: null,
  eventIndex: null,
  userId: null,
  severity: 'high',
  category: 'bug',
  bugDescription: 'Something is broken',
  expectedBehaviour: 'Should work correctly',
  comments: '',
  status: 'open',
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

const createIssueBody = {
  projectId: testProjectId,
  environment: 'production',
  buildVersion: '1.0.0',
  severity: 'high',
  category: 'bug',
  bugDescription: 'Something is broken',
  expectedBehaviour: 'Should work correctly',
  status: 'open',
};

describe('IssueController', () => {
  let controller: IssueController;
  let service: any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = {
      createIssue: vi.fn(),
      getIssueById: vi.fn(),
      listIssues: vi.fn(),
      updateIssue: vi.fn(),
      deleteIssue: vi.fn(),
      getIssueAuditLogs: vi.fn(),
    };
    controller = new IssueController(service);
  });

  describe('createIssue', () => {
    it('creates an issue and returns 201', async () => {
      service.createIssue.mockResolvedValue(mockIssue);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        body: createIssueBody,
      });
      const res = createMockResponse();

      await (controller as any).createIssue(req, res);

      expect(service.createIssue).toHaveBeenCalledWith(expect.objectContaining({ projectId: testProjectId }), testContext);
      expect((res as MockResponse).statusCode).toBe(201);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, body: {} });
      const res = createMockResponse();

      await expect((controller as any).createIssue(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking ISSUE_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).createIssue(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getIssueById', () => {
    it('returns an issue with 200', async () => {
      service.getIssueById.mockResolvedValue(mockIssue);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { id: testIssueId },
      });
      const res = createMockResponse();

      await (controller as any).getIssueById(req, res);

      expect(service.getIssueById).toHaveBeenCalledWith(1);
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { id: testIssueId } });
      const res = createMockResponse();

      await expect((controller as any).getIssueById(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('listIssues', () => {
    it('returns paginated issues with 200', async () => {
      const mockList = { items: [mockIssue], total: 1, offset: 0, limit: 25 };
      service.listIssues.mockResolvedValue(mockList);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        query: {},
      });
      const res = createMockResponse();

      await (controller as any).listIssues(req, res);

      expect(service.listIssues).toHaveBeenCalledWith(expect.any(Object));
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, query: {} });
      const res = createMockResponse();

      await expect((controller as any).listIssues(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('updateIssue', () => {
    it('updates an issue and returns 200', async () => {
      const updated = { ...mockIssue, status: 'resolved' };
      service.updateIssue.mockResolvedValue(updated);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { id: testIssueId },
        body: { status: 'resolved' },
      });
      const res = createMockResponse();

      await (controller as any).updateIssue(req, res);

      expect(service.updateIssue).toHaveBeenCalledWith(1, expect.objectContaining({ status: 'resolved' }), testContext);
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws ForbiddenError when lacking ISSUE_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { id: testIssueId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).updateIssue(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('deleteIssue', () => {
    it('deletes an issue and returns 204', async () => {
      service.deleteIssue.mockResolvedValue(undefined);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { id: testIssueId },
      });
      const res = createMockResponse();

      await (controller as any).deleteIssue(req, res);

      expect(service.deleteIssue).toHaveBeenCalledWith(1, testContext);
      expect((res as MockResponse).statusCode).toBe(204);
    });

    it('throws ForbiddenError when lacking ISSUE_DELETE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { id: testIssueId },
      });
      const res = createMockResponse();

      await expect((controller as any).deleteIssue(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getIssueAuditLogs', () => {
    it('returns audit logs with 200', async () => {
      const mockLogs = [{ id: 'log1', action: 'create' }];
      service.getIssueAuditLogs.mockResolvedValue(mockLogs);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { id: testIssueId },
      });
      const res = createMockResponse();

      await (controller as any).getIssueAuditLogs(req, res);

      expect(service.getIssueAuditLogs).toHaveBeenCalledWith(1);
      expect((res as MockResponse).statusCode).toBe(200);
    });
  });

  describe('registerRoutes', () => {
    it('registers all issue routes', () => {
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
      const paths = IssueController.getOpenAPIPaths();
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path).toHaveProperty('path');
        expect(path.path.startsWith('/api/issues')).toBe(true);
        expect(path).toHaveProperty('method');
      }
    });
  });
});
