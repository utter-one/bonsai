import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';
import { UnauthorizedError, ForbiddenError } from '../../src/errors';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { ConversationController } from '../../src/http/controllers/ConversationController';

const testProjectId = 'proj_test001';
const testConversationId = 'conv_test001';
const testEventId = 'event_test001';
const testContext = {
  operatorId: 'oper_test001',
  roles: ['super_admin'],
  ip: '127.0.0.1',
  userAgent: 'test/1.0',
  requestId: 'req_test001',
  timestamp: new Date('2025-01-01T00:00:00Z'),
};

const mockConversation = {
  id: testConversationId,
  projectId: testProjectId,
  userId: 'user_test001',
  sessionId: 'session_test001',
  stageId: 'stage_001',
  status: 'active',
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

const mockEvent = {
  id: testEventId,
  projectId: testProjectId,
  conversationId: testConversationId,
  eventType: 'user_message',
  eventData: {},
  timestamp: new Date('2025-01-01T00:00:00Z'),
};

describe('ConversationController', () => {
  let controller: ConversationController;
  let service: any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = {
      getConversationById: vi.fn(),
      listConversations: vi.fn(),
      deleteConversation: vi.fn(),
      getConversationEvents: vi.fn(),
      getConversationEventById: vi.fn(),
      getConversationAuditLogs: vi.fn(),
    };
    controller = new ConversationController(service);
  });

  describe('getConversationById', () => {
    it('returns a conversation with 200', async () => {
      service.getConversationById.mockResolvedValue(mockConversation);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testConversationId },
      });
      const res = createMockResponse();

      await (controller as any).getConversationById(req, res);

      expect(service.getConversationById).toHaveBeenCalledWith(testProjectId, testConversationId);
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId, id: testConversationId } });
      const res = createMockResponse();

      await expect((controller as any).getConversationById(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('listConversations', () => {
    it('returns paginated conversations with 200', async () => {
      const mockList = { items: [mockConversation], total: 1, offset: 0, limit: 25 };
      service.listConversations.mockResolvedValue(mockList);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId },
        query: {},
      });
      const res = createMockResponse();

      await (controller as any).listConversations(req, res);

      expect(service.listConversations).toHaveBeenCalledWith(testProjectId, expect.any(Object));
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, query: {} });
      const res = createMockResponse();

      await expect((controller as any).listConversations(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('deleteConversation', () => {
    it('deletes a conversation and returns 204', async () => {
      service.deleteConversation.mockResolvedValue(undefined);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, id: testConversationId },
      });
      const res = createMockResponse();

      await (controller as any).deleteConversation(req, res);

      expect(service.deleteConversation).toHaveBeenCalledWith(testProjectId, testConversationId, testContext);
      expect((res as MockResponse).statusCode).toBe(204);
    });

    it('throws ForbiddenError when lacking CONVERSATION_DELETE', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['viewer'] },
        params: { projectId: testProjectId, id: testConversationId },
      });
      const res = createMockResponse();

      await expect((controller as any).deleteConversation(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getConversationEvents', () => {
    it('returns paginated events with 200', async () => {
      const mockList = { items: [mockEvent], total: 1, offset: 0, limit: 25 };
      service.getConversationEvents.mockResolvedValue(mockList);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testConversationId },
        query: {},
      });
      const res = createMockResponse();

      await (controller as any).getConversationEvents(req, res);

      expect(service.getConversationEvents).toHaveBeenCalledWith(testProjectId, testConversationId, expect.any(Object));
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId, id: testConversationId }, query: {} });
      const res = createMockResponse();

      await expect((controller as any).getConversationEvents(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('getConversationEventById', () => {
    it('returns a specific event with 200', async () => {
      service.getConversationEventById.mockResolvedValue(mockEvent);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testConversationId, eventId: testEventId },
      });
      const res = createMockResponse();

      await (controller as any).getConversationEventById(req, res);

      expect(service.getConversationEventById).toHaveBeenCalledWith(testProjectId, testConversationId, testEventId);
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId, id: testConversationId, eventId: testEventId } });
      const res = createMockResponse();

      await expect((controller as any).getConversationEventById(req, res)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('getConversationAuditLogs', () => {
    it('returns audit logs with 200', async () => {
      const mockLogs = [{ id: 'log1', action: 'create' }];
      service.getConversationAuditLogs.mockResolvedValue(mockLogs);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId, id: testConversationId },
      });
      const res = createMockResponse();

      await (controller as any).getConversationAuditLogs(req, res);

      expect(service.getConversationAuditLogs).toHaveBeenCalledWith(testConversationId, testProjectId);
      expect((res as MockResponse).statusCode).toBe(200);
    });
  });

  describe('registerRoutes', () => {
    it('registers all conversation routes', () => {
      const mockRouter = { post: vi.fn(), get: vi.fn(), put: vi.fn(), delete: vi.fn() } as any;
      controller.registerRoutes(mockRouter);

      expect(mockRouter.post).toHaveBeenCalledTimes(0);
      expect(mockRouter.get).toHaveBeenCalledTimes(5);
      expect(mockRouter.put).toHaveBeenCalledTimes(0);
      expect(mockRouter.delete).toHaveBeenCalledTimes(1);
    });
  });

  describe('getOpenAPIPaths', () => {
    it('returns OpenAPI path definitions for all endpoints', () => {
      const paths = ConversationController.getOpenAPIPaths();
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path).toHaveProperty('path');
        expect(path.path.startsWith('/api/projects/{projectId}/conversations')).toBe(true);
        expect(path).toHaveProperty('method');
      }
    });
  });
});
