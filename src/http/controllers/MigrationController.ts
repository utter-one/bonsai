import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { MigrationService } from '../../services/MigrationService';
import {
  exportBundleSchema,
  exportQuerySchema,
  importRequestSchema,
  pullRequestSchema,
  migrationResultSchema,
  migrationJobSchema,
  migrationJobRouteParamsSchema,
} from '../contracts/migration';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';
import { NotFoundError } from '../../errors';

/**
 * Controller for data migration between Nexus Backend instances.
 * Provides export, import, and server-side pull orchestration.
 */
@singleton()
export class MigrationController {
  constructor(@inject(MigrationService) private readonly migrationService: MigrationService) {}

  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'get',
        path: '/api/migration/export',
        tags: ['Migration'],
        summary: 'Export config bundle',
        description:
          'Produces a self-contained JSON bundle of all migratable config entities. ' +
          'Pass one or more ID arrays (projectIds, stageIds, personaIds, …) to select specific entities — ' +
          'all transitive FK dependencies are resolved automatically so the bundle is always self-consistent. ' +
          'An empty query (no params) exports everything. ' +
          'The bundle embeds the current REST schema hash for compatibility checking on import. ' +
          'Provider config (API credentials) is stripped from exported records — credentials must be reconfigured on the target after import.',
        request: { query: exportQuerySchema },
        responses: {
          200: {
            description: 'Export bundle ready for import on another instance',
            content: { 'application/json': { schema: exportBundleSchema } },
          },
          400: { description: 'Invalid query parameters' },
        },
      },
      {
        method: 'post',
        path: '/api/migration/import',
        tags: ['Migration'],
        summary: 'Import config bundle',
        description:
          'Imports an export bundle into this instance. All entities are upserted in a single ' +
          'database transaction in FK-safe order. The import is blocked when the source and local ' +
          'REST schema hashes differ unless force=true. Use dryRun=true to validate without writing.',
        request: { body: { content: { 'application/json': { schema: importRequestSchema } } } },
        responses: {
          200: {
            description: 'Import completed (or dry-run result)',
            content: { 'application/json': { schema: migrationResultSchema } },
          },
          400: { description: 'Schema hash mismatch (use force=true to override) or invalid bundle' },
        },
      },
      {
        method: 'post',
        path: '/api/migration/pull',
        tags: ['Migration'],
        summary: 'Pull from remote environment',
        description:
          'Authenticates against a stored environment, checks schema compatibility via /version, ' +
          'fetches the export bundle, and imports it locally — all in a single server-side call. ' +
          'Returns a job immediately with status "pending"; poll GET /api/migration/jobs/:id for progress.',
        request: { body: { content: { 'application/json': { schema: pullRequestSchema } } } },
        responses: {
          202: {
            description: 'Pull job started — poll the returned job ID for status',
            content: { 'application/json': { schema: migrationJobSchema } },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Environment not found' },
        },
      },
      {
        method: 'get',
        path: '/api/migration/jobs/{id}',
        tags: ['Migration'],
        summary: 'Get migration job status',
        description:
          'Returns the current state of an async pull job. ' +
          'Jobs are held in process memory — a server restart clears all job history.',
        request: { params: migrationJobRouteParamsSchema },
        responses: {
          200: {
            description: 'Job status',
            content: { 'application/json': { schema: migrationJobSchema } },
          },
          404: { description: 'Job not found' },
        },
      },
    ];
  }

  registerRoutes(router: Router): void {
    router.get('/api/migration/export', asyncHandler(this.exportBundle.bind(this)));
    router.post('/api/migration/import', asyncHandler(this.importBundle.bind(this)));
    router.post('/api/migration/pull', asyncHandler(this.startPull.bind(this)));
    router.get('/api/migration/jobs/:id', asyncHandler(this.getJob.bind(this)));
  }

  private async exportBundle(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.MIGRATION_EXPORT]);
    const query = exportQuerySchema.parse(req.query);
    const bundle = await this.migrationService.exportBundle(query, req.context);
    res.status(200).json(bundle);
  }

  private async importBundle(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.MIGRATION_IMPORT]);
    const body = importRequestSchema.parse(req.body);
    const result = await this.migrationService.importBundle(body, req.context);
    res.status(200).json(result);
  }

  private async startPull(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.MIGRATION_IMPORT]);
    const body = pullRequestSchema.parse(req.body);
    const jobId = await this.migrationService.startPull(body, req.context);
    const job = this.migrationService.getJob(jobId);
    res.status(202).json(job);
  }

  private async getJob(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.MIGRATION_IMPORT]);
    const { id } = migrationJobRouteParamsSchema.parse(req.params);
    const job = this.migrationService.getJob(id);
    if (!job) throw new NotFoundError(`Migration job ${id} not found`);
    res.status(200).json(job);
  }
}
