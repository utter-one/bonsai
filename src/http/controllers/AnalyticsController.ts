import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { AnalyticsService } from '../../services/AnalyticsService';
import { analyticsQuerySchema, analyticsRouteParamsSchema, analyticsConversationRouteParamsSchema, latencyTrendQuerySchema, latencyStatsResponseSchema, latencyPercentilesResponseSchema, latencyTrendResponseSchema, conversationTimelineResponseSchema } from '../contracts/analytics';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for conversation analytics endpoints.
 * Provides aggregated latency statistics, percentile distributions, time-series trends,
 * and per-conversation turn-level timing breakdowns.
 */
@singleton()
export class AnalyticsController {
  constructor(@inject(AnalyticsService) private readonly analyticsService: AnalyticsService) {}

  /** OpenAPI path definitions for all analytics endpoints */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'get',
        path: '/api/projects/{projectId}/analytics/latency',
        tags: ['Analytics'],
        summary: 'Get aggregated latency statistics',
        description: 'Returns aggregated latency statistics (avg, median, p95, min, max) for key turn-level metrics across conversations in the project. Supports filtering by date range, stage, and input source.',
        request: { query: analyticsQuerySchema },
        responses: {
          200: { description: 'Aggregated latency statistics', content: { 'application/json': { schema: latencyStatsResponseSchema } } },
          400: { description: 'Invalid query parameters' },
          403: { description: 'Insufficient permissions' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/analytics/latency/percentiles',
        tags: ['Analytics'],
        summary: 'Get latency percentile distributions',
        description: 'Returns percentile distributions (p50, p75, p90, p95, p99) for key turn-level duration metrics. Useful for understanding latency spread and tail performance.',
        request: { query: analyticsQuerySchema },
        responses: {
          200: { description: 'Latency percentile distributions', content: { 'application/json': { schema: latencyPercentilesResponseSchema } } },
          400: { description: 'Invalid query parameters' },
          403: { description: 'Insufficient permissions' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/analytics/latency/trend',
        tags: ['Analytics'],
        summary: 'Get latency trend over time',
        description: 'Returns a time-series of average latency values bucketed by the specified interval (hour, day, or week). Useful for detecting latency regressions or improvements over time.',
        request: { query: latencyTrendQuerySchema },
        responses: {
          200: { description: 'Latency trend time series', content: { 'application/json': { schema: latencyTrendResponseSchema } } },
          400: { description: 'Invalid query parameters' },
          403: { description: 'Insufficient permissions' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/analytics/conversations/{conversationId}/timeline',
        tags: ['Analytics'],
        summary: 'Get conversation timeline',
        description: 'Returns an ordered list of per-turn timing breakdowns for a specific conversation. Each turn combines user-side and assistant-side timing into a single row for waterfall visualization.',
        responses: {
          200: { description: 'Conversation timeline with per-turn timing', content: { 'application/json': { schema: conversationTimelineResponseSchema } } },
          403: { description: 'Insufficient permissions' },
          404: { description: 'Conversation not found' },
        },
      },
    ];
  }

  /** Register all routes for this controller */
  registerRoutes(router: Router): void {
    router.get('/api/projects/:projectId/analytics/latency/percentiles', asyncHandler(this.getLatencyPercentiles.bind(this)));
    router.get('/api/projects/:projectId/analytics/latency/trend', asyncHandler(this.getLatencyTrend.bind(this)));
    router.get('/api/projects/:projectId/analytics/latency', asyncHandler(this.getLatencyStats.bind(this)));
    router.get('/api/projects/:projectId/analytics/conversations/:conversationId/timeline', asyncHandler(this.getConversationTimeline.bind(this)));
  }

  /**
   * GET /api/projects/:projectId/analytics/latency
   * Returns aggregated latency statistics for the project
   */
  private async getLatencyStats(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ANALYTICS_READ]);
    const { projectId } = analyticsRouteParamsSchema.parse(req.params);
    const query = analyticsQuerySchema.parse(req.query);
    const result = await this.analyticsService.getLatencyStats(projectId, query, req.context);
    res.status(200).json(result);
  }

  /**
   * GET /api/projects/:projectId/analytics/latency/percentiles
   * Returns percentile distributions for key latency metrics
   */
  private async getLatencyPercentiles(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ANALYTICS_READ]);
    const { projectId } = analyticsRouteParamsSchema.parse(req.params);
    const query = analyticsQuerySchema.parse(req.query);
    const result = await this.analyticsService.getLatencyPercentiles(projectId, query, req.context);
    res.status(200).json(result);
  }

  /**
   * GET /api/projects/:projectId/analytics/latency/trend
   * Returns a time-series trend of average latency values
   */
  private async getLatencyTrend(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ANALYTICS_READ]);
    const { projectId } = analyticsRouteParamsSchema.parse(req.params);
    const query = latencyTrendQuerySchema.parse(req.query);
    const result = await this.analyticsService.getLatencyTrend(projectId, query, req.context);
    res.status(200).json(result);
  }

  /**
   * GET /api/projects/:projectId/analytics/conversations/:conversationId/timeline
   * Returns per-turn timing breakdown for a specific conversation
   */
  private async getConversationTimeline(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ANALYTICS_READ]);
    const { projectId, conversationId } = analyticsConversationRouteParamsSchema.parse(req.params);
    const result = await this.analyticsService.getConversationTimeline(projectId, conversationId, req.context);
    res.status(200).json(result);
  }
}
