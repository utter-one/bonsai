import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { VersionController } from '../../src/http/controllers/VersionController';

describe('VersionController', () => {
  let controller: VersionController;
  let service: any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = {
      getVersion: vi.fn().mockReturnValue({
        restSchemaHash: 'abc123',
        wsSchemaHash: 'def456',
        gitCommit: 'test-commit',
      }),
    };
    controller = new VersionController(service);
  });

  describe('getVersion', () => {
    it('returns version info with 200 status', async () => {
      const req = createMockRequest();
      const res = createMockResponse();

      await (controller as any).getVersion(req, res);

      expect(service.getVersion).toHaveBeenCalledWith();
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toEqual({
        restSchemaHash: 'abc123',
        wsSchemaHash: 'def456',
        gitCommit: 'test-commit',
      });
    });

    it('does not require authentication', async () => {
      const req = createMockRequest({ user: undefined });
      const res = createMockResponse();

      await expect((controller as any).getVersion(req, res)).resolves.not.toThrow();
      expect((res as MockResponse).statusCode).toBe(200);
    });
  });

  describe('registerRoutes', () => {
    it('registers the /version route', () => {
      const mockRouter = { get: vi.fn() } as any;
      controller.registerRoutes(mockRouter);
      expect(mockRouter.get).toHaveBeenCalledWith(
        expect.stringContaining('/version'),
        expect.any(Function),
      );
    });
  });

  describe('getOpenAPIPaths', () => {
    it('returns OpenAPI path definitions', () => {
      const paths = VersionController.getOpenAPIPaths();
      expect(paths).toHaveLength(1);
      expect(paths[0]).toMatchObject({
        method: 'get',
        path: '/version',
        tags: ['System'],
      });
    });
  });
});
