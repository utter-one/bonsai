import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { StageService } from '../../services/StageService';
import { createStageSchema, updateStageBodySchema, deleteStageBodySchema, stageResponseSchema, stageListResponseSchema, stageRouteParamsSchema, cloneStageSchema } from '../contracts/stage';
import type { UpdateStageRequest, CloneStageRequest } from '../contracts/stage';
import { listParamsSchema, projectScopedParamsSchema } from '../contracts/common';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for stage management with explicit routing
 * Manages stages which define behavior, prompts, and actions for different conversation phases
 */
@singleton()
export class StageController {
  constructor(@inject(StageService) private readonly stageService: StageService) { }

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/projects/{projectId}/stages',
        tags: ['Stages'],
        summary: 'Create a new stage',
        description: 'Creates a new stage with specified behavior, prompts, and configuration',
        request: {
          body: {
            content: {
              'application/json': {
                schema: createStageSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Stage created successfully',
            content: {
              'application/json': {
                schema: stageResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          409: { description: 'Stage already exists' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/stages/{id}',
        tags: ['Stages'],
        summary: 'Get stage by ID',
        description: 'Retrieves a single stage by its unique identifier',
        request: {
          params: stageRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Stage retrieved successfully',
            content: {
              'application/json': {
                schema: stageResponseSchema,
              },
            },
          },
          404: { description: 'Stage not found' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/stages',
        tags: ['Stages'],
        summary: 'List stages',
        description: 'Retrieves a paginated list of stages with optional filtering and sorting',
        request: {
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'List of stages retrieved successfully',
            content: {
              'application/json': {
                schema: stageListResponseSchema,
              },
            },
          },
          400: { description: 'Invalid query parameters' },
        },
      },
      {
        method: 'put',
        path: '/api/projects/{projectId}/stages/{id}',
        tags: ['Stages'],
        summary: 'Update stage',
        description: 'Updates an existing stage with optimistic locking',
        request: {
          params: stageRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: updateStageBodySchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Stage updated successfully',
            content: {
              'application/json': {
                schema: stageResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Stage not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'delete',
        path: '/api/projects/{projectId}/stages/{id}',
        tags: ['Stages'],
        summary: 'Delete stage',
        description: 'Deletes a stage with optimistic locking',
        request: {
          params: stageRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: deleteStageBodySchema,
              },
            },
          },
        },
        responses: {
          204: { description: 'Stage deleted successfully' },
          400: { description: 'Invalid request body' },
          404: { description: 'Stage not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/stages/{id}/audit-logs',
        tags: ['Stages'],
        summary: 'Get stage audit logs',
        description: 'Retrieves audit logs for a specific stage',
        request: {
          params: stageRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Audit logs retrieved successfully',
          },
          404: { description: 'Stage not found' },
        },
      },
      {
        method: 'post',
        path: '/api/projects/{projectId}/stages/{id}/clone',
        tags: ['Stages'],
        summary: 'Clone stage',
        description: 'Creates a copy of an existing stage with a new ID and optional name override',
        request: {
          params: stageRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: cloneStageSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Stage cloned successfully',
            content: {
              'application/json': {
                schema: stageResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Stage not found' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    router.post('/api/projects/:projectId/stages', asyncHandler(this.createStage.bind(this)));
    router.get('/api/projects/:projectId/stages/:id', asyncHandler(this.getStageById.bind(this)));
    router.get('/api/projects/:projectId/stages', asyncHandler(this.listStages.bind(this)));
    router.put('/api/projects/:projectId/stages/:id', asyncHandler(this.updateStage.bind(this)));
    router.delete('/api/projects/:projectId/stages/:id', asyncHandler(this.deleteStage.bind(this)));
    router.get('/api/projects/:projectId/stages/:id/audit-logs', asyncHandler(this.getStageAuditLogs.bind(this)));
    router.post('/api/projects/:projectId/stages/:id/clone', asyncHandler(this.cloneStage.bind(this)));
  }

  /**
   * POST /api/stages
   * Create a new stage
   */
  private async createStage(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.STAGE_WRITE]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const body = createStageSchema.parse(req.body);
    const stage = await this.stageService.createStage(projectId, body, req.context);
    res.status(201).json(stage);
  }

  /**
   * GET /api/stages/:id
   * Get a stage by ID
   */
  private async getStageById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.STAGE_READ]);
    const params = stageRouteParamsSchema.parse(req.params);
    const stage = await this.stageService.getStageById(params.projectId, params.id);
    res.status(200).json(stage);
  }

  /**
   * GET /api/stages
   * List stages with optional filters
   */
  private async listStages(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.STAGE_READ]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const query = listParamsSchema.parse(req.query);
    const stages = await this.stageService.listStages(projectId, query);
    res.status(200).json(stages);
  }

  /**
   * PUT /api/stages/:id
   * Update a stage
   */
  private async updateStage(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.STAGE_WRITE]);
    const params = stageRouteParamsSchema.parse(req.params);
    const body = updateStageBodySchema.parse(req.body);
    const stage = await this.stageService.updateStage(params.projectId, params.id, body, req.context);
    res.status(200).json(stage);
  }

  /**
   * DELETE /api/stages/:id
   * Delete a stage
   */
  private async deleteStage(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.STAGE_DELETE]);
    const params = stageRouteParamsSchema.parse(req.params);
    const body = deleteStageBodySchema.parse(req.body);
    await this.stageService.deleteStage(params.projectId, params.id, body.version, req.context);
    res.status(204).send();
  }

  /**
   * GET /api/stages/:id/audit-logs
   * Get audit logs for a stage
   */
  private async getStageAuditLogs(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.AUDIT_READ]);
    const params = stageRouteParamsSchema.parse(req.params);
    const logs = await this.stageService.getStageAuditLogs(params.id, params.projectId);
    res.status(200).json(logs);
  }

  /**
   * POST /api/stages/:id/clone
   * Clone a stage
   */
  private async cloneStage(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.STAGE_WRITE]);
    const params = stageRouteParamsSchema.parse(req.params);
    const body = cloneStageSchema.parse(req.body);
    const stage = await this.stageService.cloneStage(params.projectId, params.id, body, req.context);
    res.status(201).json(stage);
  }
}
