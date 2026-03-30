import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { AnalyticsService } from '../../services/AnalyticsService';
import { SliceAnalyticsService } from '../../services/SliceAnalyticsService';
import { analyticsQuerySchema, analyticsRouteParamsSchema, analyticsConversationRouteParamsSchema, latencyTrendQuerySchema, latencyStatsResponseSchema, latencyPercentilesResponseSchema, latencyTrendResponseSchema, conversationTimelineResponseSchema, tokenUsageStatsResponseSchema, tokenUsageTrendQuerySchema, tokenUsageTrendResponseSchema } from '../contracts/analytics';
import { sliceQuerySchema, sourceCatalogResponseSchema, sliceQueryResponseSchema } from '../contracts/sliceAnalytics';
import type { SliceQuery } from '../contracts/sliceAnalytics';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for conversation analytics endpoints.
 * Provides aggregated latency statistics, percentile distributions, time-series trends,
 * and per-conversation turn-level timing breakdowns.
 */
@singleton()
export class AnalyticsController {
  constructor(
    @inject(AnalyticsService) private readonly analyticsService: AnalyticsService,
    @inject(SliceAnalyticsService) private readonly sliceAnalyticsService: SliceAnalyticsService,
  ) {}

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
      {
        method: 'get',
        path: '/api/projects/{projectId}/analytics/usage',
        tags: ['Analytics'],
        summary: 'Get aggregated token usage statistics',
        description: 'Returns aggregated LLM token usage statistics broken down by event type (message, classification, transformation, tool_call). Includes total prompt tokens, completion tokens, and combined totals.',
        request: { query: analyticsQuerySchema },
        responses: {
          200: { description: 'Aggregated token usage statistics', content: { 'application/json': { schema: tokenUsageStatsResponseSchema } } },
          400: { description: 'Invalid query parameters' },
          403: { description: 'Insufficient permissions' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/analytics/usage/trend',
        tags: ['Analytics'],
        summary: 'Get token usage trend over time',
        description: 'Returns a time-series of token consumption bucketed by the specified interval (hour, day, or week). Useful for tracking LLM usage growth and optimizing prompt costs.',
        request: { query: tokenUsageTrendQuerySchema },
        responses: {
          200: { description: 'Token usage trend time series', content: { 'application/json': { schema: tokenUsageTrendResponseSchema } } },
          400: { description: 'Invalid query parameters' },
          403: { description: 'Insufficient permissions' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/analytics/sources',
        tags: ['Analytics'],
        summary: 'Get analytics source catalog',
        description: 'Returns the available analytics sources with their queryable dimensions and metrics. Use this to discover what can be queried via the /analytics/query endpoint.',
        responses: {
          200: { description: 'Analytics source catalog', content: { 'application/json': { schema: sourceCatalogResponseSchema } } },
          403: { description: 'Insufficient permissions' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/analytics/query',
        tags: ['Analytics'],
        summary: 'Slice-and-dice analytics query',
        description: 'Generic analytics query engine. Specify a source, metrics to aggregate, optional groupBy dimensions, time interval for bucketing, and filters. Returns flat rows with dimension values and computed metrics. Use GET /analytics/sources to discover available sources, dimensions, and metrics.',
        request: { query: sliceQuerySchema },
        responses: {
          200: { description: 'Slice-and-dice query results', content: { 'application/json': { schema: sliceQueryResponseSchema } } },
          400: { description: 'Invalid query parameters, unknown dimension or metric' },
          403: { description: 'Insufficient permissions' },
        },
      },
    ];
  }

  /** Register all routes for this controller */
  registerRoutes(router: Router): void {
    router.get('/api/projects/:projectId/analytics/latency/percentiles', asyncHandler(this.getLatencyPercentiles.bind(this)));
    router.get('/api/projects/:projectId/analytics/latency/trend', asyncHandler(this.getLatencyTrend.bind(this)));
    router.get('/api/projects/:projectId/analytics/latency', asyncHandler(this.getLatencyStats.bind(this)));
    router.get('/api/projects/:projectId/analytics/usage/trend', asyncHandler(this.getTokenUsageTrend.bind(this)));
    router.get('/api/projects/:projectId/analytics/usage', asyncHandler(this.getTokenUsageStats.bind(this)));
    router.get('/api/projects/:projectId/analytics/conversations/:conversationId/timeline', asyncHandler(this.getConversationTimeline.bind(this)));
    router.get('/api/projects/:projectId/analytics/sources', asyncHandler(this.getSourceCatalog.bind(this)));
    router.get('/api/projects/:projectId/analytics/query', asyncHandler(this.querySlice.bind(this)));
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

  /**
   * GET /api/projects/:projectId/analytics/usage
   * Returns aggregated token usage statistics broken down by event type
   */
  private async getTokenUsageStats(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ANALYTICS_READ]);
    const { projectId } = analyticsRouteParamsSchema.parse(req.params);
    const query = analyticsQuerySchema.parse(req.query);
    const result = await this.analyticsService.getTokenUsageStats(projectId, query, req.context);
    res.status(200).json(result);
  }

  /**
   * GET /api/projects/:projectId/analytics/usage/trend
   * Returns a time-series trend of token usage
   */
  private async getTokenUsageTrend(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ANALYTICS_READ]);
    const { projectId } = analyticsRouteParamsSchema.parse(req.params);
    const query = tokenUsageTrendQuerySchema.parse(req.query);
    const result = await this.analyticsService.getTokenUsageTrend(projectId, query, req.context);
    res.status(200).json(result);
  }

  /**
   * GET /api/projects/:projectId/analytics/sources
   * Returns the available analytics sources with their dimensions and metrics
   */
  private async getSourceCatalog(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ANALYTICS_READ]);
    const result = this.sliceAnalyticsService.getCatalog();
    res.status(200).json(result);
  }

  /**
   * GET /api/projects/:projectId/analytics/query
   * Executes a slice-and-dice analytics query against the specified source
   */
  private async querySlice(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ANALYTICS_READ]);
    const { projectId } = analyticsRouteParamsSchema.parse(req.params);
    const params = sliceQuerySchema.parse(req.query) as SliceQuery;
    const result = await this.sliceAnalyticsService.query(projectId, params, req.context);
    res.status(200).json(result);
  }
}
