import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { CopyDecoratorService } from '../../services/CopyDecoratorService';
import { createCopyDecoratorSchema, updateCopyDecoratorBodySchema, deleteCopyDecoratorBodySchema, copyDecoratorResponseSchema, copyDecoratorListResponseSchema, copyDecoratorRouteParamsSchema } from '../contracts/copyDecorator';
import type { CreateCopyDecoratorRequest, UpdateCopyDecoratorRequest, DeleteCopyDecoratorRequest } from '../contracts/copyDecorator';
import { listParamsSchema, projectScopedParamsSchema } from '../contracts/common';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for copy decorator management with explicit routing.
 * Copy decorators are simple templates applied to selected sample copy content at runtime.
 */
@singleton()
export class CopyDecoratorController {
  constructor(@inject(CopyDecoratorService) private readonly copyDecoratorService: CopyDecoratorService) { }

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/projects/{projectId}/copy-decorators',
        tags: ['Copy Decorators'],
        summary: 'Create a new copy decorator',
        description: 'Creates a new copy decorator with a name and template string',
        request: {
          body: {
            content: {
              'application/json': {
                schema: createCopyDecoratorSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Copy decorator created successfully',
            content: {
              'application/json': {
                schema: copyDecoratorResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          409: { description: 'Copy decorator already exists' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/copy-decorators/{id}',
        tags: ['Copy Decorators'],
        summary: 'Get copy decorator by ID',
        description: 'Retrieves a single copy decorator by its unique identifier',
        request: {
          params: copyDecoratorRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Copy decorator retrieved successfully',
            content: {
              'application/json': {
                schema: copyDecoratorResponseSchema,
              },
            },
          },
          404: { description: 'Copy decorator not found' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/copy-decorators',
        tags: ['Copy Decorators'],
        summary: 'List copy decorators',
        description: 'Retrieves a paginated list of copy decorators with optional filtering and sorting',
        request: {
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'List of copy decorators retrieved successfully',
            content: {
              'application/json': {
                schema: copyDecoratorListResponseSchema,
              },
            },
          },
          400: { description: 'Invalid query parameters' },
        },
      },
      {
        method: 'put',
        path: '/api/projects/{projectId}/copy-decorators/{id}',
        tags: ['Copy Decorators'],
        summary: 'Update copy decorator',
        description: 'Updates an existing copy decorator with optimistic locking',
        request: {
          params: copyDecoratorRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: updateCopyDecoratorBodySchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Copy decorator updated successfully',
            content: {
              'application/json': {
                schema: copyDecoratorResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Copy decorator not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'delete',
        path: '/api/projects/{projectId}/copy-decorators/{id}',
        tags: ['Copy Decorators'],
        summary: 'Delete copy decorator',
        description: 'Deletes a copy decorator with optimistic locking',
        request: {
          params: copyDecoratorRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: deleteCopyDecoratorBodySchema,
              },
            },
          },
        },
        responses: {
          204: { description: 'Copy decorator deleted successfully' },
          400: { description: 'Invalid request body' },
          404: { description: 'Copy decorator not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/copy-decorators/{id}/audit-logs',
        tags: ['Copy Decorators'],
        summary: 'Get copy decorator audit logs',
        description: 'Retrieves audit logs for a specific copy decorator',
        request: {
          params: copyDecoratorRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Audit logs retrieved successfully',
          },
          404: { description: 'Copy decorator not found' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    router.post('/api/projects/:projectId/copy-decorators', asyncHandler(this.createCopyDecorator.bind(this)));
    router.get('/api/projects/:projectId/copy-decorators/:id', asyncHandler(this.getCopyDecoratorById.bind(this)));
    router.get('/api/projects/:projectId/copy-decorators', asyncHandler(this.listCopyDecorators.bind(this)));
    router.put('/api/projects/:projectId/copy-decorators/:id', asyncHandler(this.updateCopyDecorator.bind(this)));
    router.delete('/api/projects/:projectId/copy-decorators/:id', asyncHandler(this.deleteCopyDecorator.bind(this)));
    router.get('/api/projects/:projectId/copy-decorators/:id/audit-logs', asyncHandler(this.getCopyDecoratorAuditLogs.bind(this)));
  }

  /**
   * POST /api/projects/:projectId/copy-decorators
   * Create a new copy decorator
   */
  private async createCopyDecorator(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.COPY_DECORATOR_WRITE]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const body = createCopyDecoratorSchema.parse(req.body);
    const result = await this.copyDecoratorService.createCopyDecorator(projectId, body, req.context);
    res.status(201).json(result);
  }

  /**
   * GET /api/projects/:projectId/copy-decorators/:id
   * Get a copy decorator by ID
   */
  private async getCopyDecoratorById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.COPY_DECORATOR_READ]);
    const params = copyDecoratorRouteParamsSchema.parse(req.params);
    const result = await this.copyDecoratorService.getCopyDecoratorById(params.projectId, params.id);
    res.status(200).json(result);
  }

  /**
   * GET /api/projects/:projectId/copy-decorators
   * List copy decorators with optional filters
   */
  private async listCopyDecorators(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.COPY_DECORATOR_READ]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const query = listParamsSchema.parse(req.query);
    const result = await this.copyDecoratorService.listCopyDecorators(projectId, query);
    res.status(200).json(result);
  }

  /**
   * PUT /api/projects/:projectId/copy-decorators/:id
   * Update a copy decorator
   */
  private async updateCopyDecorator(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.COPY_DECORATOR_WRITE]);
    const params = copyDecoratorRouteParamsSchema.parse(req.params);
    const body = updateCopyDecoratorBodySchema.parse(req.body);
    const result = await this.copyDecoratorService.updateCopyDecorator(params.projectId, params.id, body, req.context);
    res.status(200).json(result);
  }

  /**
   * DELETE /api/projects/:projectId/copy-decorators/:id
   * Delete a copy decorator
   */
  private async deleteCopyDecorator(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.COPY_DECORATOR_DELETE]);
    const params = copyDecoratorRouteParamsSchema.parse(req.params);
    const body = deleteCopyDecoratorBodySchema.parse(req.body);
    await this.copyDecoratorService.deleteCopyDecorator(params.projectId, params.id, body.version, req.context);
    res.status(204).send();
  }

  /**
   * GET /api/projects/:projectId/copy-decorators/:id/audit-logs
   * Get audit logs for a copy decorator
   */
  private async getCopyDecoratorAuditLogs(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.AUDIT_READ]);
    const params = copyDecoratorRouteParamsSchema.parse(req.params);
    const logs = await this.copyDecoratorService.getCopyDecoratorAuditLogs(params.id, params.projectId);
    res.status(200).json(logs);
  }
}
