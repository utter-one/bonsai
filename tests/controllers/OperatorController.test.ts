import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';
import { UnauthorizedError, ForbiddenError } from '../../src/errors';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { OperatorController } from '../../src/http/controllers/OperatorController';

const testOperatorId = 'oper_test001';
const testContext = {
  operatorId: 'oper_test001',
  roles: ['super_admin'],
  ip: '127.0.0.1',
  userAgent: 'test/1.0',
  requestId: 'req_test001',
  timestamp: new Date('2025-01-01T00:00:00Z'),
};

const mockOperator = {
  id: testOperatorId,
  name: 'Test Operator',
  roles: ['super_admin'],
  version: 1,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

describe('OperatorController', () => {
  let controller: OperatorController;
  let operatorService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    operatorService = {
      createOperator: vi.fn(),
      getOperatorById: vi.fn(),
      listOperators: vi.fn(),
      updateOperator: vi.fn(),
      deleteOperator: vi.fn(),
      getOperatorAuditLogs: vi.fn(),
      getProfile: vi.fn(),
      updateProfile: vi.fn(),
    };
    controller = new OperatorController(operatorService);
  });

  describe('createOperator', () => {
    it('creates an operator and returns 201', async () => {
      operatorService.createOperator.mockResolvedValue(mockOperator);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        body: { id: testOperatorId, name: 'Test Operator', roles: ['content_manager'], password: 'password123' },
      });
      const res = createMockResponse();

      await (controller as any).createOperator(req, res);

      expect(operatorService.createOperator).toHaveBeenCalledWith(
        expect.objectContaining({ id: testOperatorId, name: 'Test Operator', roles: ['content_manager'], password: 'password123' }),
        testContext,
      );
      expect((res as MockResponse).statusCode).toBe(201);
      expect((res as MockResponse).jsonBody).toBe(mockOperator);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, body: {} });
      const res = createMockResponse();

      await expect((controller as any).createOperator(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking OPERATOR_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).createOperator(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getOperatorById', () => {
    it('returns an operator with 200', async () => {
      operatorService.getOperatorById.mockResolvedValue(mockOperator);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { id: testOperatorId },
      });
      const res = createMockResponse();

      await (controller as any).getOperatorById(req, res);

      expect(operatorService.getOperatorById).toHaveBeenCalledWith(testOperatorId);
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockOperator);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { id: testOperatorId } });
      const res = createMockResponse();

      await expect((controller as any).getOperatorById(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('listOperators', () => {
    it('returns paginated operators with 200', async () => {
      const mockList = { items: [mockOperator], total: 1, offset: 0, limit: 25 };
      operatorService.listOperators.mockResolvedValue(mockList);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        query: {},
      });
      const res = createMockResponse();

      await (controller as any).listOperators(req, res);

      expect(operatorService.listOperators).toHaveBeenCalledWith(expect.any(Object));
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockList);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, query: {} });
      const res = createMockResponse();

      await expect((controller as any).listOperators(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('updateOperator', () => {
    it('updates an operator and returns 200', async () => {
      const updated = { ...mockOperator, name: 'Updated Operator' };
      operatorService.updateOperator.mockResolvedValue(updated);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { id: testOperatorId },
        body: { name: 'Updated Operator', version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).updateOperator(req, res);

      expect(operatorService.updateOperator).toHaveBeenCalledWith(
        testOperatorId,
        expect.objectContaining({ name: 'Updated Operator', version: 1 }),
        testContext,
      );
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws ForbiddenError when lacking OPERATOR_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { id: testOperatorId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).updateOperator(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('deleteOperator', () => {
    it('deletes an operator and returns 204', async () => {
      operatorService.deleteOperator.mockResolvedValue(undefined);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { id: testOperatorId },
        body: { version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).deleteOperator(req, res);

      expect(operatorService.deleteOperator).toHaveBeenCalledWith(testOperatorId, 1, testContext);
      expect((res as MockResponse).statusCode).toBe(204);
    });

    it('throws ForbiddenError when lacking OPERATOR_DELETE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { id: testOperatorId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).deleteOperator(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getOperatorAuditLogs', () => {
    it('returns audit logs with 200', async () => {
      const mockLogs = [{ id: 'log1', action: 'create' }];
      operatorService.getOperatorAuditLogs.mockResolvedValue(mockLogs);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { id: testOperatorId },
      });
      const res = createMockResponse();

      await (controller as any).getOperatorAuditLogs(req, res);

      expect(operatorService.getOperatorAuditLogs).toHaveBeenCalledWith(testOperatorId);
      expect((res as MockResponse).statusCode).toBe(200);
    });
  });

  describe('getProfile', () => {
    it('returns profile with 200', async () => {
      operatorService.getProfile.mockResolvedValue(mockOperator);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
      });
      const res = createMockResponse();

      await (controller as any).getProfile(req, res);

      expect(operatorService.getProfile).toHaveBeenCalledWith(testContext);
      expect((res as MockResponse).statusCode).toBe(200);
    });
  });

  describe('updateProfile', () => {
    it('updates profile and returns 200', async () => {
      const updated = { ...mockOperator, name: 'Updated Name' };
      operatorService.updateProfile.mockResolvedValue(updated);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        body: { name: 'Updated Name' },
      });
      const res = createMockResponse();

      await (controller as any).updateProfile(req, res);

      expect(operatorService.updateProfile).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Updated Name' }),
        testContext,
      );
      expect((res as MockResponse).statusCode).toBe(200);
    });
  });

  describe('registerRoutes', () => {
    it('registers all operator routes', () => {
      const mockRouter = { post: vi.fn(), get: vi.fn(), put: vi.fn(), delete: vi.fn() } as any;
      controller.registerRoutes(mockRouter);

      expect(mockRouter.post).toHaveBeenCalledTimes(2);
      expect(mockRouter.get).toHaveBeenCalledTimes(4);
      expect(mockRouter.put).toHaveBeenCalledTimes(1);
      expect(mockRouter.delete).toHaveBeenCalledTimes(1);
    });
  });

  describe('getOpenAPIPaths', () => {
    it('returns OpenAPI path definitions for all endpoints', () => {
      const paths = OperatorController.getOpenAPIPaths();
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path).toHaveProperty('path');
        expect(path.path.startsWith('/api/')).toBe(true);
        expect(path).toHaveProperty('method');
      }
    });
  });
});
