import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { EnvironmentService } from '../../services/EnvironmentService';
import { MigrationService } from '../../services/MigrationService';
import { createEnvironmentSchema, updateEnvironmentBodySchema, deleteEnvironmentBodySchema, environmentResponseSchema, environmentListResponseSchema, environmentRouteParamsSchema } from '../contracts/environment';
import type { CreateEnvironmentRequest, UpdateEnvironmentRequest, DeleteEnvironmentRequest } from '../contracts/environment';
import { pullRequestSchema, migrationJobSchema, migrationJobRouteParamsSchema, migrationPreviewSchema, exportQuerySchema } from '../contracts/migration';
import { listParamsSchema } from '../contracts/common';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';
import { NotFoundError } from '../../errors';

/**
 * Controller for environment management with explicit routing
 * Manages environments which are used for data migration between server instances
 */
@singleton()
export class EnvironmentController {
  constructor(
    @inject(EnvironmentService) private readonly environmentService: EnvironmentService,
    @inject(MigrationService) private readonly migrationService: MigrationService,
  ) {}

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/environments',
        tags: ['Environments'],
        summary: 'Create a new environment',
        description: 'Creates a new environment configuration for data migration between server instances',
        request: {
          body: {
            content: {
              'application/json': {
                schema: createEnvironmentSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Environment created successfully',
            content: {
              'application/json': {
                schema: environmentResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          409: { description: 'Environment already exists' },
        },
      },
      {
        method: 'get',
        path: '/api/environments/{id}',
        tags: ['Environments'],
        summary: 'Get environment by ID',
        description: 'Retrieves a single environment by its unique identifier (password excluded)',
        request: {
          params: environmentRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Environment retrieved successfully',
            content: {
              'application/json': {
                schema: environmentResponseSchema,
              },
            },
          },
          404: { description: 'Environment not found' },
        },
      },
      {
        method: 'get',
        path: '/api/environments',
        tags: ['Environments'],
        summary: 'List environments',
        description: 'Retrieves a paginated list of environments with optional filtering and sorting (passwords excluded)',
        request: {
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'List of environments retrieved successfully',
            content: {
              'application/json': {
                schema: environmentListResponseSchema,
              },
            },
          },
          400: { description: 'Invalid query parameters' },
        },
      },
      {
        method: 'put',
        path: '/api/environments/{id}',
        tags: ['Environments'],
        summary: 'Update environment',
        description: 'Updates an existing environment with optimistic locking',
        request: {
          params: environmentRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: updateEnvironmentBodySchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Environment updated successfully',
            content: {
              'application/json': {
                schema: environmentResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Environment not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'delete',
        path: '/api/environments/{id}',
        tags: ['Environments'],
        summary: 'Delete environment',
        description: 'Deletes an environment with optimistic locking',
        request: {
          params: environmentRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: deleteEnvironmentBodySchema,
              },
            },
          },
        },
        responses: {
          204: { description: 'Environment deleted successfully' },
          400: { description: 'Invalid request body' },
          404: { description: 'Environment not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'get',
        path: '/api/environments/{id}/audit-logs',
        tags: ['Environments'],
        summary: 'Get environment audit logs',
        description: 'Retrieves audit logs for a specific environment',
        request: {
          params: environmentRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Audit logs retrieved successfully',
          },
          404: { description: 'Environment not found' },
        },
      },
      {
        method: 'get',
        path: '/api/environments/{id}/migration/scope',
        tags: ['Environments'],
        summary: 'Preview remote migration scope',
        description:
          'Authenticates against the stored environment and returns lightweight stubs (id + name) ' +
          'of all entities that would be pulled with the given selection — without writing any data. ' +
          'Same query params as GET /api/migration/preview on the source instance.',
        request: {
          params: environmentRouteParamsSchema,
          query: exportQuerySchema,
        },
        responses: {
          200: {
            description: 'Entity stubs grouped by type from the remote environment',
            content: { 'application/json': { schema: migrationPreviewSchema } },
          },
          400: { description: 'Invalid query parameters' },
          404: { description: 'Environment not found' },
        },
      },
      {
        method: 'post',
        path: '/api/environments/{id}/migration/pull',
        tags: ['Environments'],
        summary: 'Pull data from environment',
        description:
          'Authenticates against the stored environment, checks schema compatibility, ' +
          'fetches the remote export bundle, and imports it locally — all server-side. ' +
          'Returns a job immediately with status "pending"; poll GET /api/environments/{id}/migration/jobs/{jobId} for progress.',
        request: {
          params: environmentRouteParamsSchema,
          body: { content: { 'application/json': { schema: pullRequestSchema } } },
        },
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
        path: '/api/environments/{id}/migration/jobs/{jobId}',
        tags: ['Environments'],
        summary: 'Get migration job status',
        description:
          'Returns the current state of an async pull job scoped to this environment. ' +
          'Jobs are held in process memory — a server restart clears all job history.',
        request: { params: migrationJobRouteParamsSchema },
        responses: {
          200: {
            description: 'Job status',
            content: { 'application/json': { schema: migrationJobSchema } },
          },
          404: { description: 'Job not found or does not belong to this environment' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    router.post('/api/environments', asyncHandler(this.createEnvironment.bind(this)));
    router.get('/api/environments/:id', asyncHandler(this.getEnvironmentById.bind(this)));
    router.get('/api/environments', asyncHandler(this.listEnvironments.bind(this)));
    router.put('/api/environments/:id', asyncHandler(this.updateEnvironment.bind(this)));
    router.delete('/api/environments/:id', asyncHandler(this.deleteEnvironment.bind(this)));
    router.get('/api/environments/:id/audit-logs', asyncHandler(this.getEnvironmentAuditLogs.bind(this)));
    router.post('/api/environments/:id/migration/pull', asyncHandler(this.startPull.bind(this)));
    router.get('/api/environments/:id/migration/jobs/:jobId', asyncHandler(this.getJob.bind(this)));
    router.get('/api/environments/:id/migration/scope', asyncHandler(this.previewScope.bind(this)));
  }

  /**
   * POST /api/environments
   * Create a new environment
   */
  private async createEnvironment(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ENVIRONMENT_WRITE]);
    const body = createEnvironmentSchema.parse(req.body);
    const environment = await this.environmentService.createEnvironment(body, req.context);
    res.status(201).json(environment);
  }

  /**
   * GET /api/environments/:id
   * Get an environment by ID
   */
  private async getEnvironmentById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ENVIRONMENT_READ]);
    const params = environmentRouteParamsSchema.parse(req.params);
    const environment = await this.environmentService.getEnvironmentById(params.id);
    res.status(200).json(environment);
  }

