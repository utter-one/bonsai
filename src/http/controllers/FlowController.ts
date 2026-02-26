import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { FlowService } from '../../services/FlowService';
import { createFlowSchema, updateFlowBodySchema, deleteFlowBodySchema, flowResponseSchema, flowListResponseSchema, flowRouteParamsSchema, cloneFlowSchema } from '../contracts/flow';
import type { UpdateFlowRequest, CloneFlowRequest } from '../contracts/flow';
import { listParamsSchema, projectScopedParamsSchema } from '../contracts/common';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for flow management with explicit routing
 * Manages flows which are project-scoped entities that group their own actions and tools
 */
@singleton()
export class FlowController {
  constructor(@inject(FlowService) private readonly flowService: FlowService) {}

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/projects/{projectId}/flows',
        tags: ['Flows'],
        summary: 'Create a new flow',
        description: 'Creates a new flow within a project with specified name and optional configuration',
        request: {
          body: {
            content: {
              'application/json': {
                schema: createFlowSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Flow created successfully',
            content: {
              'application/json': {
                schema: flowResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          409: { description: 'Flow already exists' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/flows/{id}',
        tags: ['Flows'],
        summary: 'Get flow by ID',
        description: 'Retrieves a single flow by its unique identifier',
        request: {
          params: flowRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Flow retrieved successfully',
            content: {
              'application/json': {
                schema: flowResponseSchema,
              },
            },
          },
          404: { description: 'Flow not found' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/flows',
        tags: ['Flows'],
        summary: 'List flows',
        description: 'Retrieves a paginated list of flows with optional filtering and sorting',
        request: {
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'List of flows retrieved successfully',
            content: {
              'application/json': {
                schema: flowListResponseSchema,
              },
            },
          },
          400: { description: 'Invalid query parameters' },
        },
      },
      {
        method: 'put',
        path: '/api/projects/{projectId}/flows/{id}',
        tags: ['Flows'],
        summary: 'Update flow',
        description: 'Updates an existing flow with optimistic locking',
        request: {
          params: flowRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: updateFlowBodySchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Flow updated successfully',
            content: {
              'application/json': {
                schema: flowResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Flow not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'delete',
        path: '/api/projects/{projectId}/flows/{id}',
        tags: ['Flows'],
        summary: 'Delete flow',
        description: 'Deletes a flow with optimistic locking',
        request: {
          params: flowRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: deleteFlowBodySchema,
              },
            },
          },
        },
        responses: {
          204: { description: 'Flow deleted successfully' },
          400: { description: 'Invalid request body' },
          404: { description: 'Flow not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/flows/{id}/audit-logs',
        tags: ['Flows'],
        summary: 'Get flow audit logs',
        description: 'Retrieves audit logs for a specific flow',
        request: {
          params: flowRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Audit logs retrieved successfully',
          },
          404: { description: 'Flow not found' },
        },
      },
      {
        method: 'post',
        path: '/api/projects/{projectId}/flows/{id}/clone',
        tags: ['Flows'],
        summary: 'Clone flow',
        description: 'Creates a copy of an existing flow with a new ID and optional name override',
        request: {
          params: flowRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: cloneFlowSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Flow cloned successfully',
            content: {
              'application/json': {
                schema: flowResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Flow not found' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    router.post('/api/projects/:projectId/flows', asyncHandler(this.createFlow.bind(this)));
    router.get('/api/projects/:projectId/flows/:id', asyncHandler(this.getFlowById.bind(this)));
    router.get('/api/projects/:projectId/flows', asyncHandler(this.listFlows.bind(this)));
    router.put('/api/projects/:projectId/flows/:id', asyncHandler(this.updateFlow.bind(this)));
    router.delete('/api/projects/:projectId/flows/:id', asyncHandler(this.deleteFlow.bind(this)));
    router.get('/api/projects/:projectId/flows/:id/audit-logs', asyncHandler(this.getFlowAuditLogs.bind(this)));
    router.post('/api/projects/:projectId/flows/:id/clone', asyncHandler(this.cloneFlow.bind(this)));
  }

  /**
   * POST /api/projects/:projectId/flows
   * Create a new flow
   */
  private async createFlow(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.FLOW_WRITE]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const body = createFlowSchema.parse(req.body);
    const flow = await this.flowService.createFlow(projectId, body, req.context);
    res.status(201).json(flow);
  }

  /**
   * GET /api/projects/:projectId/flows/:id
   * Get a flow by ID
   */
  private async getFlowById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.FLOW_READ]);
    const params = flowRouteParamsSchema.parse(req.params);
    const flow = await this.flowService.getFlowById(params.projectId, params.id);
    res.status(200).json(flow);
  }

  /**
   * GET /api/projects/:projectId/flows
   * List flows with optional filters
   */
  private async listFlows(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.FLOW_READ]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const query = listParamsSchema.parse(req.query);
    const flowList = await this.flowService.listFlows(projectId, query);
    res.status(200).json(flowList);
  }

  /**
   * PUT /api/projects/:projectId/flows/:id
   * Update a flow
   */
  private async updateFlow(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.FLOW_WRITE]);
    const params = flowRouteParamsSchema.parse(req.params);
    const body = updateFlowBodySchema.parse(req.body) as UpdateFlowRequest;
    const flow = await this.flowService.updateFlow(params.projectId, params.id, body, req.context);
    res.status(200).json(flow);
  }

  /**
   * DELETE /api/projects/:projectId/flows/:id
   * Delete a flow
   */
  private async deleteFlow(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.FLOW_DELETE]);
    const params = flowRouteParamsSchema.parse(req.params);
    const body = deleteFlowBodySchema.parse(req.body);
    await this.flowService.deleteFlow(params.projectId, params.id, body.version, req.context);
    res.status(204).send();
  }

  /**
   * GET /api/projects/:projectId/flows/:id/audit-logs
   * Get audit logs for a flow
   */
  private async getFlowAuditLogs(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.AUDIT_READ]);
    const params = flowRouteParamsSchema.parse(req.params);
    const logs = await this.flowService.getFlowAuditLogs(params.id);
    res.status(200).json(logs);
  }

  /**
   * POST /api/projects/:projectId/flows/:id/clone
   * Clone a flow
   */
  private async cloneFlow(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.FLOW_WRITE]);
    const params = flowRouteParamsSchema.parse(req.params);
    const body = cloneFlowSchema.parse(req.body) as CloneFlowRequest;
    const flow = await this.flowService.cloneFlow(params.projectId, params.id, body, req.context);
    res.status(201).json(flow);
  }
}
