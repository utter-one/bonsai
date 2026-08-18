import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { MonitoringService } from '../../services/monitoring/MonitoringService';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';
import { listParamsSchema } from '../contracts/common';
import {
  healthSnapshotResponseSchema,
  healthHistoryListResponseSchema,
  providersMonitoringResponseSchema,
  providerCallListResponseSchema,
  providerStatsQuerySchema,
  providerStatsResponseSchema,
  metricSeriesQuerySchema,
  metricSeriesResponseSchema,
} from '../contracts/monitoring';

/**
 * Controller for the read-only monitoring API (P1-08, PROPOSAL §3.6).
 *
 * All six endpoints require `system:monitoring` (super_admin in Phase 1 —
 * the role matrix is finalized in P2-04). Write endpoints (config) land in P2-03,
 * alerts in P2-03, fallback events in P3-06.
 */
@singleton()
export class MonitoringController {
  constructor(@inject(MonitoringService) private readonly monitoringService: MonitoringService) {}

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    const commonResponses = {
      400: { description: 'Invalid query parameters' },
      401: { description: 'Authentication required' },
      403: { description: 'Insufficient permissions (requires system:monitoring)' },
    };

    return [
      {
        method: 'get',
        path: '/api/monitoring/health',
        tags: ['Monitoring'],
        summary: 'Current health snapshot',
        description: 'The in-memory snapshot of the last completed health check cycle (db, process, service heartbeats, providers).',
        responses: {
          200: {
            description: 'Current health snapshot',
            content: {
              'application/json': {
                schema: healthSnapshotResponseSchema,
              },
            },
          },
          ...commonResponses,
        },
      },
      {
        method: 'get',
        path: '/api/monitoring/health/history',
        tags: ['Monitoring'],
        summary: 'Health check history',
        description: 'Persisted health check rows, newest first. Filters: check (alias of checkName), status, latencyMs, createdAt (operators supported, e.g. filters[createdAt][op]=between&filters[createdAt][value][0]=from&filters[createdAt][value][1]=to).',
        request: {
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'Paginated health check history',
            content: {
              'application/json': {
                schema: healthHistoryListResponseSchema,
              },
            },
          },
          ...commonResponses,
        },
      },
      {
        method: 'get',
        path: '/api/monitoring/providers',
        tags: ['Monitoring'],
        summary: 'Provider overview',
        description: 'Per provider: identity, latest probe status from the health snapshot, and a rolling 15-minute call-log window (calls, okRate, p95 duration, top error codes).',
        responses: {
          200: {
            description: 'Provider overview with rolling windows',
            content: {
              'application/json': {
                schema: providersMonitoringResponseSchema,
              },
            },
          },
          ...commonResponses,
        },
      },
      {
        method: 'get',
        path: '/api/monitoring/provider-calls',
        tags: ['Monitoring'],
        summary: 'Provider call logs',
        description: 'Raw 3rd-party call logs (one row per call, variant streaming fields in `metrics`). Filters: providerId, providerType, apiType, operation, model, projectId, conversationId, ok, errorCode, statusHttp, durationMs, fallbackProviderId, createdAt.',
        request: {
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'Paginated provider call logs',
            content: {
              'application/json': {
                schema: providerCallListResponseSchema,
              },
            },
          },
          ...commonResponses,
        },
      },
      {
        method: 'get',
        path: '/api/monitoring/provider-stats',
        tags: ['Monitoring'],
        summary: 'Aggregated provider stats',
        description: 'One aggregate row per (bucket, providerId, operation) over the window: counts, duration sum/min/max, TTFT percentiles, chunk-gap p95, stalled and RTF>1 counts. Window span is limited to 14 days.',
        request: {
          query: providerStatsQuerySchema,
        },
        responses: {
          200: {
            description: 'Aggregate stats buckets, oldest first',
            content: {
              'application/json': {
                schema: providerStatsResponseSchema,
              },
            },
          },
          ...commonResponses,
        },
      },
      {
        method: 'get',
        path: '/api/monitoring/metrics',
        tags: ['Monitoring'],
        summary: 'Metric time series',
        description: 'Generic time series over persisted metric samples: one series per exact label set, points bucketed at the requested step (1m/15m/1h). This is the JSON history surface; the Prometheus text format is a separate Phase-4 endpoint.',
        request: {
          query: metricSeriesQuerySchema,
        },
        responses: {
          200: {
            description: 'Time series per label set',
            content: {
              'application/json': {
                schema: metricSeriesResponseSchema,
              },
            },
          },
          ...commonResponses,
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    router.get('/api/monitoring/health', asyncHandler(this.getHealth.bind(this)));
    router.get('/api/monitoring/health/history', asyncHandler(this.listHealthHistory.bind(this)));
    router.get('/api/monitoring/providers', asyncHandler(this.getProviders.bind(this)));
    router.get('/api/monitoring/provider-calls', asyncHandler(this.listProviderCalls.bind(this)));
    router.get('/api/monitoring/provider-stats', asyncHandler(this.getProviderStats.bind(this)));
    router.get('/api/monitoring/metrics', asyncHandler(this.getMetrics.bind(this)));
  }

  /**
   * GET /api/monitoring/health
   */
  private async getHealth(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SYSTEM_MONITORING]);
    const snapshot = await this.monitoringService.getHealthSnapshot(req.context);
    res.status(200).json(snapshot);
  }

  /**
   * GET /api/monitoring/health/history
   */
  private async listHealthHistory(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SYSTEM_MONITORING]);
    const query = listParamsSchema.parse(req.query);
    const history = await this.monitoringService.listHealthHistory(req.context, query);
    res.status(200).json(history);
  }

  /**
   * GET /api/monitoring/providers
   */
  private async getProviders(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SYSTEM_MONITORING]);
    const overview = await this.monitoringService.getProvidersOverview(req.context);
    res.status(200).json(overview);
  }

  /**
   * GET /api/monitoring/provider-calls
   */
  private async listProviderCalls(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SYSTEM_MONITORING]);
    const query = listParamsSchema.parse(req.query);
    const calls = await this.monitoringService.listProviderCalls(req.context, query);
    res.status(200).json(calls);
  }

  /**
   * GET /api/monitoring/provider-stats
   */
  private async getProviderStats(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SYSTEM_MONITORING]);
    const query = providerStatsQuerySchema.parse(req.query);
    const stats = await this.monitoringService.getProviderStats(req.context, query);
    res.status(200).json(stats);
  }

  /**
   * GET /api/monitoring/metrics
   */
  private async getMetrics(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SYSTEM_MONITORING]);
    const query = metricSeriesQuerySchema.parse(req.query);
    const series = await this.monitoringService.getMetricSeries(req.context, query);
    res.status(200).json(series);
  }
}
