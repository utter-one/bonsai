import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { GlobalActionService } from '../../services/GlobalActionService';
import { createGlobalActionSchema, updateGlobalActionBodySchema, deleteGlobalActionBodySchema, globalActionResponseSchema, globalActionListResponseSchema, globalActionRouteParamsSchema } from '../contracts/globalAction';
import type { CreateGlobalActionRequest, UpdateGlobalActionRequest, DeleteGlobalActionRequest } from '../contracts/globalAction';
import { listParamsSchema } from '../contracts/common';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for global action management with explicit routing
 * Manages global actions which are user actions that can be triggered at any point during a conversation
 */
@singleton()
export class GlobalActionController {
  constructor(@inject(GlobalActionService) private readonly globalActionService: GlobalActionService) {}

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/global-actions',
        tags: ['Global Actions'],
        summary: 'Create a new global action',
        description: 'Creates a new global action with specified name, prompt trigger, operations, and configuration',
        request: {
          body: {
            content: {
              'application/json': {
                schema: createGlobalActionSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Global action created successfully',
            content: {
              'application/json': {
                schema: globalActionResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          409: { description: 'Global action already exists' },
        },
      },
      {
        method: 'get',
        path: '/api/global-actions/{id}',
        tags: ['Global Actions'],
        summary: 'Get global action by ID',
        description: 'Retrieves a single global action by its unique identifier',
        request: {
          params: globalActionRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Global action retrieved successfully',
            content: {
              'application/json': {
                schema: globalActionResponseSchema,
              },
            },
          },
          404: { description: 'Global action not found' },
        },
      },
      {
        method: 'get',
        path: '/api/global-actions',
        tags: ['Global Actions'],
        summary: 'List global actions',
        description: 'Retrieves a paginated list of global actions with optional filtering and sorting',
        request: {
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'List of global actions retrieved successfully',
            content: {
              'application/json': {
                schema: globalActionListResponseSchema,
              },
            },
          },
          400: { description: 'Invalid query parameters' },
        },
      },
      {
        method: 'put',
        path: '/api/global-actions/{id}',
        tags: ['Global Actions'],
        summary: 'Update global action',
        description: 'Updates an existing global action with optimistic locking',
        request: {
          params: globalActionRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: updateGlobalActionBodySchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Global action updated successfully',
            content: {
              'application/json': {
                schema: globalActionResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Global action not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'delete',
        path: '/api/global-actions/{id}',
        tags: ['Global Actions'],
        summary: 'Delete global action',
        description: 'Deletes a global action with optimistic locking',
        request: {
          params: globalActionRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: deleteGlobalActionBodySchema,
              },
            },
          },
        },
        responses: {
          204: { description: 'Global action deleted successfully' },
          400: { description: 'Invalid request body' },
          404: { description: 'Global action not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'get',
        path: '/api/global-actions/{id}/audit-logs',
        tags: ['Global Actions'],
        summary: 'Get global action audit logs',
        description: 'Retrieves audit logs for a specific global action',
        request: {
          params: globalActionRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Audit logs retrieved successfully',
          },
          404: { description: 'Global action not found' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    router.post('/api/global-actions', asyncHandler(this.createGlobalAction.bind(this)));
    router.get('/api/global-actions/:id', asyncHandler(this.getGlobalActionById.bind(this)));
    router.get('/api/global-actions', asyncHandler(this.listGlobalActions.bind(this)));
    router.put('/api/global-actions/:id', asyncHandler(this.updateGlobalAction.bind(this)));
    router.delete('/api/global-actions/:id', asyncHandler(this.deleteGlobalAction.bind(this)));
    router.get('/api/global-actions/:id/audit-logs', asyncHandler(this.getGlobalActionAuditLogs.bind(this)));
  }

  /**
   * POST /api/global-actions
   * Create a new global action
   */
  private async createGlobalAction(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.GLOBAL_ACTION_WRITE]);
    const body = createGlobalActionSchema.parse(req.body);
    const globalAction = await this.globalActionService.createGlobalAction(body, req.context);
    res.status(201).json(globalAction);
  }

  /**
   * GET /api/global-actions/:id
   * Get a global action by ID
   */
  private async getGlobalActionById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.GLOBAL_ACTION_READ]);
    const params = globalActionRouteParamsSchema.parse(req.params);
    const globalAction = await this.globalActionService.getGlobalActionById(params.id);
    res.status(200).json(globalAction);
  }

  /**
   * GET /api/global-actions
   * List global actions with optional filters
   */
  private async listGlobalActions(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.GLOBAL_ACTION_READ]);
    const query = listParamsSchema.parse(req.query);
    const globalActions = await this.globalActionService.listGlobalActions(query);
    res.status(200).json(globalActions);
  }

  /**
   * PUT /api/global-actions/:id
   * Update a global action
   */
  private async updateGlobalAction(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.GLOBAL_ACTION_WRITE]);
    const params = globalActionRouteParamsSchema.parse(req.params);
    const body = updateGlobalActionBodySchema.parse(req.body);
    const globalAction = await this.globalActionService.updateGlobalAction(params.id, body, req.context);
    res.status(200).json(globalAction);
  }

  /**
   * DELETE /api/global-actions/:id
   * Delete a global action
   */
  private async deleteGlobalAction(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.GLOBAL_ACTION_DELETE]);
    const params = globalActionRouteParamsSchema.parse(req.params);
    const body = deleteGlobalActionBodySchema.parse(req.body);
    await this.globalActionService.deleteGlobalAction(params.id, body.version, req.context);
    res.status(204).send();
  }

  /**
   * GET /api/global-actions/:id/audit-logs
   * Get audit logs for a global action
   */
  private async getGlobalActionAuditLogs(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.AUDIT_READ]);
    const params = globalActionRouteParamsSchema.parse(req.params);
    const logs = await this.globalActionService.getGlobalActionAuditLogs(params.id);
    res.status(200).json(logs);
  }
}
