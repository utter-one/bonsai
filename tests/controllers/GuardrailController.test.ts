import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';
import { UnauthorizedError, ForbiddenError } from '../../src/errors';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GuardrailController } from '../../src/http/controllers/GuardrailController';

const testProjectId = 'proj_test001';
const testGuardrailId = 'guard_test001';
const testContext = {
  operatorId: 'oper_test001',
  roles: ['super_admin'],
  ip: '127.0.0.1',
  userAgent: 'test/1.0',
  requestId: 'req_test001',
  timestamp: new Date('2025-01-01T00:00:00Z'),
};

const mockGuardrail = {
  id: testGuardrailId,
  projectId: testProjectId,
  name: 'Test Guardrail',
  version: 1,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

describe('GuardrailController', () => {
  let controller: GuardrailController;
  let service: any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = {
      createGuardrail: vi.fn(),
      getGuardrailById: vi.fn(),
      listGuardrails: vi.fn(),
      updateGuardrail: vi.fn(),
      deleteGuardrail: vi.fn(),
      getGuardrailAuditLogs: vi.fn(),
      cloneGuardrail: vi.fn(),
    };
    controller = new GuardrailController(service);
  });

  describe('createGuardrail', () => {
    it('creates a guardrail and returns 201', async () => {
      service.createGuardrail.mockResolvedValue(mockGuardrail);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId },
        body: { name: 'Test Guardrail' },
      });
      const res = createMockResponse();

      await (controller as any).createGuardrail(req, res);

      expect(service.createGuardrail).toHaveBeenCalledWith(testProjectId, expect.objectContaining({ name: 'Test Guardrail' }), testContext);
      expect((res as MockResponse).statusCode).toBe(201);
      expect((res as MockResponse).jsonBody).toBe(mockGuardrail);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, body: {} });
      const res = createMockResponse();

      await expect((controller as any).createGuardrail(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking GUARDRAIL_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).createGuardrail(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getGuardrailById', () => {
    it('returns a guardrail with 200', async () => {
      service.getGuardrailById.mockResolvedValue(mockGuardrail);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testGuardrailId },
      });
      const res = createMockResponse();

      await (controller as any).getGuardrailById(req, res);

      expect(service.getGuardrailById).toHaveBeenCalledWith(testProjectId, testGuardrailId);
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockGuardrail);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId, id: testGuardrailId } });
      const res = createMockResponse();

      await expect((controller as any).getGuardrailById(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('listGuardrails', () => {
    it('returns paginated guardrails with 200', async () => {
      const mockList = { items: [mockGuardrail], total: 1, offset: 0, limit: 25 };
      service.listGuardrails.mockResolvedValue(mockList);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId },
        query: {},
      });
      const res = createMockResponse();

      await (controller as any).listGuardrails(req, res);

      expect(service.listGuardrails).toHaveBeenCalledWith(testProjectId, expect.any(Object));
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockList);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, query: {} });
      const res = createMockResponse();

      await expect((controller as any).listGuardrails(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('updateGuardrail', () => {
    it('updates a guardrail and returns 200', async () => {
      const updated = { ...mockGuardrail, name: 'Updated Guardrail' };
      service.updateGuardrail.mockResolvedValue(updated);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testGuardrailId },
        body: { name: 'Updated Guardrail', version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).updateGuardrail(req, res);

      expect(service.updateGuardrail).toHaveBeenCalledWith(
        testProjectId,
        testGuardrailId,
        expect.objectContaining({ name: 'Updated Guardrail', version: 1 }),
        testContext,
      );
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws ForbiddenError when lacking GUARDRAIL_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testGuardrailId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).updateGuardrail(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('deleteGuardrail', () => {
    it('deletes a guardrail and returns 204', async () => {
      service.deleteGuardrail.mockResolvedValue(undefined);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testGuardrailId },
        body: { version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).deleteGuardrail(req, res);

      expect(service.deleteGuardrail).toHaveBeenCalledWith(testProjectId, testGuardrailId, 1, testContext);
      expect((res as MockResponse).statusCode).toBe(204);
      expect((res as MockResponse).sent).toBe(true);
    });

    it('throws ForbiddenError when lacking GUARDRAIL_DELETE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testGuardrailId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).deleteGuardrail(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getGuardrailAuditLogs', () => {
    it('returns audit logs with 200', async () => {
      const mockLogs = [{ id: 'log1', action: 'create' }];
      service.getGuardrailAuditLogs.mockResolvedValue(mockLogs);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testGuardrailId },
      });
      const res = createMockResponse();

      await (controller as any).getGuardrailAuditLogs(req, res);

      expect(service.getGuardrailAuditLogs).toHaveBeenCalledWith(testGuardrailId, testProjectId);
      expect((res as MockResponse).statusCode).toBe(200);
    });
  });

  describe('cloneGuardrail', () => {
    it('clones a guardrail and returns 201', async () => {
      const cloned = { ...mockGuardrail, id: 'guard_cloned001', name: 'Test Guardrail (Copy)' };
      service.cloneGuardrail.mockResolvedValue(cloned);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testGuardrailId },
        body: {},
      });
      const res = createMockResponse();

      await (controller as any).cloneGuardrail(req, res);

      expect(service.cloneGuardrail).toHaveBeenCalledWith(testProjectId, testGuardrailId, {}, testContext);
      expect((res as MockResponse).statusCode).toBe(201);
      expect((res as MockResponse).jsonBody).toBe(cloned);
    });

    it('throws ForbiddenError when lacking GUARDRAIL_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testGuardrailId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).cloneGuardrail(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('registerRoutes', () => {
    it('registers all guardrail routes', () => {
      const mockRouter = { post: vi.fn(), get: vi.fn(), put: vi.fn(), delete: vi.fn() } as any;
      controller.registerRoutes(mockRouter);

      expect(mockRouter.post).toHaveBeenCalledTimes(2);
      expect(mockRouter.get).toHaveBeenCalledTimes(3);
      expect(mockRouter.put).toHaveBeenCalledTimes(1);
      expect(mockRouter.delete).toHaveBeenCalledTimes(1);
    });
  });

  describe('getOpenAPIPaths', () => {
    it('returns OpenAPI path definitions for all endpoints', () => {
      const paths = GuardrailController.getOpenAPIPaths();
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path).toHaveProperty('path');
        expect(path.path.startsWith('/api/projects/{projectId}/guardrails')).toBe(true);
        expect(path).toHaveProperty('method');
      }
    });
  });
});
