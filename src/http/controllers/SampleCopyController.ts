import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { SampleCopyService } from '../../services/SampleCopyService';
import { createSampleCopySchema, updateSampleCopyBodySchema, deleteSampleCopyBodySchema, sampleCopyResponseSchema, sampleCopyListResponseSchema, sampleCopyRouteParamsSchema, cloneSampleCopySchema } from '../contracts/sampleCopy';
import type { CreateSampleCopyRequest, UpdateSampleCopyRequest, DeleteSampleCopyRequest, CloneSampleCopyRequest } from '../contracts/sampleCopy';
import { listParamsSchema, projectScopedParamsSchema } from '../contracts/common';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for sample copy management with explicit routing.
 * Sample copies hold variant answers that the system selects from based on classifier triggers.
 */
@singleton()
export class SampleCopyController {
  constructor(@inject(SampleCopyService) private readonly sampleCopyService: SampleCopyService) { }

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/projects/{projectId}/sample-copies',
        tags: ['Sample Copies'],
        summary: 'Create a new sample copy',
        description: 'Creates a new sample copy with a set of variant answers and classifier trigger configuration',
        request: {
          body: {
            content: {
              'application/json': {
                schema: createSampleCopySchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Sample copy created successfully',
            content: {
              'application/json': {
                schema: sampleCopyResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          409: { description: 'Sample copy already exists' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/sample-copies/{id}',
        tags: ['Sample Copies'],
        summary: 'Get sample copy by ID',
        description: 'Retrieves a single sample copy by its unique identifier',
        request: {
          params: sampleCopyRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Sample copy retrieved successfully',
            content: {
              'application/json': {
                schema: sampleCopyResponseSchema,
              },
            },
          },
          404: { description: 'Sample copy not found' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/sample-copies',
        tags: ['Sample Copies'],
        summary: 'List sample copies',
        description: 'Retrieves a paginated list of sample copies with optional filtering and sorting',
        request: {
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'List of sample copies retrieved successfully',
            content: {
              'application/json': {
                schema: sampleCopyListResponseSchema,
              },
            },
          },
          400: { description: 'Invalid query parameters' },
        },
      },
      {
        method: 'put',
        path: '/api/projects/{projectId}/sample-copies/{id}',
        tags: ['Sample Copies'],
        summary: 'Update sample copy',
        description: 'Updates an existing sample copy with optimistic locking',
        request: {
          params: sampleCopyRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: updateSampleCopyBodySchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Sample copy updated successfully',
            content: {
              'application/json': {
                schema: sampleCopyResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Sample copy not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'delete',
        path: '/api/projects/{projectId}/sample-copies/{id}',
        tags: ['Sample Copies'],
        summary: 'Delete sample copy',
        description: 'Deletes a sample copy with optimistic locking',
        request: {
          params: sampleCopyRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: deleteSampleCopyBodySchema,
              },
            },
          },
        },
        responses: {
          204: { description: 'Sample copy deleted successfully' },
          400: { description: 'Invalid request body' },
          404: { description: 'Sample copy not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/sample-copies/{id}/audit-logs',
        tags: ['Sample Copies'],
        summary: 'Get sample copy audit logs',
        description: 'Retrieves audit logs for a specific sample copy',
        request: {
          params: sampleCopyRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Audit logs retrieved successfully',
          },
          404: { description: 'Sample copy not found' },
        },
      },
      {
        method: 'post',
        path: '/api/projects/{projectId}/sample-copies/{id}/clone',
        tags: ['Sample Copies'],
        summary: 'Clone sample copy',
        description: 'Creates a copy of an existing sample copy with a new ID and optional name override',
        request: {
          params: sampleCopyRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: cloneSampleCopySchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Sample copy cloned successfully',
            content: {
              'application/json': {
                schema: sampleCopyResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Sample copy not found' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    router.post('/api/projects/:projectId/sample-copies', asyncHandler(this.createSampleCopy.bind(this)));
    router.get('/api/projects/:projectId/sample-copies/:id', asyncHandler(this.getSampleCopyById.bind(this)));
    router.get('/api/projects/:projectId/sample-copies', asyncHandler(this.listSampleCopies.bind(this)));
    router.put('/api/projects/:projectId/sample-copies/:id', asyncHandler(this.updateSampleCopy.bind(this)));
    router.delete('/api/projects/:projectId/sample-copies/:id', asyncHandler(this.deleteSampleCopy.bind(this)));
    router.get('/api/projects/:projectId/sample-copies/:id/audit-logs', asyncHandler(this.getSampleCopyAuditLogs.bind(this)));
    router.post('/api/projects/:projectId/sample-copies/:id/clone', asyncHandler(this.cloneSampleCopy.bind(this)));
  }

  /**
   * POST /api/projects/:projectId/sample-copies
   * Create a new sample copy
   */
  private async createSampleCopy(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SAMPLE_COPY_WRITE]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const body = createSampleCopySchema.parse(req.body);
    const sampleCopy = await this.sampleCopyService.createSampleCopy(projectId, body, req.context);
    res.status(201).json(sampleCopy);
  }

  /**
   * GET /api/projects/:projectId/sample-copies/:id
   * Get a sample copy by ID
   */
  private async getSampleCopyById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SAMPLE_COPY_READ]);
    const params = sampleCopyRouteParamsSchema.parse(req.params);
    const sampleCopy = await this.sampleCopyService.getSampleCopyById(params.projectId, params.id);
    res.status(200).json(sampleCopy);
  }

  /**
   * GET /api/projects/:projectId/sample-copies
   * List sample copies with optional filters
   */
  private async listSampleCopies(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SAMPLE_COPY_READ]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const query = listParamsSchema.parse(req.query);
    const result = await this.sampleCopyService.listSampleCopies(projectId, query);
    res.status(200).json(result);
  }

  /**
   * PUT /api/projects/:projectId/sample-copies/:id
   * Update a sample copy
   */
  private async updateSampleCopy(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SAMPLE_COPY_WRITE]);
    const params = sampleCopyRouteParamsSchema.parse(req.params);
    const body = updateSampleCopyBodySchema.parse(req.body);
    const sampleCopy = await this.sampleCopyService.updateSampleCopy(params.projectId, params.id, body, req.context);
    res.status(200).json(sampleCopy);
  }

  /**
   * DELETE /api/projects/:projectId/sample-copies/:id
   * Delete a sample copy
   */
  private async deleteSampleCopy(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SAMPLE_COPY_DELETE]);
    const params = sampleCopyRouteParamsSchema.parse(req.params);
    const body = deleteSampleCopyBodySchema.parse(req.body);
    await this.sampleCopyService.deleteSampleCopy(params.projectId, params.id, body.version, req.context);
    res.status(204).send();
  }

  /**
   * GET /api/projects/:projectId/sample-copies/:id/audit-logs
   * Get audit logs for a sample copy
   */
  private async getSampleCopyAuditLogs(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.AUDIT_READ]);
    const params = sampleCopyRouteParamsSchema.parse(req.params);
    const logs = await this.sampleCopyService.getSampleCopyAuditLogs(params.id, params.projectId);
    res.status(200).json(logs);
  }

  /**
   * POST /api/projects/:projectId/sample-copies/:id/clone
   * Clone a sample copy
   */
  private async cloneSampleCopy(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SAMPLE_COPY_WRITE]);
    const params = sampleCopyRouteParamsSchema.parse(req.params);
    const body = cloneSampleCopySchema.parse(req.body);
    const result = await this.sampleCopyService.cloneSampleCopy(params.projectId, params.id, body, req.context);
    res.status(201).json(result);
  }
}
