import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';
import { UnauthorizedError, ForbiddenError } from '../../src/errors';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { AgentController } from '../../src/http/controllers/AgentController';

const testProjectId = 'proj_test001';
const testAgentId = 'agent_test001';
const testContext = {
  operatorId: 'oper_test001',
  roles: ['super_admin'],
  ip: '127.0.0.1',
  userAgent: 'test/1.0',
  requestId: 'req_test001',
  timestamp: new Date('2025-01-01T00:00:00Z'),
};

const mockAgent = {
  id: testAgentId,
  projectId: testProjectId,
  name: 'Test Agent',
  version: 1,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

const createAgentBody = {
  name: 'Test Agent',
  prompt: 'You are a helpful assistant.',
  ttsSettings: { provider: 'elevenlabs' as const },
};

describe('AgentController', () => {
  let controller: AgentController;
  let service: any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = {
      createAgent: vi.fn(),
      getAgentById: vi.fn(),
      listAgents: vi.fn(),
      updateAgent: vi.fn(),
      deleteAgent: vi.fn(),
      getAgentAuditLogs: vi.fn(),
      cloneAgent: vi.fn(),
    };
    controller = new AgentController(service);
  });

  describe('createAgent', () => {
    it('creates an agent and returns 201', async () => {
      service.createAgent.mockResolvedValue(mockAgent);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId },
        body: createAgentBody,
      });
      const res = createMockResponse();

      await (controller as any).createAgent(req, res);

      expect(service.createAgent).toHaveBeenCalledWith(testProjectId, expect.objectContaining({ name: 'Test Agent' }), testContext);
      expect((res as MockResponse).statusCode).toBe(201);
      expect((res as MockResponse).jsonBody).toBe(mockAgent);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, body: {} });
      const res = createMockResponse();

      await expect((controller as any).createAgent(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking AGENT_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).createAgent(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getAgentById', () => {
    it('returns an agent with 200', async () => {
      service.getAgentById.mockResolvedValue(mockAgent);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testAgentId },
      });
      const res = createMockResponse();

      await (controller as any).getAgentById(req, res);

      expect(service.getAgentById).toHaveBeenCalledWith(testProjectId, testAgentId);
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockAgent);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId, id: testAgentId } });
      const res = createMockResponse();

      await expect((controller as any).getAgentById(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('listAgents', () => {
    it('returns paginated agents with 200', async () => {
      const mockList = { items: [mockAgent], total: 1, offset: 0, limit: 25 };
      service.listAgents.mockResolvedValue(mockList);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId },
        query: {},
      });
      const res = createMockResponse();

      await (controller as any).listAgents(req, res);

      expect(service.listAgents).toHaveBeenCalledWith(testProjectId, expect.any(Object));
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toBe(mockList);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, query: {} });
      const res = createMockResponse();

      await expect((controller as any).listAgents(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('updateAgent', () => {
    it('updates an agent and returns 200', async () => {
      const updated = { ...mockAgent, name: 'Updated Agent' };
      service.updateAgent.mockResolvedValue(updated);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testAgentId },
        body: { name: 'Updated Agent', version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).updateAgent(req, res);

      expect(service.updateAgent).toHaveBeenCalledWith(
        testProjectId,
        testAgentId,
        expect.objectContaining({ name: 'Updated Agent', version: 1 }),
        testContext,
      );
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws ForbiddenError when lacking AGENT_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testAgentId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).updateAgent(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('deleteAgent', () => {
    it('deletes an agent and returns 204', async () => {
      service.deleteAgent.mockResolvedValue(undefined);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testAgentId },
        body: { version: 1 },
      });
      const res = createMockResponse();

      await (controller as any).deleteAgent(req, res);

      expect(service.deleteAgent).toHaveBeenCalledWith(testProjectId, testAgentId, 1, testContext);
      expect((res as MockResponse).statusCode).toBe(204);
      expect((res as MockResponse).sent).toBe(true);
    });

    it('throws ForbiddenError when lacking AGENT_DELETE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testAgentId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).deleteAgent(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getAgentAuditLogs', () => {
    it('returns audit logs with 200', async () => {
      const mockLogs = [{ id: 'log1', action: 'create' }];
      service.getAgentAuditLogs.mockResolvedValue(mockLogs);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testAgentId },
      });
      const res = createMockResponse();

      await (controller as any).getAgentAuditLogs(req, res);

      expect(service.getAgentAuditLogs).toHaveBeenCalledWith(testAgentId, testProjectId);
      expect((res as MockResponse).statusCode).toBe(200);
    });
  });

  describe('cloneAgent', () => {
    it('clones an agent and returns 201', async () => {
      const cloned = { ...mockAgent, id: 'agent_cloned001', name: 'Test Agent (Copy)' };
      service.cloneAgent.mockResolvedValue(cloned);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testAgentId },
        body: {},
      });
      const res = createMockResponse();

      await (controller as any).cloneAgent(req, res);

      expect(service.cloneAgent).toHaveBeenCalledWith(testProjectId, testAgentId, {}, testContext);
      expect((res as MockResponse).statusCode).toBe(201);
      expect((res as MockResponse).jsonBody).toBe(cloned);
    });

    it('throws ForbiddenError when lacking AGENT_WRITE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testAgentId },
        body: {},
      });
      const res = createMockResponse();

      await expect((controller as any).cloneAgent(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('registerRoutes', () => {
    it('registers all agent routes', () => {
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
      const paths = AgentController.getOpenAPIPaths();
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path).toHaveProperty('path');
        expect(path.path.startsWith('/api/projects/{projectId}/agents')).toBe(true);
        expect(path).toHaveProperty('method');
      }
    });
  });
});
