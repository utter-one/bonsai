import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { TesterService } from '../../services/testing/TesterService';
import { createTesterSchema, updateTesterBodySchema, deleteTesterBodySchema, testerResponseSchema, testerListResponseSchema, testerRouteParamsSchema } from '../contracts/tester';
import { listParamsSchema, projectScopedParamsSchema } from '../contracts/common';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for tester persona management
 */
@singleton()
export class TesterController {
  constructor(@inject(TesterService) private readonly testerService: TesterService) { }

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/projects/{projectId}/testers',
        tags: ['Testers'],
        summary: 'Create a new tester',
        description: 'Creates a new tester persona for use in scenario testing',
        request: {
          body: {
            content: {
              'application/json': {
                schema: createTesterSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Tester created successfully',
            content: { 'application/json': { schema: testerResponseSchema } },
          },
          400: { description: 'Invalid request body' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/testers',
        tags: ['Testers'],
        summary: 'List testers',
        description: 'Retrieves a paginated list of testers with optional filtering and sorting',
        request: {
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'List of testers retrieved successfully',
            content: { 'application/json': { schema: testerListResponseSchema } },
          },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/testers/{id}',
        tags: ['Testers'],
        summary: 'Get tester by ID',
        description: 'Retrieves a single tester by its unique identifier',
        request: {
          params: testerRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Tester retrieved successfully',
            content: { 'application/json': { schema: testerResponseSchema } },
          },
          404: { description: 'Tester not found' },
        },
      },
      {
        method: 'put',
        path: '/api/projects/{projectId}/testers/{id}',
        tags: ['Testers'],
        summary: 'Update tester',
        description: 'Updates an existing tester with optimistic locking',
        request: {
          params: testerRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: updateTesterBodySchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Tester updated successfully',
            content: { 'application/json': { schema: testerResponseSchema } },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Tester not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'delete',
        path: '/api/projects/{projectId}/testers/{id}',
        tags: ['Testers'],
        summary: 'Delete tester',
        description: 'Deletes a tester with optimistic locking',
        request: {
          params: testerRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: deleteTesterBodySchema,
              },
            },
          },
        },
        responses: {
          204: { description: 'Tester deleted successfully' },
          404: { description: 'Tester not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/testers/{id}/audit-logs',
        tags: ['Testers'],
        summary: 'Get tester audit logs',
        description: 'Retrieves audit logs for a specific tester',
        request: {
          params: testerRouteParamsSchema,
        },
        responses: {
          200: { description: 'Audit logs retrieved successfully' },
          404: { description: 'Tester not found' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    router.post('/api/projects/:projectId/testers', asyncHandler(this.createTester.bind(this)));
    router.get('/api/projects/:projectId/testers', asyncHandler(this.listTesters.bind(this)));
    router.get('/api/projects/:projectId/testers/:id', asyncHandler(this.getTesterById.bind(this)));
    router.put('/api/projects/:projectId/testers/:id', asyncHandler(this.updateTester.bind(this)));
    router.delete('/api/projects/:projectId/testers/:id', asyncHandler(this.deleteTester.bind(this)));
    router.get('/api/projects/:projectId/testers/:id/audit-logs', asyncHandler(this.getTesterAuditLogs.bind(this)));
  }

  private async createTester(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.TESTER_WRITE]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const body = createTesterSchema.parse(req.body);
    const tester = await this.testerService.createTester(projectId, body, req.context);
    res.status(201).json(tester);
  }

  private async listTesters(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.TESTER_READ]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const query = listParamsSchema.parse(req.query);
    const testers = await this.testerService.listTesters(projectId, query);
    res.status(200).json(testers);
  }

  private async getTesterById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.TESTER_READ]);
    const params = testerRouteParamsSchema.parse(req.params);
    const tester = await this.testerService.getTesterById(params.projectId, params.id);
    res.status(200).json(tester);
  }

  private async updateTester(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.TESTER_WRITE]);
    const params = testerRouteParamsSchema.parse(req.params);
    const body = updateTesterBodySchema.parse(req.body);
    const tester = await this.testerService.updateTester(params.projectId, params.id, body, req.context);
    res.status(200).json(tester);
  }

  private async deleteTester(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.TESTER_DELETE]);
    const params = testerRouteParamsSchema.parse(req.params);
    const body = deleteTesterBodySchema.parse(req.body);
    await this.testerService.deleteTester(params.projectId, params.id, body.version, req.context);
    res.status(204).send();
  }

  /**
   * GET /api/projects/:projectId/testers/:id/audit-logs
   * Get audit logs for a tester
   */
  private async getTesterAuditLogs(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.AUDIT_READ]);
    const params = testerRouteParamsSchema.parse(req.params);
    const logs = await this.testerService.getTesterAuditLogs(params.id, params.projectId);
    res.status(200).json(logs);
  }
}
