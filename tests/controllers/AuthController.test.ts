import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { AuthController } from '../../src/http/controllers/AuthController';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    authService = {
      login: vi.fn(),
      refresh: vi.fn(),
    };
    controller = new AuthController(authService);
  });

  describe('login', () => {
    it('returns tokens on successful login', async () => {
      const mockResult = { accessToken: 'token123', refreshToken: 'refresh456' };
      authService.login.mockResolvedValue(mockResult);
      const req = createMockRequest({
        body: { id: 'oper_test001', password: 'password123' },
      });
      const res = createMockResponse();

      await (controller as any).login(req, res);

      expect(authService.login).toHaveBeenCalledWith('oper_test001', 'password123');
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockResult);
    });
  });

  describe('refresh', () => {
    it('returns new tokens on successful refresh', async () => {
      const mockResult = { accessToken: 'newtoken123' };
      authService.refresh.mockResolvedValue(mockResult);
      const req = createMockRequest({
        body: { refreshToken: 'validrefresh456' },
      });
      const res = createMockResponse();

      await (controller as any).refresh(req, res);

      expect(authService.refresh).toHaveBeenCalledWith('validrefresh456');
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockResult);
    });
  });

  describe('registerRoutes', () => {
    it('registers all auth routes', () => {
      const mockRouter = { post: vi.fn(), get: vi.fn() } as any;
      controller.registerRoutes(mockRouter);

      expect(mockRouter.post).toHaveBeenCalledTimes(2);
      expect(mockRouter.post).toHaveBeenCalledWith('/api/auth/login', expect.any(Function), expect.any(Function));
      expect(mockRouter.post).toHaveBeenCalledWith('/api/auth/refresh', expect.any(Function), expect.any(Function));
    });
  });

  describe('getOpenAPIPaths', () => {
    it('returns OpenAPI path definitions for all endpoints', () => {
      const paths = AuthController.getOpenAPIPaths();
      expect(paths.length).toBe(2);
      for (const path of paths) {
        expect(path).toHaveProperty('path');
        expect(path.path.startsWith('/api/auth/')).toBe(true);
        expect(path).toHaveProperty('method');
      }
    });
  });
});
