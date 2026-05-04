import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';
import { UnauthorizedError, ForbiddenError } from '../../src/errors';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { ProviderController } from '../../src/http/controllers/ProviderController';

const testProviderId = 'prov_test001';
const testContext = {
  operatorId: 'oper_test001',
  roles: ['super_admin'],
  ip: '127.0.0.1',
  userAgent: 'test/1.0',
  requestId: 'req_test001',
  timestamp: new Date('2025-01-01T00:00:00Z'),
};

const mockProvider = {
  id: testProviderId,
  name: 'Test Provider',
  description: 'A test provider',
  providerType: 'llm' as const,
  apiType: 'openai',
  config: { apiKey: 'sk-test123' },
  createdBy: 'oper_test001',
  tags: ['production'],
  version: 1,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

const createProviderBody = {
  name: 'Test Provider',
  description: 'A test provider',
  providerType: 'llm' as const,
  apiType: 'openai',
  config: { apiKey: 'sk-test123' },
};

describe('ProviderController', () => {
  let controller: ProviderController;
  let service: any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = {
      createProvider: vi.fn(),
      getProviderById: vi.fn(),
      listProviders: vi.fn(),
      updateProvider: vi.fn(),
      deleteProvider: vi.fn(),
      getProviderAuditLogs: vi.fn(),
      enumerateModels: vi.fn(),
    };
    controller = new ProviderController(service);
  });

  describe('createProvider', () => {
    it('creates a provider and returns 201', async () => {
      service.createProvider.mockResolvedValue(mockProvider);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        body: createProviderBody,
      });
      const res = createMockResponse();

      await (controller as any).createProvider(req, res);

      expect(service.createProvider).toHaveBeenCalledWith(expect.objectContaining({ name: 'Test Provider' }), testContext);
      expect((res as MockResponse).statusCode).toBe(201);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, body: {} });
      const res = createMockResponse();

      await expect((controller as any).createProvider(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking PROVIDER_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).createProvider(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getProviderById', () => {
    it('returns a provider with 200', async () => {
      service.getProviderById.mockResolvedValue(mockProvider);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { id: testProviderId },
      });
      const res = createMockResponse();

      await (controller as any).getProviderById(req, res);

      expect(service.getProviderById).toHaveBeenCalledWith(testProviderId, testContext);
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { id: testProviderId } });
      const res = createMockResponse();

      await expect((controller as any).getProviderById(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('listProviders', () => {
    it('returns paginated providers with 200', async () => {
      const mockList = { items: [mockProvider], total: 1, offset: 0, limit: 25 };
      service.listProviders.mockResolvedValue(mockList);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        query: {},
      });
      const res = createMockResponse();

      await (controller as any).listProviders(req, res);

      expect(service.listProviders).toHaveBeenCalledWith(expect.any(Object), testContext);
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, query: {} });
      const res = createMockResponse();

      await expect((controller as any).listProviders(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('updateProvider', () => {
    it('updates a provider and returns 200', async () => {
      const updated = { ...mockProvider, name: 'Updated Provider' };
      service.updateProvider.mockResolvedValue(updated);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { id: testProviderId },
        body: { name: 'Updated Provider', version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).updateProvider(req, res);

      expect(service.updateProvider).toHaveBeenCalledWith(
        testProviderId,
        expect.objectContaining({ name: 'Updated Provider', version: 1 }),
        testContext,
      );
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws ForbiddenError when lacking PROVIDER_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { id: testProviderId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).updateProvider(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('deleteProvider', () => {
    it('deletes a provider and returns 204', async () => {
      service.deleteProvider.mockResolvedValue(undefined);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { id: testProviderId },
        body: { version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).deleteProvider(req, res);

      expect(service.deleteProvider).toHaveBeenCalledWith(testProviderId, 1, testContext);
      expect((res as MockResponse).statusCode).toBe(204);
    });

    it('throws ForbiddenError when lacking PROVIDER_DELETE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { id: testProviderId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).deleteProvider(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getProviderAuditLogs', () => {
    it('returns audit logs with 200', async () => {
      const mockLogs = [{ id: 'log1', action: 'create' }];
      service.getProviderAuditLogs.mockResolvedValue(mockLogs);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { id: testProviderId },
      });
      const res = createMockResponse();

      await (controller as any).getProviderAuditLogs(req, res);

      expect(service.getProviderAuditLogs).toHaveBeenCalledWith(testProviderId, testContext);
      expect((res as MockResponse).statusCode).toBe(200);
    });
  });

  describe('enumerateModels', () => {
    it('returns models with 200', async () => {
      const mockModels = [{ id: 'gpt-4', name: 'GPT-4' }];
      service.enumerateModels.mockResolvedValue({ models: mockModels });
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { id: testProviderId },
      });
      const res = createMockResponse();

      await (controller as any).enumerateModels(req, res);

      expect(service.enumerateModels).toHaveBeenCalledWith(testProviderId, testContext);
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { id: testProviderId } });
      const res = createMockResponse();

      await expect((controller as any).enumerateModels(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('registerRoutes', () => {
    it('registers all provider routes', () => {
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
      const paths = ProviderController.getOpenAPIPaths();
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path).toHaveProperty('path');
        expect(path.path.startsWith('/api/providers')).toBe(true);
        expect(path).toHaveProperty('method');
      }
    });
  });
});
