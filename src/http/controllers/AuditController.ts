import 'reflect-metadata';
import { JsonController, Get, QueryParams, Req } from 'routing-controllers';
import { injectable, inject } from 'tsyringe';
import { Validated } from '../decorators/validation';
import { OpenAPI } from '../decorators/openapi';
import { RequirePermissions } from '../decorators/auth';
import { PERMISSIONS } from '../../permissions';
import type { Request } from 'express';
import { AuditService } from '../../services/AuditService';
import { auditLogResponseSchema, auditLogListResponseSchema } from '../contracts/audit';
import { listParamsSchema } from '../contracts/common';
import type { ListParams } from '../contracts/common';

/**
 * Controller for audit log management with decorator-based routing
 * Provides endpoints for querying audit logs across all entity types
 */
@injectable()
@JsonController('/api/audit-logs')
export class AuditController {
  constructor(@inject(AuditService) private readonly auditService: AuditService) {}

  /**
   * GET /api/audit-logs
   * List all audit logs with optional filters
   */
  @RequirePermissions([PERMISSIONS.AUDIT_READ])
  @OpenAPI({
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
  })
  @Get('/')
  async listAuditLogs(@Validated(listParamsSchema, 'query') @QueryParams() query: ListParams, @Req() req: Request) {
    return await this.auditService.listAuditLogs(query);
  }
}
