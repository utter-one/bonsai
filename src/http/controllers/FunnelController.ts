import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { FunnelQueryService } from '../../services/analytics/FunnelQueryService';
import { SavedFunnelQueryService } from '../../services/analytics/SavedFunnelQueryService';
import { funnelQuerySchema, funnelQueryResponseSchema, createSavedFunnelQuerySchema, updateSavedFunnelQuerySchema, deleteSavedFunnelQueryBodySchema, savedFunnelQueryResponseSchema, savedFunnelQueryRouteParamsSchema } from '../contracts/funnels';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';
import { projectScopedParamsSchema } from '../contracts/common';

/**
 * Controller for funnel analytics endpoints.
 * Provides a run-query endpoint and CRUD endpoints for saved funnel query configurations.
 */
@singleton()
export class FunnelController {
  constructor(
    @inject(FunnelQueryService) private readonly funnelQueryService: FunnelQueryService,
    @inject(SavedFunnelQueryService) private readonly savedFunnelQueryService: SavedFunnelQueryService,
  ) { }

  /**
   * Returns OpenAPI path definitions for all funnel endpoints.
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/projects/{projectId}/analytics/funnels/query',
        tags: ['Analytics'],
        summary: 'Run a funnel query',
        description: 'Executes a user-centric funnel query that cascades qualifying users through ordered event steps. Returns per-step user counts and conversion rates.',
        request: {
          params: projectScopedParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: funnelQuerySchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Funnel query executed successfully',
            content: {
              'application/json': {
                schema: funnelQueryResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body or step parameters' },
          403: { description: 'Operator is not a member of the project' },
          404: { description: 'Project not found' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/analytics/funnels/saved-queries',
        tags: ['Analytics'],
        summary: 'List saved funnel queries',
        description: "Returns the operator's own saved funnel queries plus all shared queries within the project, sorted by updatedAt descending.",
        request: {
          params: projectScopedParamsSchema,
        },
        responses: {
          200: {
            description: 'Saved funnel queries retrieved successfully',
            content: {
              'application/json': {
                schema: savedFunnelQueryResponseSchema.array(),
              },
            },
          },
        },
      },
      {
        method: 'post',
        path: '/api/projects/{projectId}/analytics/funnels/saved-queries',
        tags: ['Analytics'],
        summary: 'Create a saved funnel query',
        description: 'Saves a named funnel query configuration for later reuse. The name must be unique within the project.',
        request: {
          params: projectScopedParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: createSavedFunnelQuerySchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Saved funnel query created successfully',
            content: {
              'application/json': {
                schema: savedFunnelQueryResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body or query validation failure' },
          409: { description: 'A funnel query with this name already exists in the project' },
        },
      },
      {
        method: 'put',
        path: '/api/projects/{projectId}/analytics/funnels/saved-queries/{id}',
        tags: ['Analytics'],
        summary: 'Update a saved funnel query',
        description: 'Updates an existing saved funnel query with optimistic locking. Only the owning operator or a super_admin may update.',
        request: {
          params: savedFunnelQueryRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: updateSavedFunnelQuerySchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Saved funnel query updated successfully',
            content: {
              'application/json': {
                schema: savedFunnelQueryResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          403: { description: 'Not the owner of this query' },
          404: { description: 'Saved funnel query not found' },
          409: { description: 'Version conflict or name already exists' },
        },
      },
      {
        method: 'delete',
        path: '/api/projects/{projectId}/analytics/funnels/saved-queries/{id}',
        tags: ['Analytics'],
        summary: 'Delete a saved funnel query',
        description: 'Deletes a saved funnel query with optimistic locking. Only the owning operator or a super_admin may delete.',
        request: {
          params: savedFunnelQueryRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: deleteSavedFunnelQueryBodySchema,
              },
            },
          },
        },
        responses: {
          204: { description: 'Saved funnel query deleted successfully' },
          400: { description: 'Invalid request body' },
          403: { description: 'Not the owner of this query' },
          404: { description: 'Saved funnel query not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
    ];
  }

  /**
   * Registers all funnel routes on the given router.
   */
  registerRoutes(router: Router): void {
    router.post('/api/projects/:projectId/analytics/funnels/query', asyncHandler(this.runFunnelQuery.bind(this)));
    router.get('/api/projects/:projectId/analytics/funnels/saved-queries', asyncHandler(this.listSavedQueries.bind(this)));
    router.post('/api/projects/:projectId/analytics/funnels/saved-queries', asyncHandler(this.createSavedQuery.bind(this)));
    router.put('/api/projects/:projectId/analytics/funnels/saved-queries/:id', asyncHandler(this.updateSavedQuery.bind(this)));
    router.delete('/api/projects/:projectId/analytics/funnels/saved-queries/:id', asyncHandler(this.deleteSavedQuery.bind(this)));
  }

  private async runFunnelQuery(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ANALYTICS_READ]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const body = funnelQuerySchema.parse(req.body);
    const result = await this.funnelQueryService.runQuery(projectId, body, req.context);
    res.status(200).json(result);
  }

  private async listSavedQueries(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ANALYTICS_READ]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const queries = await this.savedFunnelQueryService.list(projectId, req.context);
    res.status(200).json(queries);
  }

  private async createSavedQuery(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ANALYTICS_READ]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const body = createSavedFunnelQuerySchema.parse(req.body);
    const created = await this.savedFunnelQueryService.create(projectId, body, req.context);
    res.status(201).json(created);
  }

  private async updateSavedQuery(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ANALYTICS_READ]);
    const { projectId, id } = savedFunnelQueryRouteParamsSchema.parse(req.params);
    const body = updateSavedFunnelQuerySchema.parse(req.body);
    const updated = await this.savedFunnelQueryService.update(id, projectId, body, req.context);
    res.status(200).json(updated);
  }

  private async deleteSavedQuery(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ANALYTICS_READ]);
    const { projectId, id } = savedFunnelQueryRouteParamsSchema.parse(req.params);
    const { version } = deleteSavedFunnelQueryBodySchema.parse(req.body);
    await this.savedFunnelQueryService.delete(id, projectId, version, req.context);
    res.status(204).send();
  }
}
