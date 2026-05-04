import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { SetupController } from '../../src/http/controllers/SetupController';

describe('SetupController', () => {
  let controller: SetupController;
  let setupService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    setupService = {
      getSetupStatus: vi.fn(),
      createInitialOperator: vi.fn(),
    };
    controller = new SetupController(setupService);
  });

  describe('getSetupStatus', () => {
    it('returns setup status when not yet set up', async () => {
      const mockStatus = { isSetup: false, message: 'System is not yet configured' };
      setupService.getSetupStatus.mockResolvedValue(mockStatus);
      const req = createMockRequest();
      const res = createMockResponse();

      await (controller as any).getSetupStatus(req, res);

      expect(setupService.getSetupStatus).toHaveBeenCalled();
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockStatus);
    });

    it('returns setup status when already set up', async () => {
      const mockStatus = { isSetup: true, message: 'System is configured' };
      setupService.getSetupStatus.mockResolvedValue(mockStatus);
      const req = createMockRequest();
      const res = createMockResponse();

      await (controller as any).getSetupStatus(req, res);

      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockStatus);
    });
  });

  describe('createInitialOperator', () => {
    it('creates initial operator and returns tokens', async () => {
      const mockResult = {
        operator: { id: 'oper_test001', name: 'Test Operator', roles: ['super_admin'], createdAt: new Date() },
        accessToken: 'token123',
        refreshToken: 'refresh456',
        expiresIn: 900,
      };
      setupService.createInitialOperator.mockResolvedValue(mockResult);
      const req = createMockRequest({
        body: { id: 'oper_test001', name: 'Test Operator', password: 'password123' },
      });
      const res = createMockResponse();

      await (controller as any).createInitialOperator(req, res);

      expect(setupService.createInitialOperator).toHaveBeenCalledWith({
        id: 'oper_test001',
        name: 'Test Operator',
        password: 'password123',
      });
      expect((res as MockResponse).statusCode).toBe(201);
      expect((res as MockResponse).jsonBody).toBe(mockResult);
    });
  });

  describe('registerRoutes', () => {
    it('registers all setup routes', () => {
      const mockRouter = { post: vi.fn(), get: vi.fn() } as any;
      controller.registerRoutes(mockRouter);

      expect(mockRouter.get).toHaveBeenCalledTimes(1);
      expect(mockRouter.post).toHaveBeenCalledTimes(1);
      expect(mockRouter.get).toHaveBeenCalledWith('/api/setup/status', expect.any(Function));
      expect(mockRouter.post).toHaveBeenCalledWith('/api/setup/initial-operator', expect.any(Function));
    });
  });

  describe('getOpenAPIPaths', () => {
    it('returns OpenAPI path definitions for all endpoints', () => {
      const paths = SetupController.getOpenAPIPaths();
      expect(paths.length).toBe(2);
      for (const path of paths) {
        expect(path).toHaveProperty('path');
        expect(path.path.startsWith('/api/setup/')).toBe(true);
        expect(path).toHaveProperty('method');
      }
    });
  });
});
