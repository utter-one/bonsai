import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { StageToolService } from '../../services/StageToolService';
import { createStageToolSchema, updateStageToolBodySchema, deleteStageToolBodySchema, stageToolResponseSchema, stageToolListResponseSchema, stageToolRouteParamsSchema, cloneStageToolSchema } from '../contracts/stageTool';
import type { UpdateStageToolRequest, CloneStageToolRequest } from '../contracts/stageTool';
import { listParamsSchema, stageScopedParamsSchema } from '../contracts/common';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for stage tool management with explicit routing
 * Manages stage tools which are tools scoped to a specific stage within a flow, mirroring the flow-level tool structure
 */
@singleton()
export class StageToolController {
  constructor(@inject(StageToolService) private readonly stageToolService: StageToolService) {}

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/projects/{projectId}/flows/{flowId}/stages/{stageId}/tools',
        tags: ['Stage Tools'],
        summary: 'Create a new stage tool',
        description: 'Creates a new tool within a stage with specified name, prompt, input/output types, and configuration',
        request: {
          body: {
            content: {
              'application/json': {
                schema: createStageToolSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Stage tool created successfully',
            content: {
              'application/json': {
                schema: stageToolResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          409: { description: 'Stage tool already exists' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/flows/{flowId}/stages/{stageId}/tools/{id}',
        tags: ['Stage Tools'],
        summary: 'Get stage tool by ID',
        description: 'Retrieves a single stage tool by its unique identifier',
        request: {
          params: stageToolRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Stage tool retrieved successfully',
            content: {
              'application/json': {
                schema: stageToolResponseSchema,
              },
            },
          },
          404: { description: 'Stage tool not found' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/flows/{flowId}/stages/{stageId}/tools',
        tags: ['Stage Tools'],
        summary: 'List stage tools',
        description: 'Retrieves a paginated list of stage tools with optional filtering and sorting',
        request: {
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'List of stage tools retrieved successfully',
            content: {
              'application/json': {
                schema: stageToolListResponseSchema,
              },
            },
          },
          400: { description: 'Invalid query parameters' },
        },
      },
      {
        method: 'put',
        path: '/api/projects/{projectId}/flows/{flowId}/stages/{stageId}/tools/{id}',
        tags: ['Stage Tools'],
        summary: 'Update stage tool',
        description: 'Updates an existing stage tool with optimistic locking',
        request: {
          params: stageToolRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: updateStageToolBodySchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Stage tool updated successfully',
            content: {
              'application/json': {
                schema: stageToolResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Stage tool not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'delete',
        path: '/api/projects/{projectId}/flows/{flowId}/stages/{stageId}/tools/{id}',
        tags: ['Stage Tools'],
        summary: 'Delete stage tool',
        description: 'Deletes a stage tool with optimistic locking',
        request: {
          params: stageToolRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: deleteStageToolBodySchema,
              },
            },
          },
        },
        responses: {
          204: { description: 'Stage tool deleted successfully' },
          400: { description: 'Invalid request body' },
          404: { description: 'Stage tool not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/flows/{flowId}/stages/{stageId}/tools/{id}/audit-logs',
        tags: ['Stage Tools'],
        summary: 'Get stage tool audit logs',
        description: 'Retrieves audit logs for a specific stage tool',
        request: {
          params: stageToolRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Audit logs retrieved successfully',
          },
          404: { description: 'Stage tool not found' },
        },
      },
      {
        method: 'post',
        path: '/api/projects/{projectId}/flows/{flowId}/stages/{stageId}/tools/{id}/clone',
        tags: ['Stage Tools'],
        summary: 'Clone stage tool',
        description: 'Creates a copy of an existing stage tool with a new ID and optional name override',
        request: {
          params: stageToolRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: cloneStageToolSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Stage tool cloned successfully',
            content: {
              'application/json': {
                schema: stageToolResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Stage tool not found' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    router.post('/api/projects/:projectId/flows/:flowId/stages/:stageId/tools', asyncHandler(this.createStageTool.bind(this)));
    router.get('/api/projects/:projectId/flows/:flowId/stages/:stageId/tools/:id', asyncHandler(this.getStageToolById.bind(this)));
    router.get('/api/projects/:projectId/flows/:flowId/stages/:stageId/tools', asyncHandler(this.listStageTools.bind(this)));
    router.put('/api/projects/:projectId/flows/:flowId/stages/:stageId/tools/:id', asyncHandler(this.updateStageTool.bind(this)));
    router.delete('/api/projects/:projectId/flows/:flowId/stages/:stageId/tools/:id', asyncHandler(this.deleteStageTool.bind(this)));
    router.get('/api/projects/:projectId/flows/:flowId/stages/:stageId/tools/:id/audit-logs', asyncHandler(this.getStageToolAuditLogs.bind(this)));
    router.post('/api/projects/:projectId/flows/:flowId/stages/:stageId/tools/:id/clone', asyncHandler(this.cloneStageTool.bind(this)));
  }

  /**
   * POST /api/projects/:projectId/flows/:flowId/stages/:stageId/tools
   * Create a new stage tool
   */
  private async createStageTool(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.STAGE_WRITE]);
    const { projectId, flowId, stageId } = stageScopedParamsSchema.parse(req.params);
    const body = createStageToolSchema.parse(req.body);
    const tool = await this.stageToolService.createStageTool(projectId, flowId, stageId, body, req.context);
    res.status(201).json(tool);
  }

  /**
   * GET /api/projects/:projectId/flows/:flowId/stages/:stageId/tools/:id
   * Get a stage tool by ID
   */
  private async getStageToolById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.STAGE_READ]);
    const params = stageToolRouteParamsSchema.parse(req.params);
    const tool = await this.stageToolService.getStageToolById(params.projectId, params.flowId, params.stageId, params.id);
    res.status(200).json(tool);
  }

  /**
   * GET /api/projects/:projectId/flows/:flowId/stages/:stageId/tools
   * List stage tools with optional filters
   */
  private async listStageTools(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.STAGE_READ]);
    const { projectId, flowId, stageId } = stageScopedParamsSchema.parse(req.params);
    const query = listParamsSchema.parse(req.query);
    const tools = await this.stageToolService.listStageTools(projectId, flowId, stageId, query);
    res.status(200).json(tools);
  }

  /**
   * PUT /api/projects/:projectId/flows/:flowId/stages/:stageId/tools/:id
   * Update a stage tool
   */
  private async updateStageTool(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.STAGE_WRITE]);
    const params = stageToolRouteParamsSchema.parse(req.params);
    const body = updateStageToolBodySchema.parse(req.body) as UpdateStageToolRequest;
    const tool = await this.stageToolService.updateStageTool(params.projectId, params.flowId, params.stageId, params.id, body, req.context);
    res.status(200).json(tool);
  }

  /**
   * DELETE /api/projects/:projectId/flows/:flowId/stages/:stageId/tools/:id
   * Delete a stage tool
   */
  private async deleteStageTool(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.STAGE_DELETE]);
    const params = stageToolRouteParamsSchema.parse(req.params);
    const body = deleteStageToolBodySchema.parse(req.body);
    await this.stageToolService.deleteStageTool(params.projectId, params.flowId, params.stageId, params.id, body.version, req.context);
    res.status(204).send();
  }

  /**
   * GET /api/projects/:projectId/flows/:flowId/stages/:stageId/tools/:id/audit-logs
   * Get audit logs for a stage tool
   */
  private async getStageToolAuditLogs(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.AUDIT_READ]);
    const params = stageToolRouteParamsSchema.parse(req.params);
    const logs = await this.stageToolService.getStageToolAuditLogs(params.id);
    res.status(200).json(logs);
  }

  /**
   * POST /api/projects/:projectId/flows/:flowId/stages/:stageId/tools/:id/clone
   * Clone a stage tool
   */
  private async cloneStageTool(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.STAGE_WRITE]);
    const params = stageToolRouteParamsSchema.parse(req.params);
    const body = cloneStageToolSchema.parse(req.body) as CloneStageToolRequest;
    const tool = await this.stageToolService.cloneStageTool(params.projectId, params.flowId, params.stageId, params.id, body, req.context);
    res.status(201).json(tool);
  }
}
