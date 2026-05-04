import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';
import { UnauthorizedError, ForbiddenError, ConflictError } from '../../src/errors';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/db/index', () => {
  const select = vi.fn().mockReturnValue({
    from: vi.fn().mockResolvedValue([]),
  });
  return {
    db: { select },
  };
});

import { SecretController } from '../../src/http/controllers/SecretController';

describe('SecretController', () => {
  let controller: SecretController;
  let registry: any;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = {
      listAllRefs: vi.fn().mockResolvedValue([]),
      resolveSecret: vi.fn(),
      deleteSecret: vi.fn(),
      isSecretReference: vi.fn().mockReturnValue(false),
    };
    controller = new SecretController(registry);
  });

  describe('listSecrets', () => {
    it('returns secrets list with 200', async () => {
      registry.listAllRefs.mockResolvedValue(['@sec:local:secret1', '@sec:local:secret2']);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
      });
      const res = createMockResponse();

      await (controller as any).listSecrets(req, res);

      expect(registry.listAllRefs).toHaveBeenCalled();
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toHaveProperty('items');
      expect((res as MockResponse).jsonBody).toHaveProperty('orphans');
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined });
      (req as any).url = '/api/secrets';
      (req as any).method = 'GET';
      const res = createMockResponse();

      await expect((controller as any).listSecrets(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking SECRETS_READ', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: [] },
      });
      (req as any).url = '/api/secrets';
      (req as any).method = 'GET';
      const res = createMockResponse();

      await expect((controller as any).listSecrets(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('revealSecret', () => {
    it('reveals secret value with 200', async () => {
      registry.resolveSecret.mockResolvedValue('decrypted-value');
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { id: 'secret_test001' },
      });
      const res = createMockResponse();

      await (controller as any).revealSecret(req, res);

      expect(registry.resolveSecret).toHaveBeenCalledWith('@sec:local:secret_test001');
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toEqual({ id: 'secret_test001', value: 'decrypted-value' });
    });

    it('throws ForbiddenError when lacking SECRETS_REVEAL', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: [] },
        params: { id: 'secret_test001' },
      });
      (req as any).url = '/api/secrets/secret_test001/value';
      (req as any).method = 'GET';
      const res = createMockResponse();

      await expect((controller as any).revealSecret(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('deleteSecret', () => {
    it('deletes a secret and returns 204', async () => {
      registry.deleteSecret.mockResolvedValue(undefined);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { id: 'secret_test001' },
      });
      const res = createMockResponse();

      await (controller as any).deleteSecret(req, res);

      expect(registry.deleteSecret).toHaveBeenCalledWith('@sec:local:secret_test001');
      expect((res as MockResponse).statusCode).toBe(204);
    });

 
    it('throws ForbiddenError when lacking SECRETS_DELETE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: [] },
        params: { id: 'secret_test001' },
      });
      (req as any).url = '/api/secrets/secret_test001';
      (req as any).method = 'DELETE';
      const res = createMockResponse();

      await expect((controller as any).deleteSecret(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('registerRoutes', () => {
    it('registers all secret routes', () => {
      const mockRouter = { get: vi.fn(), delete: vi.fn() } as any;
      controller.registerRoutes(mockRouter);

      expect(mockRouter.get).toHaveBeenCalledTimes(2);
      expect(mockRouter.delete).toHaveBeenCalledTimes(1);
    });
  });

  describe('getOpenAPIPaths', () => {
    it('returns OpenAPI path definitions for all endpoints', () => {
      const paths = SecretController.getOpenAPIPaths();
      expect(paths.length).toBe(3);
      for (const path of paths) {
        expect(path).toHaveProperty('path');
        expect(path.path.startsWith('/api/secrets')).toBe(true);
        expect(path).toHaveProperty('method');
      }
    });
  });
});
