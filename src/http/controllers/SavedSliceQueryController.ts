import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { SavedSliceQueryService } from '../../services/analytics/SavedSliceQueryService';
import { createSavedSliceQuerySchema, updateSavedSliceQuerySchema, deleteSavedSliceQueryBodySchema, savedSliceQueryResponseSchema, savedSliceQueryRouteParamsSchema } from '../contracts/savedSliceQuery';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';
import { projectScopedParamsSchema } from '../contracts/common';

/**
 * Controller for managing saved slice queries.
 * Provides CRUD endpoints for operators to save and manage named analytics query configurations.
 */
@singleton()
export class SavedSliceQueryController {
  constructor(@inject(SavedSliceQueryService) private readonly savedSliceQueryService: SavedSliceQueryService) { }

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'get',
        path: '/api/projects/{projectId}/analytics/saved-queries',
        tags: ['Analytics'],
        summary: 'List saved slice queries',
        description: "Returns the operator's own saved queries plus all shared queries within the project",
        request: {
          params: projectScopedParamsSchema,
        },
        responses: {
          200: {
            description: 'Saved slice queries retrieved successfully',
            content: {
              'application/json': {
                schema: savedSliceQueryResponseSchema.array(),
              },
            },
          },
        },
      },
      {
        method: 'post',
        path: '/api/projects/{projectId}/analytics/saved-queries',
        tags: ['Analytics'],
        summary: 'Create a saved slice query',
        description: 'Saves a named slice query configuration for later reuse. The name must be unique within the project.',
        request: {
          params: projectScopedParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: createSavedSliceQuerySchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Saved slice query created successfully',
            content: {
              'application/json': {
                schema: savedSliceQueryResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          409: { description: 'A query with this name already exists in the project' },
        },
      },
      {
        method: 'put',
        path: '/api/projects/{projectId}/analytics/saved-queries/{id}',
        tags: ['Analytics'],
        summary: 'Update a saved slice query',
        description: 'Updates an existing saved slice query with optimistic locking. Only the owning operator or a super_admin may update.',
        request: {
          params: savedSliceQueryRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: updateSavedSliceQuerySchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Saved slice query updated successfully',
            content: {
              'application/json': {
                schema: savedSliceQueryResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          403: { description: 'Not the owner of this query' },
          404: { description: 'Saved slice query not found' },
          409: { description: 'Version conflict or name already exists' },
        },
      },
      {
        method: 'delete',
        path: '/api/projects/{projectId}/analytics/saved-queries/{id}',
        tags: ['Analytics'],
        summary: 'Delete a saved slice query',
        description: 'Deletes a saved slice query with optimistic locking. Only the owning operator or a super_admin may delete.',
        request: {
          params: savedSliceQueryRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: deleteSavedSliceQueryBodySchema,
              },
            },
          },
        },
        responses: {
          204: { description: 'Saved slice query deleted successfully' },
          400: { description: 'Invalid request body' },
          403: { description: 'Not the owner of this query' },
          404: { description: 'Saved slice query not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    router.get('/api/projects/:projectId/analytics/saved-queries', asyncHandler(this.listSavedQueries.bind(this)));
    router.post('/api/projects/:projectId/analytics/saved-queries', asyncHandler(this.createSavedQuery.bind(this)));
    router.put('/api/projects/:projectId/analytics/saved-queries/:id', asyncHandler(this.updateSavedQuery.bind(this)));
    router.delete('/api/projects/:projectId/analytics/saved-queries/:id', asyncHandler(this.deleteSavedQuery.bind(this)));
  }

  /**
   * GET /api/projects/:projectId/analytics/saved-queries
   */
  private async listSavedQueries(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ANALYTICS_READ]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const queries = await this.savedSliceQueryService.list(projectId, req.context);
    res.status(200).json(queries);
  }

  /**
   * POST /api/projects/:projectId/analytics/saved-queries
   */
  private async createSavedQuery(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ANALYTICS_READ]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const body = createSavedSliceQuerySchema.parse(req.body);
    const query = await this.savedSliceQueryService.create(projectId, body, req.context);
    res.status(201).json(query);
  }

  /**
   * PUT /api/projects/:projectId/analytics/saved-queries/:id
   */
  private async updateSavedQuery(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ANALYTICS_READ]);
    const params = savedSliceQueryRouteParamsSchema.parse(req.params);
    const body = updateSavedSliceQuerySchema.parse(req.body);
    const query = await this.savedSliceQueryService.update(params.id, params.projectId, body, req.context);
    res.status(200).json(query);
  }

  /**
   * DELETE /api/projects/:projectId/analytics/saved-queries/:id
   */
  private async deleteSavedQuery(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ANALYTICS_READ]);
    const params = savedSliceQueryRouteParamsSchema.parse(req.params);
    const body = deleteSavedSliceQueryBodySchema.parse(req.body);
    await this.savedSliceQueryService.delete(params.id, params.projectId, body.version, req.context);
    res.status(204).send();
  }
}
