import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';
import { UnauthorizedError, ForbiddenError } from '../../src/errors';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { AnalyticsController } from '../../src/http/controllers/AnalyticsController';

const testProjectId = 'proj_test001';
const testConversationId = 'conv_test001';
const testContext = {
  operatorId: 'oper_test001',
  roles: ['super_admin'],
  ip: '127.0.0.1',
  userAgent: 'test/1.0',
  requestId: 'req_test001',
  timestamp: new Date('2025-01-01T00:00:00Z'),
};

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let analyticsService: any;
  let sliceAnalyticsService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    analyticsService = {
      getLatencyStats: vi.fn(),
      getLatencyPercentiles: vi.fn(),
      getLatencyTrend: vi.fn(),
      getConversationTimeline: vi.fn(),
      getTokenUsageStats: vi.fn(),
      getTokenUsageTrend: vi.fn(),
    };
    sliceAnalyticsService = {
      getCatalog: vi.fn(),
      query: vi.fn(),
    };
    controller = new AnalyticsController(analyticsService, sliceAnalyticsService);
  });

  describe('getLatencyStats', () => {
    it('returns latency stats with 200', async () => {
      const mockStats = { avgDuration: 1200, minDuration: 500, maxDuration: 3000 };
      analyticsService.getLatencyStats.mockResolvedValue(mockStats);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId },
        query: {},
      });
      const res = createMockResponse();

      await (controller as any).getLatencyStats(req, res);

      expect(analyticsService.getLatencyStats).toHaveBeenCalledWith(testProjectId, expect.any(Object), testContext);
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const req = createMockRequest({ user: undefined, params: { projectId: testProjectId }, query: {} });
      (req as any).url = '/api/projects/test/analytics/latency';
      (req as any).method = 'GET';
      const res = createMockResponse();

      await expect((controller as any).getLatencyStats(req, res)).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError when lacking ANALYTICS_READ', async () => {
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: [] },
        params: { projectId: testProjectId },
        query: {},
      });
      (req as any).url = '/api/projects/test/analytics/latency';
      (req as any).method = 'GET';
      const res = createMockResponse();

      await expect((controller as any).getLatencyStats(req, res)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getLatencyPercentiles', () => {
    it('returns latency percentiles with 200', async () => {
      const mockPercentiles = { p50: 1000, p95: 2500, p99: 3500 };
      analyticsService.getLatencyPercentiles.mockResolvedValue(mockPercentiles);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId },
        query: {},
      });
      const res = createMockResponse();

      await (controller as any).getLatencyPercentiles(req, res);

      expect(analyticsService.getLatencyPercentiles).toHaveBeenCalledWith(testProjectId, expect.any(Object), testContext);
      expect((res as MockResponse).statusCode).toBe(200);
    });
  });

  describe('getLatencyTrend', () => {
    it('returns latency trend with 200', async () => {
      const mockTrend = [{ timestamp: '2025-01-01', avgDuration: 1200 }];
      analyticsService.getLatencyTrend.mockResolvedValue(mockTrend);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId },
        query: {},
      });
      const res = createMockResponse();

      await (controller as any).getLatencyTrend(req, res);

      expect(analyticsService.getLatencyTrend).toHaveBeenCalledWith(testProjectId, expect.any(Object), testContext);
      expect((res as MockResponse).statusCode).toBe(200);
    });
  });

  describe('getConversationTimeline', () => {
    it('returns conversation timeline with 200', async () => {
      const mockTimeline = [{ turnId: 'turn1', duration: 1500 }];
      analyticsService.getConversationTimeline.mockResolvedValue(mockTimeline);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId, conversationId: testConversationId },
      });
      const res = createMockResponse();

      await (controller as any).getConversationTimeline(req, res);

      expect(analyticsService.getConversationTimeline).toHaveBeenCalledWith(testProjectId, testConversationId, testContext);
      expect((res as MockResponse).statusCode).toBe(200);
    });
  });

  describe('getTokenUsageStats', () => {
    it('returns token usage stats with 200', async () => {
      const mockStats = { totalPromptTokens: 1000, totalCompletionTokens: 500 };
      analyticsService.getTokenUsageStats.mockResolvedValue(mockStats);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId },
        query: {},
      });
      const res = createMockResponse();

      await (controller as any).getTokenUsageStats(req, res);

      expect(analyticsService.getTokenUsageStats).toHaveBeenCalledWith(testProjectId, expect.any(Object), testContext);
      expect((res as MockResponse).statusCode).toBe(200);
    });
  });

  describe('getTokenUsageTrend', () => {
    it('returns token usage trend with 200', async () => {
      const mockTrend = [{ timestamp: '2025-01-01', tokens: 5000 }];
      analyticsService.getTokenUsageTrend.mockResolvedValue(mockTrend);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId },
        query: {},
      });
      const res = createMockResponse();

      await (controller as any).getTokenUsageTrend(req, res);

      expect(analyticsService.getTokenUsageTrend).toHaveBeenCalledWith(testProjectId, expect.any(Object), testContext);
      expect((res as MockResponse).statusCode).toBe(200);
    });
  });

  describe('getSourceCatalog', () => {
    it('returns source catalog with 200', async () => {
      const mockCatalog = [{ id: 'conversations', name: 'Conversations' }];
      sliceAnalyticsService.getCatalog.mockReturnValue(mockCatalog);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        params: { projectId: testProjectId },
      });
      const res = createMockResponse();

      await (controller as any).getSourceCatalog(req, res);

      expect(sliceAnalyticsService.getCatalog).toHaveBeenCalled();
      expect((res as MockResponse).statusCode).toBe(200);
    });
  });

  describe('querySlice', () => {
    it('executes slice query and returns results with 200', async () => {
      const mockResult = { rows: [{ dimension: 'value', metric: 100 }] };
      sliceAnalyticsService.query.mockResolvedValue(mockResult);
      const req = createMockRequest({
        user: { operatorId: 'oper_test001', roles: ['super_admin'] },
        context: testContext,
        params: { projectId: testProjectId },
        query: { source: 'conversations', metrics: 'count' },
      });
      const res = createMockResponse();

      await (controller as any).querySlice(req, res);

      expect(sliceAnalyticsService.query).toHaveBeenCalledWith(testProjectId, expect.any(Object), testContext);
      expect((res as MockResponse).statusCode).toBe(200);
    });
  });

  describe('registerRoutes', () => {
    it('registers all analytics routes', () => {
      const mockRouter = { get: vi.fn() } as any;
      controller.registerRoutes(mockRouter);

      expect(mockRouter.get).toHaveBeenCalledTimes(8);
    });
  });

  describe('getOpenAPIPaths', () => {
    it('returns OpenAPI path definitions for all endpoints', () => {
      const paths = AnalyticsController.getOpenAPIPaths();
      expect(paths.length).toBe(8);
      for (const path of paths) {
        expect(path).toHaveProperty('path');
        expect(path.path.startsWith('/api/projects/{projectId}/analytics')).toBe(true);
        expect(path).toHaveProperty('method');
      }
    });
  });
});
