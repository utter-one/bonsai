import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { ProjectProviderUsageService } from '../../services/ProjectProviderUsageService';
import { projectProviderUsageRouteParamsSchema, projectProviderUsageQuerySchema, projectProviderUsageResponseSchema } from '../contracts/projectProviders';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for the project provider usage endpoint.
 * Returns a comprehensive report of all providers actively referenced
 * by entities within a project.
 */
@singleton()
export class ProjectProviderUsageController {
  constructor(
    @inject(ProjectProviderUsageService) private readonly projectProviderUsageService: ProjectProviderUsageService,
  ) {}

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'get',
        path: '/api/projects/{projectId}/providers/used',
        tags: ['Providers'],
        summary: 'Get providers used in a project',
        description: 'Returns a comprehensive report of all providers actively referenced by entities (agents, stages, classifiers, tools, context transformers, testers) and project-level settings (ASR, storage, moderation) within the project. Includes entity-level usage details and a summary grouped by provider type. When checkIfAvailable is true, also checks model availability via provider API (LLM providers only).',
        request: {
          params: projectProviderUsageRouteParamsSchema,
          query: projectProviderUsageQuerySchema,
        },
        responses: {
          200: {
            description: 'Provider usage report retrieved successfully',
            content: {
              'application/json': {
                schema: projectProviderUsageResponseSchema,
              },
            },
          },
          403: { description: 'Insufficient permissions' },
          404: { description: 'Project not found' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    router.get('/api/projects/:projectId/providers/used', asyncHandler(this.getUsedProviders.bind(this)));
  }

  /**
   * GET /api/projects/:projectId/providers/used
   * Returns comprehensive provider usage report for the project
   */
  private async getUsedProviders(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.PROVIDER_READ]);
    const params = projectProviderUsageRouteParamsSchema.parse(req.params);
    const query = projectProviderUsageQuerySchema.parse(req.query);
    const result = await this.projectProviderUsageService.getUsedProviders(params.projectId, req.context, query.checkIfAvailable);
    res.status(200).json(result);
  }
}
