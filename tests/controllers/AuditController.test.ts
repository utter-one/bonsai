import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';
import { UnauthorizedError, ForbiddenError } from '../../src/errors';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { AuditController } from '../../src/http/controllers/AuditController';

describe('AuditController', () => {
  let controller: AuditController;
  let auditService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    auditService = {
      listAuditLogs: vi.fn(),
    };
    controller = new AuditController(auditService);
  });

  describe('listAuditLogs', () => {
    it('returns paginated audit logs with 200', async () => {
      const mockList = { items: [{ id: 'log1', action: 'CREATE' }], total: 1, offset: 0, limit: 25 };
      auditService.listAuditLogs.mockResolvedValue(mockList);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        query: {},
      });
      const res = createMockResponse();

      await (controller as any).listAuditLogs(req, res);

      expect(auditService.listAuditLogs).toHaveBeenCalledWith(expect.any(Object));
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockList);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, query: {} });
      (req as any).url = '/api/audit-logs';
      (req as any).method = 'GET';
      const res = createMockResponse();

      await expect((controller as any).listAuditLogs(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking AUDIT_READ', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: [] },
        query: {},
      });
      (req as any).url = '/api/audit-logs';
      (req as any).method = 'GET';
      const res = createMockResponse();

      await expect((controller as any).listAuditLogs(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('registerRoutes', () => {
    it('registers all audit routes', () => {
      const mockRouter = { get: vi.fn() } as any;
      controller.registerRoutes(mockRouter);

      expect(mockRouter.get).toHaveBeenCalledTimes(1);
      expect(mockRouter.get).toHaveBeenCalledWith('/api/audit-logs', expect.any(Function));
    });
  });

  describe('getOpenAPIPaths', () => {
    it('returns OpenAPI path definitions for all endpoints', () => {
      const paths = AuditController.getOpenAPIPaths();
      expect(paths.length).toBe(1);
      for (const path of paths) {
        expect(path).toHaveProperty('path');
        expect(path.path.startsWith('/api/')).toBe(true);
        expect(path).toHaveProperty('method');
      }
    });
  });
});
