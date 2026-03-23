import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { ProjectExchangeService } from '../../services/ProjectExchangeService';
import { projectExchangeBundleSchema, projectExchangeBundleV1Schema, projectExchangeImportResultSchema } from '../contracts/projectExchange';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';
import { z } from 'zod';

const exportRouteParamsSchema = z.object({
  id: z.string().min(1).describe('Project ID'),
});

/**
 * Controller for project exchange (export / import) endpoints.
 * Produces and consumes provider-agnostic, versioned project bundles.
 */
@singleton()
export class ProjectExchangeController {
  constructor(@inject(ProjectExchangeService) private readonly exchangeService: ProjectExchangeService) {}

  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'get',
        path: '/api/projects/{id}/export',
        tags: ['Projects'],
        summary: 'Export a project as an exchange bundle',
        description:
          'Produces a self-contained, provider-agnostic exchange bundle for the specified project. ' +
          'All child entities (agents, stages, classifiers, context transformers, tools, global actions, guardrails, knowledge base) are included. ' +
          'Provider UUID references are replaced by provider hints (`type` + `apiType`) so the bundle can be imported into any environment. ' +
          'Credentials are never included. ' +
          'Entity IDs in the bundle are preserved as local cross-references and remapped to fresh UUIDs on import.',
        request: {
          params: exportRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Project exchange bundle',
            content: { 'application/json': { schema: projectExchangeBundleV1Schema } },
          },
          403: { description: 'Insufficient permissions' },
          404: { description: 'Project not found' },
        },
      },
      {
        method: 'post',
        path: '/api/projects/import',
        tags: ['Projects'],
        summary: 'Import a project from an exchange bundle',
        description:
          'Imports a project from a provider-agnostic exchange bundle. ' +
          'All entity IDs are remapped to fresh UUIDs so repeated imports never overwrite existing data. ' +
          'Provider hints are resolved to local provider IDs by matching `type` + `apiType` (first match wins). ' +
          'If no matching local provider is found for a hint, the corresponding provider field is set to null. ' +
          'Returns the newly assigned project ID and a count of created entities.',
        request: {
          body: {
            content: { 'application/json': { schema: projectExchangeBundleV1Schema } },
          },
        },
        responses: {
          201: {
            description: 'Import summary',
            content: { 'application/json': { schema: projectExchangeImportResultSchema } },
          },
          400: { description: 'Invalid exchange bundle' },
          403: { description: 'Insufficient permissions' },
        },
      },
    ];
  }

  registerRoutes(router: Router): void {
    router.get('/api/projects/:id/export', asyncHandler(this.exportProject.bind(this)));
    router.post('/api/projects/import', asyncHandler(this.importProject.bind(this)));
  }

  private async exportProject(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.PROJECT_READ]);
    const { id } = exportRouteParamsSchema.parse(req.params);
    const bundle = await this.exchangeService.exportProject(id, req.context);
    res.status(200).json(bundle);
  }

  private async importProject(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.PROJECT_WRITE]);
    const bundle = projectExchangeBundleSchema.parse(req.body);
    const result = await this.exchangeService.importProject(bundle, req.context);
    res.status(201).json(result);
  }
}
