import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';
import { UnauthorizedError, ForbiddenError } from '../../src/errors';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { SampleCopyController } from '../../src/http/controllers/SampleCopyController';

const testProjectId = 'proj_test001';
const testSampleCopyId = 'samplecopy_test001';
const testContext = {
  operatorId: 'oper_test001',
  roles: ['super_admin'],
  ip: '127.0.0.1',
  userAgent: 'test/1.0',
  requestId: 'req_test001',
  timestamp: new Date('2025-01-01T00:00:00Z'),
};

const mockSampleCopy = {
  id: testSampleCopyId,
  projectId: testProjectId,
  name: 'Test Sample Copy',
  version: 1,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

const createSampleCopyBody = {
  name: 'Test Sample Copy',
  promptTrigger: 'greeting',
  content: ['Hello there!', 'Hi!'],
};

describe('SampleCopyController', () => {
  let controller: SampleCopyController;
  let service: any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = {
      createSampleCopy: vi.fn(),
      getSampleCopyById: vi.fn(),
      listSampleCopies: vi.fn(),
      updateSampleCopy: vi.fn(),
      deleteSampleCopy: vi.fn(),
      getSampleCopyAuditLogs: vi.fn(),
      cloneSampleCopy: vi.fn(),
    };
    controller = new SampleCopyController(service);
  });

  describe('createSampleCopy', () => {
    it('creates a sample copy and returns 201', async () => {
      service.createSampleCopy.mockResolvedValue(mockSampleCopy);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId },
        body: createSampleCopyBody,
      });
      const res = createMockResponse();

      await (controller as any).createSampleCopy(req, res);

      expect(service.createSampleCopy).toHaveBeenCalledWith(testProjectId, expect.objectContaining({ name: 'Test Sample Copy' }), testContext);
      expect((res as MockResponse).statusCode).toBe(201);
      expect((res as MockResponse).jsonBody).toBe(mockSampleCopy);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, body: {} });
      const res = createMockResponse();

      await expect((controller as any).createSampleCopy(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking SAMPLE_COPY_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).createSampleCopy(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getSampleCopyById', () => {
    it('returns a sample copy with 200', async () => {
      service.getSampleCopyById.mockResolvedValue(mockSampleCopy);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testSampleCopyId },
      });
      const res = createMockResponse();

      await (controller as any).getSampleCopyById(req, res);

      expect(service.getSampleCopyById).toHaveBeenCalledWith(testProjectId, testSampleCopyId);
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockSampleCopy);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId, id: testSampleCopyId } });
      const res = createMockResponse();

      await expect((controller as any).getSampleCopyById(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('listSampleCopies', () => {
    it('returns paginated sample copies with 200', async () => {
      const mockList = { items: [mockSampleCopy], total: 1, offset: 0, limit: 25 };
      service.listSampleCopies.mockResolvedValue(mockList);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId },
        query: {},
      });
      const res = createMockResponse();

      await (controller as any).listSampleCopies(req, res);

      expect(service.listSampleCopies).toHaveBeenCalledWith(testProjectId, expect.any(Object));
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockList);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, query: {} });
      const res = createMockResponse();

      await expect((controller as any).listSampleCopies(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('updateSampleCopy', () => {
    it('updates a sample copy and returns 200', async () => {
      const updated = { ...mockSampleCopy, name: 'Updated Sample Copy' };
      service.updateSampleCopy.mockResolvedValue(updated);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testSampleCopyId },
        body: { name: 'Updated Sample Copy', version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).updateSampleCopy(req, res);

      expect(service.updateSampleCopy).toHaveBeenCalledWith(
        testProjectId,
        testSampleCopyId,
        expect.objectContaining({ name: 'Updated Sample Copy', version: 1 }),
        testContext,
      );
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws ForbiddenError when lacking SAMPLE_COPY_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testSampleCopyId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).updateSampleCopy(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('deleteSampleCopy', () => {
    it('deletes a sample copy and returns 204', async () => {
      service.deleteSampleCopy.mockResolvedValue(undefined);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testSampleCopyId },
        body: { version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).deleteSampleCopy(req, res);

      expect(service.deleteSampleCopy).toHaveBeenCalledWith(testProjectId, testSampleCopyId, 1, testContext);
      expect((res as MockResponse).statusCode).toBe(204);
      expect((res as MockResponse).sent).toBe(true);
    });

    it('throws ForbiddenError when lacking SAMPLE_COPY_DELETE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testSampleCopyId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).deleteSampleCopy(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getSampleCopyAuditLogs', () => {
    it('returns audit logs with 200', async () => {
      const mockLogs = [{ id: 'log1', action: 'create' }];
      service.getSampleCopyAuditLogs.mockResolvedValue(mockLogs);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testSampleCopyId },
      });
      const res = createMockResponse();

      await (controller as any).getSampleCopyAuditLogs(req, res);

      expect(service.getSampleCopyAuditLogs).toHaveBeenCalledWith(testSampleCopyId, testProjectId);
      expect((res as MockResponse).statusCode).toBe(200);
    });
  });

  describe('cloneSampleCopy', () => {
    it('clones a sample copy and returns 201', async () => {
      const cloned = { ...mockSampleCopy, id: 'samplecopy_cloned001', name: 'Test Sample Copy (Copy)' };
      service.cloneSampleCopy.mockResolvedValue(cloned);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testSampleCopyId },
        body: {},
      });
      const res = createMockResponse();

      await (controller as any).cloneSampleCopy(req, res);

      expect(service.cloneSampleCopy).toHaveBeenCalledWith(testProjectId, testSampleCopyId, {}, testContext);
      expect((res as MockResponse).statusCode).toBe(201);
      expect((res as MockResponse).jsonBody).toBe(cloned);
    });

    it('throws ForbiddenError when lacking SAMPLE_COPY_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testSampleCopyId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).cloneSampleCopy(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('registerRoutes', () => {
    it('registers all sample copy routes', () => {
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
      const paths = SampleCopyController.getOpenAPIPaths();
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path).toHaveProperty('path');
        expect(path.path.startsWith('/api/projects/{projectId}/sample-copies')).toBe(true);
        expect(path).toHaveProperty('method');
      }
    });
  });
});
