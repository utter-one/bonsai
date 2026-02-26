import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { FlowActionService } from '../../services/FlowActionService';
import { createFlowActionSchema, updateFlowActionBodySchema, deleteFlowActionBodySchema, flowActionResponseSchema, flowActionListResponseSchema, flowActionRouteParamsSchema, cloneFlowActionSchema } from '../contracts/flowAction';
import type { UpdateFlowActionRequest, CloneFlowActionRequest } from '../contracts/flowAction';
import { listParamsSchema, flowScopedParamsSchema } from '../contracts/common';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for flow action management with explicit routing
 * Manages flow actions which are actions scoped to a specific flow, mirroring the global action structure
 */
@singleton()
export class FlowActionController {
  constructor(@inject(FlowActionService) private readonly flowActionService: FlowActionService) {}

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/projects/{projectId}/flows/{flowId}/actions',
        tags: ['Flow Actions'],
        summary: 'Create a new flow action',
        description: 'Creates a new action within a flow with specified trigger settings, effects, and configuration',
        request: {
          body: {
            content: {
              'application/json': {
                schema: createFlowActionSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Flow action created successfully',
            content: {
              'application/json': {
                schema: flowActionResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          409: { description: 'Flow action already exists' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/flows/{flowId}/actions/{id}',
        tags: ['Flow Actions'],
        summary: 'Get flow action by ID',
        description: 'Retrieves a single flow action by its unique identifier',
        request: {
          params: flowActionRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Flow action retrieved successfully',
            content: {
              'application/json': {
                schema: flowActionResponseSchema,
              },
            },
          },
          404: { description: 'Flow action not found' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/flows/{flowId}/actions',
        tags: ['Flow Actions'],
        summary: 'List flow actions',
        description: 'Retrieves a paginated list of flow actions with optional filtering and sorting',
        request: {
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'List of flow actions retrieved successfully',
            content: {
              'application/json': {
                schema: flowActionListResponseSchema,
              },
            },
          },
          400: { description: 'Invalid query parameters' },
        },
      },
      {
        method: 'put',
        path: '/api/projects/{projectId}/flows/{flowId}/actions/{id}',
        tags: ['Flow Actions'],
        summary: 'Update flow action',
        description: 'Updates an existing flow action with optimistic locking',
        request: {
          params: flowActionRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: updateFlowActionBodySchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Flow action updated successfully',
            content: {
              'application/json': {
                schema: flowActionResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Flow action not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'delete',
        path: '/api/projects/{projectId}/flows/{flowId}/actions/{id}',
        tags: ['Flow Actions'],
        summary: 'Delete flow action',
        description: 'Deletes a flow action with optimistic locking',
        request: {
          params: flowActionRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: deleteFlowActionBodySchema,
              },
            },
          },
        },
        responses: {
          204: { description: 'Flow action deleted successfully' },
          400: { description: 'Invalid request body' },
          404: { description: 'Flow action not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/flows/{flowId}/actions/{id}/audit-logs',
        tags: ['Flow Actions'],
        summary: 'Get flow action audit logs',
        description: 'Retrieves audit logs for a specific flow action',
        request: {
          params: flowActionRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Audit logs retrieved successfully',
          },
          404: { description: 'Flow action not found' },
        },
      },
      {
        method: 'post',
        path: '/api/projects/{projectId}/flows/{flowId}/actions/{id}/clone',
        tags: ['Flow Actions'],
        summary: 'Clone flow action',
        description: 'Creates a copy of an existing flow action with a new ID and optional name override',
        request: {
          params: flowActionRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: cloneFlowActionSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Flow action cloned successfully',
            content: {
              'application/json': {
                schema: flowActionResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Flow action not found' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    router.post('/api/projects/:projectId/flows/:flowId/actions', asyncHandler(this.createFlowAction.bind(this)));
    router.get('/api/projects/:projectId/flows/:flowId/actions/:id', asyncHandler(this.getFlowActionById.bind(this)));
    router.get('/api/projects/:projectId/flows/:flowId/actions', asyncHandler(this.listFlowActions.bind(this)));
    router.put('/api/projects/:projectId/flows/:flowId/actions/:id', asyncHandler(this.updateFlowAction.bind(this)));
    router.delete('/api/projects/:projectId/flows/:flowId/actions/:id', asyncHandler(this.deleteFlowAction.bind(this)));
    router.get('/api/projects/:projectId/flows/:flowId/actions/:id/audit-logs', asyncHandler(this.getFlowActionAuditLogs.bind(this)));
    router.post('/api/projects/:projectId/flows/:flowId/actions/:id/clone', asyncHandler(this.cloneFlowAction.bind(this)));
  }

  /**
   * POST /api/projects/:projectId/flows/:flowId/actions
   * Create a new flow action
   */
  private async createFlowAction(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.FLOW_WRITE]);
    const { projectId, flowId } = flowScopedParamsSchema.parse(req.params);
    const body = createFlowActionSchema.parse(req.body);
    const action = await this.flowActionService.createFlowAction(projectId, flowId, body, req.context);
    res.status(201).json(action);
  }

  /**
   * GET /api/projects/:projectId/flows/:flowId/actions/:id
   * Get a flow action by ID
   */
  private async getFlowActionById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.FLOW_READ]);
    const params = flowActionRouteParamsSchema.parse(req.params);
    const action = await this.flowActionService.getFlowActionById(params.projectId, params.flowId, params.id);
    res.status(200).json(action);
  }

  /**
   * GET /api/projects/:projectId/flows/:flowId/actions
   * List flow actions with optional filters
   */
  private async listFlowActions(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.FLOW_READ]);
    const { projectId, flowId } = flowScopedParamsSchema.parse(req.params);
    const query = listParamsSchema.parse(req.query);
    const actions = await this.flowActionService.listFlowActions(projectId, flowId, query);
    res.status(200).json(actions);
  }

  /**
   * PUT /api/projects/:projectId/flows/:flowId/actions/:id
   * Update a flow action
   */
  private async updateFlowAction(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.FLOW_WRITE]);
    const params = flowActionRouteParamsSchema.parse(req.params);
    const body = updateFlowActionBodySchema.parse(req.body) as UpdateFlowActionRequest;
    const action = await this.flowActionService.updateFlowAction(params.projectId, params.flowId, params.id, body, req.context);
    res.status(200).json(action);
  }

  /**
   * DELETE /api/projects/:projectId/flows/:flowId/actions/:id
   * Delete a flow action
   */
  private async deleteFlowAction(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.FLOW_DELETE]);
    const params = flowActionRouteParamsSchema.parse(req.params);
    const body = deleteFlowActionBodySchema.parse(req.body);
    await this.flowActionService.deleteFlowAction(params.projectId, params.flowId, params.id, body.version, req.context);
    res.status(204).send();
  }

  /**
   * GET /api/projects/:projectId/flows/:flowId/actions/:id/audit-logs
   * Get audit logs for a flow action
   */
  private async getFlowActionAuditLogs(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.AUDIT_READ]);
    const params = flowActionRouteParamsSchema.parse(req.params);
    const logs = await this.flowActionService.getFlowActionAuditLogs(params.id);
    res.status(200).json(logs);
  }

  /**
   * POST /api/projects/:projectId/flows/:flowId/actions/:id/clone
   * Clone a flow action
   */
  private async cloneFlowAction(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.FLOW_WRITE]);
    const params = flowActionRouteParamsSchema.parse(req.params);
    const body = cloneFlowActionSchema.parse(req.body) as CloneFlowActionRequest;
    const action = await this.flowActionService.cloneFlowAction(params.projectId, params.flowId, params.id, body, req.context);
    res.status(201).json(action);
  }
}
