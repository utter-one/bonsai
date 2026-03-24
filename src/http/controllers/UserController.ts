import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { UserService } from '../../services/UserService';
import { createUserSchema, updateUserBodySchema, userResponseSchema, userListResponseSchema, userRouteParamsSchema, userProjectRouteParamsSchema } from '../contracts/user';
import { listParamsSchema } from '../contracts/common';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for user management with explicit routing
 */
@singleton()
export class UserController {
  constructor(@inject(UserService) private readonly userService: UserService) { }

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/projects/{projectId}/users',
        tags: ['Users'],
        summary: 'Create a new user',
        description: 'Creates a new user within the specified project',
        request: {
          params: userProjectRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: createUserSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'User created successfully',
            content: {
              'application/json': {
                schema: userResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Project not found' },
          409: { description: 'User already exists' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/users/{id}',
        tags: ['Users'],
        summary: 'Get user by ID',
        description: 'Retrieves a single user by their unique identifier within a project',
        request: {
          params: userRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'User retrieved successfully',
            content: {
              'application/json': {
                schema: userResponseSchema,
              },
            },
          },
          404: { description: 'User not found' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/users',
        tags: ['Users'],
        summary: 'List users',
        description: 'Retrieves a paginated list of users within a project with optional filtering',
        request: {
          params: userProjectRouteParamsSchema,
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'List of users retrieved successfully',
            content: {
              'application/json': {
                schema: userListResponseSchema,
              },
            },
          },
          400: { description: 'Invalid query parameters' },
        },
      },
      {
        method: 'put',
        path: '/api/projects/{projectId}/users/{id}',
        tags: ['Users'],
        summary: 'Update user',
        description: 'Updates an existing user within a project',
        request: {
          params: userRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: updateUserBodySchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'User updated successfully',
            content: {
              'application/json': {
                schema: userResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'User not found' },
        },
      },
      {
        method: 'delete',
        path: '/api/projects/{projectId}/users/{id}',
        tags: ['Users'],
        summary: 'Delete user',
        description: 'Deletes a user from a project',
        request: {
          params: userRouteParamsSchema,
        },
        responses: {
          204: { description: 'User deleted successfully' },
          404: { description: 'User not found' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/users/{id}/audit-logs',
        tags: ['Users'],
        summary: 'Get user audit logs',
        description: 'Retrieves audit logs for a specific user within a project',
        request: {
          params: userRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Audit logs retrieved successfully',
          },
          404: { description: 'User not found' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    router.post('/api/projects/:projectId/users', asyncHandler(this.createUser.bind(this)));
    router.get('/api/projects/:projectId/users/:id', asyncHandler(this.getUserById.bind(this)));
    router.get('/api/projects/:projectId/users', asyncHandler(this.listUsers.bind(this)));
    router.put('/api/projects/:projectId/users/:id', asyncHandler(this.updateUser.bind(this)));
    router.delete('/api/projects/:projectId/users/:id', asyncHandler(this.deleteUser.bind(this)));
    router.get('/api/projects/:projectId/users/:id/audit-logs', asyncHandler(this.getUserAuditLogs.bind(this)));
  }

  /**
   * POST /api/projects/:projectId/users
   * Create a new user
   */
  private async createUser(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.USER_WRITE]);
    const { projectId } = userProjectRouteParamsSchema.parse(req.params);
    const body = createUserSchema.parse(req.body);
    const user = await this.userService.createUser(projectId, body, req.context);
    res.status(201).json(user);
  }

  /**
   * GET /api/projects/:projectId/users/:id
   * Get a user by ID
   */
  private async getUserById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.USER_READ]);
    const params = userRouteParamsSchema.parse(req.params);
    const user = await this.userService.getUserById(params.projectId, params.id);
    res.status(200).json(user);
  }

  /**
   * GET /api/projects/:projectId/users
   * List users with optional filters
   */
  private async listUsers(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.USER_READ]);
    const { projectId } = userProjectRouteParamsSchema.parse(req.params);
    const query = listParamsSchema.parse(req.query);
    const users = await this.userService.listUsers(projectId, query);
    res.status(200).json(users);
  }

  /**
   * PUT /api/projects/:projectId/users/:id
   * Update a user
   */
  private async updateUser(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.USER_WRITE]);
    const params = userRouteParamsSchema.parse(req.params);
    const body = updateUserBodySchema.parse(req.body);
    const user = await this.userService.updateUser(params.projectId, params.id, body, req.context);
    res.status(200).json(user);
  }

  /**
   * DELETE /api/projects/:projectId/users/:id
   * Delete a user
   */
  private async deleteUser(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.USER_DELETE]);
    const params = userRouteParamsSchema.parse(req.params);
    await this.userService.deleteUser(params.projectId, params.id, req.context);
    res.status(204).send();
  }

  /**
   * GET /api/projects/:projectId/users/:id/audit-logs
   * Get audit logs for a user
   */
  private async getUserAuditLogs(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.AUDIT_READ]);
    const params = userRouteParamsSchema.parse(req.params);
    const logs = await this.userService.getUserAuditLogs(params.id, params.projectId);
    res.status(200).json(logs);
  }
}
