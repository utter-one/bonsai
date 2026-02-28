import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { MigrationService } from '../../services/MigrationService';
import { exportBundleSchema, exportQuerySchema, migrationPreviewSchema } from '../contracts/migration';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for service-to-service data migration endpoints.
 * Exposes export and preview endpoints consumed by remote instances during a pull.
 * Frontend-facing pull orchestration lives in EnvironmentController.
 */
@singleton()
export class MigrationController {
  constructor(@inject(MigrationService) private readonly migrationService: MigrationService) {}

  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'get',
        path: '/api/migration/preview',
        tags: ['Migration'],
        summary: 'Preview migration scope',
        description:
          'Returns lightweight stubs (id + name) for every entity that would be included in an export ' +
          'with the given selection — same query params as GET /api/migration/export. ' +
          'Use this to review what will be migrated before committing to an actual pull. ' +
          'No data is written and the full entity records are never serialised.',
        request: { query: exportQuerySchema },
        responses: {
          200: {
            description: 'Entity stubs grouped by type',
            content: { 'application/json': { schema: migrationPreviewSchema } },
          },
          400: { description: 'Invalid query parameters' },
        },
      },
      {
        method: 'get',
        path: '/api/migration/export',
        tags: ['Migration'],
        summary: 'Export config bundle',
        description:
          'Produces a self-contained JSON bundle of all migratable config entities. ' +
          'Intended to be called by a remote instance during a server-side pull. ' +
          'Pass one or more ID arrays (projectIds, stageIds, agentIds, …) to select specific entities — ' +
          'all transitive FK dependencies are resolved automatically so the bundle is always self-consistent. ' +
          'An empty query (no params) exports everything. ' +
          'Provider config (API credentials) is stripped from exported records.',
        request: { query: exportQuerySchema },
        responses: {
          200: {
            description: 'Export bundle consumed by the pulling instance',
            content: { 'application/json': { schema: exportBundleSchema } },
          },
          400: { description: 'Invalid query parameters' },
        },
      },
    ];
  }

  registerRoutes(router: Router): void {
    router.get('/api/migration/preview', asyncHandler(this.previewExport.bind(this)));
    router.get('/api/migration/export', asyncHandler(this.exportBundle.bind(this)));
  }

  private async previewExport(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.MIGRATION_EXPORT]);
    const query = exportQuerySchema.parse(req.query);
    const preview = await this.migrationService.previewExport(query, req.context);
    res.status(200).json(preview);
  }

  private async exportBundle(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.MIGRATION_EXPORT]);
    const query = exportQuerySchema.parse(req.query);
    const bundle = await this.migrationService.exportBundle(query, req.context);
    res.status(200).json(bundle);
  }
}
