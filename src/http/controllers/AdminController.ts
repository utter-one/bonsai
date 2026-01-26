import { inject, singleton } from 'tsyringe';
import type { Request, Response, NextFunction, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { AdminService } from '../../services/AdminService';
import { createAdminSchema, updateAdminBodySchema, deleteAdminBodySchema, adminResponseSchema, adminListResponseSchema, adminRouteParamsSchema } from '../contracts/admin';
import type { UpdateAdminRequest } from '../contracts/admin';
import { listParamsSchema } from '../contracts/common';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for admin user management with explicit routing
 */
@singleton()
export class AdminController {
  constructor(@inject(AdminService) private readonly adminService: AdminService) {}

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/admins',
        tags: ['Admins'],
        summary: 'Create a new admin user',
        description: 'Creates a new admin user with the specified credentials and roles',
        request: {
          body: {
            content: {
              'application/json': {
                schema: createAdminSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Admin user created successfully',
            content: {
              'application/json': {
                schema: adminResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          409: { description: 'Admin user already exists' },
        },
      },
      {
        method: 'get',
        path: '/api/admins/{id}',
        tags: ['Admins'],
        summary: 'Get admin user by ID',
        description: 'Retrieves a single admin user by their unique identifier',
        request: {
          params: adminRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Admin user retrieved successfully',
            content: {
              'application/json': {
                schema: adminResponseSchema,
              },
            },
          },
          404: { description: 'Admin user not found' },
        },
      },
      {
        method: 'get',
        path: '/api/admins',
        tags: ['Admins'],
        summary: 'List admin users',
        description: 'Retrieves a paginated list of admin users with optional filtering',
        request: {
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'List of admin users retrieved successfully',
            content: {
              'application/json': {
                schema: adminListResponseSchema,
              },
            },
          },
          400: { description: 'Invalid query parameters' },
        },
      },
      {
        method: 'put',
        path: '/api/admins/{id}',
        tags: ['Admins'],
        summary: 'Update admin user',
        description: 'Updates an existing admin user with optimistic locking',
        request: {
          params: adminRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: updateAdminBodySchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Admin user updated successfully',
            content: {
              'application/json': {
                schema: adminResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Admin user not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'delete',
        path: '/api/admins/{id}',
        tags: ['Admins'],
        summary: 'Delete admin user',
        description: 'Deletes an admin user with optimistic locking',
        request: {
          params: adminRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: deleteAdminBodySchema,
              },
            },
          },
        },
        responses: {
          204: { description: 'Admin user deleted successfully' },
          400: { description: 'Invalid request body' },
          404: { description: 'Admin user not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'get',
        path: '/api/admins/{id}/audit-logs',
        tags: ['Admins'],
        summary: 'Get admin audit logs',
        description: 'Retrieves audit logs for a specific admin user',
        request: {
          params: adminRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Audit logs retrieved successfully',
          },
          404: { description: 'Admin user not found' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    router.post('/api/admins', asyncHandler(this.createAdmin.bind(this)));
    router.get('/api/admins/:id', asyncHandler(this.getAdminById.bind(this)));
    router.get('/api/admins', asyncHandler(this.listAdmins.bind(this)));
    router.put('/api/admins/:id', asyncHandler(this.updateAdmin.bind(this)));
    router.delete('/api/admins/:id', asyncHandler(this.deleteAdmin.bind(this)));
    router.get('/api/admins/:id/audit-logs', asyncHandler(this.getAdminAuditLogs.bind(this)));
  }

  /**
   * POST /api/admins
   * Create a new admin user
   */
  private async createAdmin(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ADMIN_WRITE]);
    const body = createAdminSchema.parse(req.body);
    const admin = await this.adminService.createAdmin(body, req.context);
    res.status(201).json(admin);
  }

  /**
   * GET /api/admins/:id
   * Get an admin user by ID
   */
  private async getAdminById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ADMIN_READ]);
    const params = adminRouteParamsSchema.parse(req.params);
    const admin = await this.adminService.getAdminById(params.id);
    res.status(200).json(admin);
  }

  /**
   * GET /api/admins
   * List admin users with optional filters
   */
  private async listAdmins(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ADMIN_READ]);
    const query = listParamsSchema.parse(req.query);
    const admins = await this.adminService.listAdmins(query);
    res.status(200).json(admins);
  }

  /**
   * PUT /api/admins/:id
   * Update an admin user
   */
  private async updateAdmin(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ADMIN_WRITE]);
    const params = adminRouteParamsSchema.parse(req.params);
    const body = updateAdminBodySchema.parse(req.body);
    const { version, ...updateData } = body;
    const admin = await this.adminService.updateAdmin(params.id, updateData, version, req.context);
    res.status(200).json(admin);
  }

  /**
   * DELETE /api/admins/:id
   * Delete an admin user
   */
  private async deleteAdmin(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.ADMIN_DELETE]);
    const params = adminRouteParamsSchema.parse(req.params);
    const body = deleteAdminBodySchema.parse(req.body);
    await this.adminService.deleteAdmin(params.id, body.version, req.context);
    res.status(204).send();
  }

  /**
   * GET /api/admins/:id/audit-logs
   * Get audit logs for an admin user
   */
  private async getAdminAuditLogs(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.AUDIT_READ]);
    const params = adminRouteParamsSchema.parse(req.params);
    const logs = await this.adminService.getAdminAuditLogs(params.id);
    res.status(200).json(logs);
  }
}
