import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { MonitoringService } from '../../services/monitoring/MonitoringService';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';
import { listParamsSchema } from '../contracts/common';
import {
  alertEventListResponseSchema,
  alertEventResponseSchema,
  alertIdParamsSchema,
  alertRuleCatalogResponseSchema,
  fallbackEventListResponseSchema,
  healthSnapshotResponseSchema,
  healthHistoryListResponseSchema,
  monitoringConfigResponseSchema,
  monitoringConfigUpdateRequestSchema,
  providersMonitoringResponseSchema,
  providerCallListResponseSchema,
  providerStatsQuerySchema,
  providerStatsResponseSchema,
  metricSeriesQuerySchema,
  metricSeriesResponseSchema,
} from '../contracts/monitoring';

/**
 * Controller for the monitoring API (P1-08 read-only, PROPOSAL §3.6; P2-03
 * alerts history/acknowledge + config management).
 *
 * All eleven endpoints require `system:monitoring` (super_admin until P2-04
 * finalizes the role matrix). Fallback events land in P3-06.
 */
@singleton()
export class MonitoringController {
  constructor(@inject(MonitoringService) private readonly monitoringService: MonitoringService) {}

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    const commonResponses = {
      400: { description: 'Invalid query parameters or request body' },
      401: { description: 'Authentication required' },
      403: { description: 'Insufficient permissions (requires system:monitoring)' },
    };
    const notFoundResponse = { 404: { description: 'Not found' } };

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
        path: '/api/monitoring/fallback-events',
        tags: ['Monitoring'],
        summary: 'Failover transition events',
        description: 'Raw fallback_events: every recorded failover transition (primary failed, fallback attempted) — which provider failed, which one served, the error class, and whether the fallback succeeded. Filters: providerId, fallbackProviderId, providerType, operation, reason, projectId, conversationId, success, createdAt.',
        request: {
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'Paginated fallback events',
            content: {
              'application/json': {
                schema: fallbackEventListResponseSchema,
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
        path: '/api/monitoring/alerts',
        tags: ['Monitoring'],
        summary: 'Alert events',
        description: 'Alert event history (P2-01/P2-02), newest fired_at first by default. Items include the full notifications delivery trail. Filters: id, ruleId, scopeKey, severity (info|warning|critical), status (firing|resolved), firedAt, resolvedAt, ackedAt (operators supported, e.g. filters[firedAt][op]=between&filters[firedAt][value][0]=from&filters[firedAt][value][1]=to); textSearch over message, scopeKey, ruleId.',
        request: {
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'Paginated alert events',
            content: {
              'application/json': {
                schema: alertEventListResponseSchema,
              },
            },
          },
          ...commonResponses,
        },
      },
      {
        method: 'get',
        path: '/api/monitoring/alerts/{id}',
        tags: ['Monitoring'],
        summary: 'Alert event by id',
        description: 'A single alert event with its notification delivery trail and acknowledgment stamps.',
        request: {
          params: alertIdParamsSchema,
        },
        responses: {
          200: {
            description: 'Alert event',
            content: {
              'application/json': {
                schema: alertEventResponseSchema,
              },
            },
          },
          ...notFoundResponse,
          ...commonResponses,
        },
      },
      {
        method: 'post',
        path: '/api/monitoring/alerts/{id}/acknowledge',
        tags: ['Monitoring'],
        summary: 'Acknowledge alert event',
        description: 'Stamps acked_at + acked_by (the authenticated operator) exactly once — a second ack returns 200 with the existing stamps (idempotent, no overwrite). Writes an audit entry on the first ack.',
        request: {
          params: alertIdParamsSchema,
        },
        responses: {
          200: {
            description: 'Alert event with acknowledgment stamps',
            content: {
              'application/json': {
                schema: alertEventResponseSchema,
              },
            },
          },
          ...notFoundResponse,
          ...commonResponses,
        },
      },
      {
        method: 'delete',
        path: '/api/monitoring/alerts/{id}',
        tags: ['Monitoring'],
        summary: 'Delete alert event',
        description: 'Permanently deletes one alert event — for stalled alerts or known situations without an easy resolution (e.g. a deleted provider). Returns the deleted event and writes a DELETE audit entry for the alert_event entity. The alert engine may fire a NEW row for the same rule/scope later if the condition still holds; disable the rule in the monitoring config to silence it permanently.',
        request: {
          params: alertIdParamsSchema,
        },
        responses: {
          200: {
            description: 'Deleted alert event',
            content: {
              'application/json': {
                schema: alertEventResponseSchema,
              },
            },
          },
          ...notFoundResponse,
          ...commonResponses,
        },
      },
      {
        method: 'get',
        path: '/api/monitoring/config',
        tags: ['Monitoring'],
        summary: 'Monitoring config',
        description: 'The current validated monitoring config (notifiers, rule overrides, retention, probe + alerting settings) plus the optimistic-lock version.',
        responses: {
          200: {
            description: 'Monitoring config + version',
            content: {
              'application/json': {
                schema: monitoringConfigResponseSchema,
              },
            },
          },
          ...commonResponses,
        },
      },
      {
        method: 'put',
        path: '/api/monitoring/config',
        tags: ['Monitoring'],
        summary: 'Replace monitoring config',
        description: 'Full-replace the monitoring config under optimistic lock. `version` must match the current row version (409 on mismatch); invalid config (unknown rule id, bad notifier, retention < 7) returns 400. On success the running engine and notifiers observe the new config on their next evaluation/delivery — no restart. The audit entry stores sanitized before/after summaries (webhook URLs are replaced by hasUrl).',
        request: {
          body: {
            content: {
              'application/json': {
                schema: monitoringConfigUpdateRequestSchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Updated monitoring config + new version',
            content: {
              'application/json': {
                schema: monitoringConfigResponseSchema,
              },
            },
          },
          409: { description: 'Version mismatch (stale version) — re-GET and retry' },
          ...commonResponses,
        },
      },
      {
        method: 'get',
        path: '/api/monitoring/rules',
        tags: ['Monitoring'],
        summary: 'Alert rule catalog',
        description: 'Static catalog of all built-in alert rules (id, scope, severity, one-line summary, default parameters). Served from the engine rule registry — the same source the evaluators run from — so it never drifts from the config keys PUT /api/monitoring/config accepts under `rules`.',
        responses: {
          200: {
            description: 'All built-in alert rules',
            content: {
              'application/json': {
                schema: alertRuleCatalogResponseSchema,
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
    router.get('/api/monitoring/fallback-events', asyncHandler(this.listFallbackEvents.bind(this)));
    router.get('/api/monitoring/provider-stats', asyncHandler(this.getProviderStats.bind(this)));
    router.get('/api/monitoring/metrics', asyncHandler(this.getMetrics.bind(this)));
    router.get('/api/monitoring/alerts', asyncHandler(this.listAlerts.bind(this)));
    router.get('/api/monitoring/alerts/:id', asyncHandler(this.getAlert.bind(this)));
    router.post('/api/monitoring/alerts/:id/acknowledge', asyncHandler(this.acknowledgeAlert.bind(this)));
    router.delete('/api/monitoring/alerts/:id', asyncHandler(this.deleteAlert.bind(this)));
    router.get('/api/monitoring/config', asyncHandler(this.getConfig.bind(this)));
    router.put('/api/monitoring/config', asyncHandler(this.updateConfig.bind(this)));
    router.get('/api/monitoring/rules', asyncHandler(this.getRules.bind(this)));
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
   * GET /api/monitoring/fallback-events
   */
  private async listFallbackEvents(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SYSTEM_MONITORING]);
    const query = listParamsSchema.parse(req.query);
    const events = await this.monitoringService.listFallbackEvents(req.context, query);
    res.status(200).json(events);
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

  /**
   * GET /api/monitoring/alerts
   */
  private async listAlerts(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SYSTEM_MONITORING]);
    const query = listParamsSchema.parse(req.query);
    const alerts = await this.monitoringService.listAlerts(req.context, query);
    res.status(200).json(alerts);
  }

  /**
   * GET /api/monitoring/alerts/:id
   */
  private async getAlert(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SYSTEM_MONITORING]);
    const { id } = alertIdParamsSchema.parse(req.params);
    const alert = await this.monitoringService.getAlert(req.context, id);
    res.status(200).json(alert);
  }

  /**
   * POST /api/monitoring/alerts/:id/acknowledge
   */
  private async acknowledgeAlert(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SYSTEM_MONITORING]);
    const { id } = alertIdParamsSchema.parse(req.params);
    const alert = await this.monitoringService.acknowledgeAlert(req.context, id);
    res.status(200).json(alert);
  }

  /**
   * DELETE /api/monitoring/alerts/:id
   */
  private async deleteAlert(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SYSTEM_MONITORING]);
    const { id } = alertIdParamsSchema.parse(req.params);
    const alert = await this.monitoringService.deleteAlert(req.context, id);
    res.status(200).json(alert);
  }

  /**
   * GET /api/monitoring/config
   */
  private async getConfig(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SYSTEM_MONITORING]);
    const config = await this.monitoringService.getConfig(req.context);
    res.status(200).json(config);
  }

  /**
   * GET /api/monitoring/rules
   */
  private async getRules(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SYSTEM_MONITORING]);
    const catalog = this.monitoringService.getRuleCatalog(req.context);
    res.status(200).json(catalog);
  }

  /**
   * PUT /api/monitoring/config
   */
  private async updateConfig(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SYSTEM_MONITORING]);
    const body = monitoringConfigUpdateRequestSchema.parse(req.body);
    const config = await this.monitoringService.updateConfig(req.context, body);
    res.status(200).json(config);
  }
}
