import { inject, singleton } from 'tsyringe';
import type { Request, Response, NextFunction, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { AuditService } from '../../services/AuditService';
import { auditLogResponseSchema, auditLogListResponseSchema } from '../contracts/audit';
import { listParamsSchema } from '../contracts/common';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for audit log management with explicit routing
 */
@singleton()
export class AuditController {
  constructor(@inject(AuditService) private readonly auditService: AuditService) {}

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'get',
        path: '/api/audit-logs',
        tags: ['Audit Logs'],
        summary: 'List audit logs',
        description: 'Retrieves a paginated list of audit logs with optional filtering by entity type, action, user, or date range. Use filters for precise queries: entityType, action (CREATE/UPDATE/DELETE), userId, entityId, or date ranges with operators (gte, lte, between).',
        request: {
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'List of audit logs retrieved successfully',
            content: {
              'application/json': {
                schema: auditLogListResponseSchema,
              },
            },
          },
          400: { description: 'Invalid query parameters' },
          403: { description: 'Insufficient permissions' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    router.get('/api/audit-logs', asyncHandler(this.listAuditLogs.bind(this)));
  }

  /**
   * GET /api/audit-logs
   * List all audit logs with optional filters
   */
  private async listAuditLogs(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.AUDIT_READ]);
    const query = listParamsSchema.parse(req.query);
    const auditLogs = await this.auditService.listAuditLogs(query);
    res.status(200).json(auditLogs);
  }
}
