import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { IssueService } from '../../services/IssueService';
import { createIssueSchema, updateIssueBodySchema, issueResponseSchema, issueListResponseSchema, issueRouteParamsSchema } from '../contracts/issue';
import type { CreateIssueRequest, UpdateIssueRequest } from '../contracts/issue';
import { listParamsSchema } from '../contracts/common';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for issue management with explicit routing
 */
@singleton()
export class IssueController {
  constructor(@inject(IssueService) private readonly issueService: IssueService) {}

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/issues',
        tags: ['Issues'],
        summary: 'Create a new issue',
        description: 'Creates a new issue report with bug details, environment, and severity information',
        request: {
          body: {
            content: {
              'application/json': {
                schema: createIssueSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Issue created successfully',
            content: {
              'application/json': {
                schema: issueResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
        },
      },
      {
        method: 'get',
        path: '/api/issues/{id}',
        tags: ['Issues'],
        summary: 'Get issue by ID',
        description: 'Retrieves a single issue by its unique identifier',
        request: {
          params: issueRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Issue retrieved successfully',
            content: {
              'application/json': {
                schema: issueResponseSchema,
              },
            },
          },
          404: { description: 'Issue not found' },
        },
      },
      {
        method: 'get',
        path: '/api/issues',
        tags: ['Issues'],
        summary: 'List issues',
        description: 'Retrieves a paginated list of issues with optional filtering by status, severity, environment, and text search in bug descriptions',
        request: {
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'List of issues retrieved successfully',
            content: {
              'application/json': {
                schema: issueListResponseSchema,
              },
            },
          },
          400: { description: 'Invalid query parameters' },
        },
      },
      {
        method: 'put',
        path: '/api/issues/{id}',
        tags: ['Issues'],
        summary: 'Update issue',
        description: 'Updates an existing issue with new information, typically used to change status, add comments, or update severity',
        request: {
          params: issueRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: updateIssueBodySchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Issue updated successfully',
            content: {
              'application/json': {
                schema: issueResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Issue not found' },
        },
      },
      {
        method: 'delete',
        path: '/api/issues/{id}',
        tags: ['Issues'],
        summary: 'Delete issue',
        description: 'Deletes an issue from the system',
        request: {
          params: issueRouteParamsSchema,
        },
        responses: {
          204: { description: 'Issue deleted successfully' },
          404: { description: 'Issue not found' },
        },
      },
      {
        method: 'get',
        path: '/api/issues/{id}/audit-logs',
        tags: ['Issues'],
        summary: 'Get issue audit logs',
        description: 'Retrieves audit logs for a specific issue showing its change history',
        request: {
          params: issueRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Audit logs retrieved successfully',
          },
          404: { description: 'Issue not found' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    router.post('/api/issues', asyncHandler(this.createIssue.bind(this)));
    router.get('/api/issues/:id', asyncHandler(this.getIssueById.bind(this)));
    router.get('/api/issues', asyncHandler(this.listIssues.bind(this)));
    router.put('/api/issues/:id', asyncHandler(this.updateIssue.bind(this)));
    router.delete('/api/issues/:id', asyncHandler(this.deleteIssue.bind(this)));
    router.get('/api/issues/:id/audit-logs', asyncHandler(this.getIssueAuditLogs.bind(this)));
  }

  /**
   * POST /api/issues
   * Create a new issue
   */
  private async createIssue(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ISSUE_WRITE]);
    const body = createIssueSchema.parse(req.body);
    const issue = await this.issueService.createIssue(body, req.context);
    res.status(201).json(issue);
  }

  /**
   * GET /api/issues/:id
   * Get an issue by ID
   */
  private async getIssueById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ISSUE_READ]);
    const params = issueRouteParamsSchema.parse(req.params);
    const issue = await this.issueService.getIssueById(parseInt(params.id, 10));
    res.status(200).json(issue);
  }

  /**
   * GET /api/issues
   * List issues with optional filters
   */
  private async listIssues(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ISSUE_READ]);
    const query = listParamsSchema.parse(req.query);
    const issues = await this.issueService.listIssues(query);
    res.status(200).json(issues);
  }

  /**
   * PUT /api/issues/:id
   * Update an issue
   */
  private async updateIssue(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ISSUE_WRITE]);
    const params = issueRouteParamsSchema.parse(req.params);
    const body = updateIssueBodySchema.parse(req.body);
    const issue = await this.issueService.updateIssue(parseInt(params.id, 10), body, req.context);
    res.status(200).json(issue);
  }

  /**
   * DELETE /api/issues/:id
   * Delete an issue
   */
  private async deleteIssue(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ISSUE_DELETE]);
    const params = issueRouteParamsSchema.parse(req.params);
    await this.issueService.deleteIssue(parseInt(params.id, 10), req.context);
    res.status(204).send();
  }

  /**
   * GET /api/issues/:id/audit-logs
   * Get audit logs for an issue
   */
  private async getIssueAuditLogs(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.AUDIT_READ]);
    const params = issueRouteParamsSchema.parse(req.params);
    const logs = await this.issueService.getIssueAuditLogs(parseInt(params.id, 10));
    res.status(200).json(logs);
  }
}
