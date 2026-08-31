import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { StatusPageService } from '../../services/monitoring/StatusPageService';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';
import { statusPageQuerySchema, statusPageResponseSchema } from '../contracts/statusPage';

/**
 * Controller for the status page (SPEC-status-page-v1) — aggregates health_checks +
 * providers into the current-state payload rendered by the Console Status page.
 *
 * GET /api/monitoring/status requires `system:monitoring` (enforced at both layers —
 * defense in depth, house convention).
 */
@singleton()
export class StatusPageController {
  constructor(@inject(StatusPageService) private readonly statusPageService: StatusPageService) {}

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'get',
        path: '/api/monitoring/status',
        tags: ['Monitoring'],
        summary: 'Current status page payload',
        description: 'Aggregated current state of core checks, background-service heartbeats, and all configured providers, plus per-check status counts over the window (default 60 min). Data source: health_checks (60 s cadence).',
        request: {
          query: statusPageQuerySchema,
        },
        responses: {
          200: {
            description: 'Current status page payload',
            content: {
              'application/json': {
                schema: statusPageResponseSchema,
              },
            },
          },
          400: { description: 'Invalid query parameters' },
          401: { description: 'Authentication required' },
          403: { description: 'Insufficient permissions (requires system:monitoring)' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    router.get('/api/monitoring/status', asyncHandler(this.getStatus.bind(this)));
  }

  /**
   * GET /api/monitoring/status
   */
  private async getStatus(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SYSTEM_MONITORING]);
    const query = statusPageQuerySchema.parse(req.query);
    const status = await this.statusPageService.getStatus(req.context, query.windowMinutes, query.days);
    res.status(200).json(status);
  }
}