  /**
   * GET /api/environments
   * List environments with optional filters
   */
  private async listEnvironments(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ENVIRONMENT_READ]);
    const query = listParamsSchema.parse(req.query);
    const environments = await this.environmentService.listEnvironments(query);
    res.status(200).json(environments);
  }

  /**
   * PUT /api/environments/:id
   * Update an environment
   */
  private async updateEnvironment(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ENVIRONMENT_WRITE]);
    const params = environmentRouteParamsSchema.parse(req.params);
    const body = updateEnvironmentBodySchema.parse(req.body);
    const environment = await this.environmentService.updateEnvironment(params.id, body, req.context);
    res.status(200).json(environment);
  }

  /**
   * DELETE /api/environments/:id
   * Delete an environment
   */
  private async deleteEnvironment(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ENVIRONMENT_DELETE]);
    const params = environmentRouteParamsSchema.parse(req.params);
    const body = deleteEnvironmentBodySchema.parse(req.body);
    await this.environmentService.deleteEnvironment(params.id, body.version, req.context);
    res.status(204).send();
  }

  /**
   * GET /api/environments/:id/audit-logs
   * Get audit logs for an environment
   */
  private async getEnvironmentAuditLogs(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.AUDIT_READ]);
    const params = environmentRouteParamsSchema.parse(req.params);
    const logs = await this.environmentService.getEnvironmentAuditLogs(params.id);
    res.status(200).json(logs);
  }

  /**
   * POST /api/environments/:id/migration/pull
   * Start a server-side pull from this environment
   */
  private async startPull(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.MIGRATION_IMPORT]);
    const { id } = environmentRouteParamsSchema.parse(req.params);
    const body = pullRequestSchema.parse(req.body);
    const jobId = await this.migrationService.startPull(id, body, req.context);
    const job = this.migrationService.getJob(jobId);
    res.status(202).json(job);
  }

  /**
   * GET /api/environments/:id/migration/jobs/:jobId
   * Get the status of a migration pull job scoped to this environment
   */
  private async getJob(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.MIGRATION_IMPORT]);
    const { id, jobId } = migrationJobRouteParamsSchema.parse(req.params);
    const job = this.migrationService.getJob(jobId);
    if (!job || job.environmentId !== id) throw new NotFoundError(`Migration job ${jobId} not found`);
    res.status(200).json(job);
  }

  /**
   * GET /api/environments/:id/migration/scope
   * Preview what would be pulled from this environment without writing any data
   */
  private async previewScope(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.MIGRATION_IMPORT]);
    const { id } = environmentRouteParamsSchema.parse(req.params);
    const query = exportQuerySchema.parse(req.query);
    const preview = await this.migrationService.previewRemote(id, query, req.context);
    res.status(200).json(preview);
  }
}
