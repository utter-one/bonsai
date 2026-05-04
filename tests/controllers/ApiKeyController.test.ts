import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';
import { UnauthorizedError, ForbiddenError } from '../../src/errors';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { ApiKeyController } from '../../src/http/controllers/ApiKeyController';

const testProjectId = 'proj_test001';
const testApiKeyId = 'apikey_test001';
const testContext = {
  operatorId: 'oper_test001',
  roles: ['super_admin'],
  ip: '127.0.0.1',
  userAgent: 'test/1.0',
  requestId: 'req_test001',
  timestamp: new Date('2025-01-01T00:00:00Z'),
};

const mockApiKey = {
  id: testApiKeyId,
  projectId: testProjectId,
  name: 'Test API Key',
  keyPreview: 'ak_...',
  isActive: true,
  version: 1,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

const createApiKeyBody = {
  name: 'Test API Key',
};

describe('ApiKeyController', () => {
  let controller: ApiKeyController;
  let service: any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = {
      createApiKey: vi.fn(),
      getApiKeyById: vi.fn(),
      listApiKeys: vi.fn(),
      updateApiKey: vi.fn(),
      deleteApiKey: vi.fn(),
      getApiKeyAuditLogs: vi.fn(),
    };
    controller = new ApiKeyController(service);
  });

  describe('createApiKey', () => {
    it('creates an API key and returns 201', async () => {
      service.createApiKey.mockResolvedValue(mockApiKey);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId },
        body: createApiKeyBody,
      });
      const res = createMockResponse();

      await (controller as any).createApiKey(req, res);

      expect(service.createApiKey).toHaveBeenCalledWith(testProjectId, expect.objectContaining({ name: 'Test API Key' }), testContext);
      expect((res as MockResponse).statusCode).toBe(201);
      expect((res as MockResponse).jsonBody).toBe(mockApiKey);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, body: {} });
      const res = createMockResponse();

      await expect((controller as any).createApiKey(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking API_KEY_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).createApiKey(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getApiKeyById', () => {
    it('returns an API key with 200', async () => {
      service.getApiKeyById.mockResolvedValue(mockApiKey);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testApiKeyId },
      });
      const res = createMockResponse();

      await (controller as any).getApiKey(req, res);

      expect(service.getApiKeyById).toHaveBeenCalledWith(testProjectId, testApiKeyId);
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockApiKey);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId, id: testApiKeyId } });
      const res = createMockResponse();

      await expect((controller as any).getApiKey(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('listApiKeys', () => {
    it('returns paginated API keys with 200', async () => {
      const mockList = { items: [mockApiKey], total: 1 };
      service.listApiKeys.mockResolvedValue(mockList);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId },
        query: {},
      });
      const res = createMockResponse();

      await (controller as any).listApiKeys(req, res);

      expect(service.listApiKeys).toHaveBeenCalledWith(testProjectId, expect.any(Object));
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockList);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, query: {} });
      const res = createMockResponse();

      await expect((controller as any).listApiKeys(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('listAllApiKeys', () => {
    it('returns all API keys across projects with 200', async () => {
      const mockList = { items: [mockApiKey], total: 1 };
      service.listApiKeys.mockResolvedValue(mockList);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        query: {},
      });
      const res = createMockResponse();

      await (controller as any).listAllApiKeys(req, res);

      expect(service.listApiKeys).toHaveBeenCalledWith(undefined, expect.any(Object));
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, query: {} });
      const res = createMockResponse();

      await expect((controller as any).listAllApiKeys(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('updateApiKey', () => {
    it('updates an API key and returns 200', async () => {
      const updated = { ...mockApiKey, name: 'Updated Key' };
      service.updateApiKey.mockResolvedValue(updated);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testApiKeyId },
        body: { name: 'Updated Key', version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).updateApiKey(req, res);

      expect(service.updateApiKey).toHaveBeenCalledWith(
        testProjectId,
        testApiKeyId,
        expect.objectContaining({ name: 'Updated Key', version: 1 }),
        testContext,
      );
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws ForbiddenError when lacking API_KEY_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testApiKeyId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).updateApiKey(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('deleteApiKey', () => {
    it('deletes an API key and returns 204', async () => {
      service.deleteApiKey.mockResolvedValue(undefined);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testApiKeyId },
        body: { version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).deleteApiKey(req, res);

      expect(service.deleteApiKey).toHaveBeenCalledWith(testProjectId, testApiKeyId, 1, testContext);
      expect((res as MockResponse).statusCode).toBe(204);
      expect((res as MockResponse).sent).toBe(true);
    });

    it('throws ForbiddenError when lacking API_KEY_DELETE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testApiKeyId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).deleteApiKey(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getApiKeyAuditLogs', () => {
    it('returns audit logs with 200', async () => {
      const mockLogs = [{ id: 'log1', action: 'create' }];
      service.getApiKeyAuditLogs.mockResolvedValue(mockLogs);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testApiKeyId },
      });
      const res = createMockResponse();

      await (controller as any).getApiKeyAuditLogs(req, res);

      expect(service.getApiKeyAuditLogs).toHaveBeenCalledWith(testApiKeyId, testProjectId);
      expect((res as MockResponse).statusCode).toBe(200);
    });
  });

  describe('registerRoutes', () => {
    it('registers all API key routes', () => {
      const mockRouter = { post: vi.fn(), get: vi.fn(), put: vi.fn(), delete: vi.fn() } as any;
      controller.registerRoutes(mockRouter);

      expect(mockRouter.post).toHaveBeenCalledTimes(1);
      expect(mockRouter.get).toHaveBeenCalledTimes(4);
      expect(mockRouter.put).toHaveBeenCalledTimes(1);
      expect(mockRouter.delete).toHaveBeenCalledTimes(1);
    });
  });

  describe('getOpenAPIPaths', () => {
    it('returns OpenAPI path definitions for all endpoints', () => {
      const paths = ApiKeyController.getOpenAPIPaths();
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path).toHaveProperty('path');
        expect(path.path.startsWith('/api')).toBe(true);
        expect(path).toHaveProperty('method');
      }
    });
  });
});
