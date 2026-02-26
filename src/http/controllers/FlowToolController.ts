import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { FlowToolService } from '../../services/FlowToolService';
import { createFlowToolSchema, updateFlowToolBodySchema, deleteFlowToolBodySchema, flowToolResponseSchema, flowToolListResponseSchema, flowToolRouteParamsSchema, cloneFlowToolSchema } from '../contracts/flowTool';
import type { UpdateFlowToolRequest, CloneFlowToolRequest } from '../contracts/flowTool';
import { listParamsSchema, flowScopedParamsSchema } from '../contracts/common';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for flow tool management with explicit routing
 * Manages flow tools which are tools scoped to a specific flow, mirroring the project-level tool structure
 */
@singleton()
export class FlowToolController {
  constructor(@inject(FlowToolService) private readonly flowToolService: FlowToolService) {}

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/projects/{projectId}/flows/{flowId}/tools',
        tags: ['Flow Tools'],
        summary: 'Create a new flow tool',
        description: 'Creates a new tool within a flow with specified name, prompt, input/output types, and configuration',
        request: {
          body: {
            content: {
              'application/json': {
                schema: createFlowToolSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Flow tool created successfully',
            content: {
              'application/json': {
                schema: flowToolResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          409: { description: 'Flow tool already exists' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/flows/{flowId}/tools/{id}',
        tags: ['Flow Tools'],
        summary: 'Get flow tool by ID',
        description: 'Retrieves a single flow tool by its unique identifier',
        request: {
          params: flowToolRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Flow tool retrieved successfully',
            content: {
              'application/json': {
                schema: flowToolResponseSchema,
              },
            },
          },
          404: { description: 'Flow tool not found' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/flows/{flowId}/tools',
        tags: ['Flow Tools'],
        summary: 'List flow tools',
        description: 'Retrieves a paginated list of flow tools with optional filtering and sorting',
        request: {
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'List of flow tools retrieved successfully',
            content: {
              'application/json': {
                schema: flowToolListResponseSchema,
              },
            },
          },
          400: { description: 'Invalid query parameters' },
        },
      },
      {
        method: 'put',
        path: '/api/projects/{projectId}/flows/{flowId}/tools/{id}',
        tags: ['Flow Tools'],
        summary: 'Update flow tool',
        description: 'Updates an existing flow tool with optimistic locking',
        request: {
          params: flowToolRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: updateFlowToolBodySchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Flow tool updated successfully',
            content: {
              'application/json': {
                schema: flowToolResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Flow tool not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'delete',
        path: '/api/projects/{projectId}/flows/{flowId}/tools/{id}',
        tags: ['Flow Tools'],
        summary: 'Delete flow tool',
        description: 'Deletes a flow tool with optimistic locking',
        request: {
          params: flowToolRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: deleteFlowToolBodySchema,
              },
            },
          },
        },
        responses: {
          204: { description: 'Flow tool deleted successfully' },
          400: { description: 'Invalid request body' },
          404: { description: 'Flow tool not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/flows/{flowId}/tools/{id}/audit-logs',
        tags: ['Flow Tools'],
        summary: 'Get flow tool audit logs',
        description: 'Retrieves audit logs for a specific flow tool',
        request: {
          params: flowToolRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Audit logs retrieved successfully',
          },
          404: { description: 'Flow tool not found' },
        },
      },
      {
        method: 'post',
        path: '/api/projects/{projectId}/flows/{flowId}/tools/{id}/clone',
        tags: ['Flow Tools'],
        summary: 'Clone flow tool',
        description: 'Creates a copy of an existing flow tool with a new ID and optional name override',
        request: {
          params: flowToolRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: cloneFlowToolSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Flow tool cloned successfully',
            content: {
              'application/json': {
                schema: flowToolResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Flow tool not found' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    router.post('/api/projects/:projectId/flows/:flowId/tools', asyncHandler(this.createFlowTool.bind(this)));
    router.get('/api/projects/:projectId/flows/:flowId/tools/:id', asyncHandler(this.getFlowToolById.bind(this)));
    router.get('/api/projects/:projectId/flows/:flowId/tools', asyncHandler(this.listFlowTools.bind(this)));
    router.put('/api/projects/:projectId/flows/:flowId/tools/:id', asyncHandler(this.updateFlowTool.bind(this)));
    router.delete('/api/projects/:projectId/flows/:flowId/tools/:id', asyncHandler(this.deleteFlowTool.bind(this)));
    router.get('/api/projects/:projectId/flows/:flowId/tools/:id/audit-logs', asyncHandler(this.getFlowToolAuditLogs.bind(this)));
    router.post('/api/projects/:projectId/flows/:flowId/tools/:id/clone', asyncHandler(this.cloneFlowTool.bind(this)));
  }

  /**
   * POST /api/projects/:projectId/flows/:flowId/tools
   * Create a new flow tool
   */
  private async createFlowTool(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.FLOW_WRITE]);
    const { projectId, flowId } = flowScopedParamsSchema.parse(req.params);
    const body = createFlowToolSchema.parse(req.body);
    const tool = await this.flowToolService.createFlowTool(projectId, flowId, body, req.context);
    res.status(201).json(tool);
  }

  /**
   * GET /api/projects/:projectId/flows/:flowId/tools/:id
   * Get a flow tool by ID
   */
  private async getFlowToolById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.FLOW_READ]);
    const params = flowToolRouteParamsSchema.parse(req.params);
    const tool = await this.flowToolService.getFlowToolById(params.projectId, params.flowId, params.id);
    res.status(200).json(tool);
  }

  /**
   * GET /api/projects/:projectId/flows/:flowId/tools
   * List flow tools with optional filters
   */
  private async listFlowTools(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.FLOW_READ]);
    const { projectId, flowId } = flowScopedParamsSchema.parse(req.params);
    const query = listParamsSchema.parse(req.query);
    const tools = await this.flowToolService.listFlowTools(projectId, flowId, query);
    res.status(200).json(tools);
  }

  /**
   * PUT /api/projects/:projectId/flows/:flowId/tools/:id
   * Update a flow tool
   */
  private async updateFlowTool(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.FLOW_WRITE]);
    const params = flowToolRouteParamsSchema.parse(req.params);
    const body = updateFlowToolBodySchema.parse(req.body) as UpdateFlowToolRequest;
    const tool = await this.flowToolService.updateFlowTool(params.projectId, params.flowId, params.id, body, req.context);
    res.status(200).json(tool);
  }

  /**
   * DELETE /api/projects/:projectId/flows/:flowId/tools/:id
   * Delete a flow tool
   */
  private async deleteFlowTool(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.FLOW_DELETE]);
    const params = flowToolRouteParamsSchema.parse(req.params);
    const body = deleteFlowToolBodySchema.parse(req.body);
    await this.flowToolService.deleteFlowTool(params.projectId, params.flowId, params.id, body.version, req.context);
    res.status(204).send();
  }

  /**
   * GET /api/projects/:projectId/flows/:flowId/tools/:id/audit-logs
   * Get audit logs for a flow tool
   */
  private async getFlowToolAuditLogs(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.AUDIT_READ]);
    const params = flowToolRouteParamsSchema.parse(req.params);
    const logs = await this.flowToolService.getFlowToolAuditLogs(params.id);
    res.status(200).json(logs);
  }

  /**
   * POST /api/projects/:projectId/flows/:flowId/tools/:id/clone
   * Clone a flow tool
   */
  private async cloneFlowTool(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.FLOW_WRITE]);
    const params = flowToolRouteParamsSchema.parse(req.params);
    const body = cloneFlowToolSchema.parse(req.body) as CloneFlowToolRequest;
    const tool = await this.flowToolService.cloneFlowTool(params.projectId, params.flowId, params.id, body, req.context);
    res.status(201).json(tool);
  }
}
