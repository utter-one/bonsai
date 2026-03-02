import { inject, singleton } from 'tsyringe';
import type { Request, Response, NextFunction, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { OperatorService } from '../../services/OperatorService';
import { createOperatorSchema, updateOperatorBodySchema, deleteOperatorBodySchema, operatorResponseSchema, operatorListResponseSchema, operatorRouteParamsSchema, updateProfileSchema, profileResponseSchema } from '../contracts/operator';
import type { UpdateOperatorRequest } from '../contracts/operator';
import { listParamsSchema } from '../contracts/common';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for operator user management with explicit routing
 */
@singleton()
export class OperatorController {
  constructor(@inject(OperatorService) private readonly operatorService: OperatorService) {}

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/operators',
        tags: ['Operators'],
        summary: 'Create a new operator user',
        description: 'Creates a new operator user with the specified credentials and roles',
        request: {
          body: {
            content: {
              'application/json': {
                schema: createOperatorSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Operator user created successfully',
            content: {
              'application/json': {
                schema: operatorResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          409: { description: 'Operator user already exists' },
        },
      },
      {
        method: 'get',
        path: '/api/operators/{id}',
        tags: ['Operators'],
        summary: 'Get operator user by ID',
        description: 'Retrieves a single operator user by their unique identifier',
        request: {
          params: operatorRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Operator user retrieved successfully',
            content: {
              'application/json': {
                schema: operatorResponseSchema,
              },
            },
          },
          404: { description: 'Operator user not found' },
        },
      },
      {
        method: 'get',
        path: '/api/operators',
        tags: ['Operators'],
        summary: 'List operator users',
        description: 'Retrieves a paginated list of operator users with optional filtering',
        request: {
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'List of operator users retrieved successfully',
            content: {
              'application/json': {
                schema: operatorListResponseSchema,
              },
            },
          },
          400: { description: 'Invalid query parameters' },
        },
      },
      {
        method: 'put',
        path: '/api/operators/{id}',
        tags: ['Operators'],
        summary: 'Update operator user',
        description: 'Updates an existing operator user with optimistic locking',
        request: {
          params: operatorRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: updateOperatorBodySchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Operator user updated successfully',
            content: {
              'application/json': {
                schema: operatorResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Operator user not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'delete',
        path: '/api/operators/{id}',
        tags: ['Operators'],
        summary: 'Delete operator user',
        description: 'Deletes an operator user with optimistic locking',
        request: {
          params: operatorRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: deleteOperatorBodySchema,
              },
            },
          },
        },
        responses: {
          204: { description: 'Operator user deleted successfully' },
          400: { description: 'Invalid request body' },
          404: { description: 'Operator user not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'get',
        path: '/api/operators/{id}/audit-logs',
        tags: ['Operators'],
        summary: 'Get operator audit logs',
        description: 'Retrieves audit logs for a specific operator user',
        request: {
          params: operatorRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Audit logs retrieved successfully',
          },
          404: { description: 'Operator user not found' },
        },
      },
      {
        method: 'get',
        path: '/api/profile',
        tags: ['Profile'],
        summary: 'Get own profile',
        description: 'Retrieves the profile information of the currently logged-in operator user',
        responses: {
          200: {
            description: 'Profile retrieved successfully',
            content: {
              'application/json': {
                schema: profileResponseSchema,
              },
            },
          },
          401: { description: 'Not authenticated' },
        },
      },
      {
        method: 'post',
        path: '/api/profile',
        tags: ['Profile'],
        summary: 'Update own profile',
        description: 'Updates the profile of the currently logged-in operator user. Allows changing display name and/or password. When changing password, the old password must be provided for verification.',
        request: {
          body: {
            content: {
              'application/json': {
                schema: updateProfileSchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Profile updated successfully',
            content: {
              'application/json': {
                schema: profileResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          401: { description: 'Not authenticated or invalid old password' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    router.post('/api/operators', asyncHandler(this.createOperator.bind(this)));
    router.get('/api/operators/:id', asyncHandler(this.getOperatorById.bind(this)));
    router.get('/api/operators', asyncHandler(this.listOperators.bind(this)));
    router.put('/api/operators/:id', asyncHandler(this.updateOperator.bind(this)));
    router.delete('/api/operators/:id', asyncHandler(this.deleteOperator.bind(this)));
    router.get('/api/operators/:id/audit-logs', asyncHandler(this.getOperatorAuditLogs.bind(this)));
    router.get('/api/profile', asyncHandler(this.getProfile.bind(this)));
    router.post('/api/profile', asyncHandler(this.updateProfile.bind(this)));
  }

  /**
   * POST /api/operators
   * Create a new operator user
   */
  private async createOperator(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.OPERATOR_WRITE]);
    const body = createOperatorSchema.parse(req.body);
    const operator = await this.operatorService.createOperator(body, req.context);
    res.status(201).json(operator);
  }

  /**
   * GET /api/operators/:id
   * Get an operator user by ID
   */
  private async getOperatorById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.OPERATOR_READ]);
    const params = operatorRouteParamsSchema.parse(req.params);
    const operator = await this.operatorService.getOperatorById(params.id);
    res.status(200).json(operator);
  }

  /**
   * GET /api/operators
   * List operator users with optional filters
   */
  private async listOperators(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.OPERATOR_READ]);
    const query = listParamsSchema.parse(req.query);
    const operators = await this.operatorService.listOperators(query);
    res.status(200).json(operators);
  }

  /**
   * PUT /api/operators/:id
   * Update an operator user
   */
  private async updateOperator(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.OPERATOR_WRITE]);
    const params = operatorRouteParamsSchema.parse(req.params);
    const body = updateOperatorBodySchema.parse(req.body);
    const operator = await this.operatorService.updateOperator(params.id, body, req.context);
    res.status(200).json(operator);
  }

  /**
   * DELETE /api/operators/:id
   * Delete an operator user
   */
  private async deleteOperator(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.OPERATOR_DELETE]);
    const params = operatorRouteParamsSchema.parse(req.params);
    const body = deleteOperatorBodySchema.parse(req.body);
    await this.operatorService.deleteOperator(params.id, body.version, req.context);
    res.status(204).send();
  }

  /**
   * GET /api/operators/:id/audit-logs
   * Get audit logs for an operator user
   */
  private async getOperatorAuditLogs(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.AUDIT_READ]);
    const params = operatorRouteParamsSchema.parse(req.params);
    const logs = await this.operatorService.getOperatorAuditLogs(params.id);
    res.status(200).json(logs);
  }

  /**
   * GET /api/profile
   * Get the profile of the currently logged-in operator user
   */
  private async getProfile(req: Request, res: Response): Promise<void> {
    const profile = await this.operatorService.getProfile(req.context);
    res.status(200).json(profile);
  }

  /**
   * POST /api/profile
   * Update the profile of the currently logged-in operator user
   */
  private async updateProfile(req: Request, res: Response): Promise<void> {
    const body = updateProfileSchema.parse(req.body);
    const profile = await this.operatorService.updateProfile(body, req.context);
    res.status(200).json(profile);
  }
}
