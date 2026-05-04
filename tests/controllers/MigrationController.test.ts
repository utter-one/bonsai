import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';
import { UnauthorizedError, ForbiddenError } from '../../src/errors';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { MigrationController } from '../../src/http/controllers/MigrationController';

const testContext = {
  operatorId: 'oper_test001',
  roles: ['super_admin'],
  ip: '127.0.0.1',
  userAgent: 'test/1.0',
  requestId: 'req_test001',
  timestamp: new Date('2025-01-01T00:00:00Z'),
};

describe('MigrationController', () => {
  let controller: MigrationController;
  let migrationService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    migrationService = {
      previewExport: vi.fn(),
      exportBundle: vi.fn(),
    };
    controller = new MigrationController(migrationService);
  });

  describe('previewExport', () => {
    it('returns migration preview with 200', async () => {
      const mockPreview = { agents: [{ id: 'agent1', name: 'Test Agent' }], stages: [] };
      migrationService.previewExport.mockResolvedValue(mockPreview);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        query: {},
      });
      const res = createMockResponse();

      await (controller as any).previewExport(req, res);

      expect(migrationService.previewExport).toHaveBeenCalledWith(expect.any(Object), testContext);
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, query: {} });
      (req as any).url = '/api/migration/preview';
      (req as any).method = 'GET';
      const res = createMockResponse();

      await expect((controller as any).previewExport(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking MIGRATION_EXPORT', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: [] },
        query: {},
      });
      (req as any).url = '/api/migration/preview';
      (req as any).method = 'GET';
      const res = createMockResponse();

      await expect((controller as any).previewExport(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('exportBundle', () => {
    it('returns export bundle with 200', async () => {
      const mockBundle = { version: '1.0', entities: { agents: [], stages: [] } };
      migrationService.exportBundle.mockResolvedValue(mockBundle);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        query: {},
      });
      const res = createMockResponse();

      await (controller as any).exportBundle(req, res);

      expect(migrationService.exportBundle).toHaveBeenCalledWith(expect.any(Object), testContext);
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, query: {} });
      (req as any).url = '/api/migration/export';
      (req as any).method = 'GET';
      const res = createMockResponse();

      await expect((controller as any).exportBundle(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('registerRoutes', () => {
    it('registers all migration routes', () => {
      const mockRouter = { get: vi.fn() } as any;
      controller.registerRoutes(mockRouter);

      expect(mockRouter.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('getOpenAPIPaths', () => {
    it('returns OpenAPI path definitions for all endpoints', () => {
      const paths = MigrationController.getOpenAPIPaths();
      expect(paths.length).toBe(2);
      for (const path of paths) {
        expect(path).toHaveProperty('path');
        expect(path.path.startsWith('/api/migration/')).toBe(true);
        expect(path).toHaveProperty('method');
      }
    });
  });
});
