import 'reflect-metadata';
import { JsonController, Get, Post, Put, Delete, Param, Body, QueryParams, HttpCode, Req } from 'routing-controllers';
import { injectable, inject } from 'tsyringe';
import { Validated } from '../decorators/validation';
import { OpenAPI } from '../decorators/openapi';
import { RequirePermissions } from '../decorators/auth';
import { PERMISSIONS } from '../config/permissions';
import type { Request } from 'express';
import { AdminService } from '../services/AdminService';
import { createAdminSchema, updateAdminBodySchema, deleteAdminBodySchema, adminResponseSchema, adminListResponseSchema } from '../api/admin';
import type { CreateAdminRequest, UpdateAdminRequest, DeleteAdminRequest } from '../api/admin';
import { listParamsSchema } from '../api/common';
import type { ListParams } from '../api/common';

/**
 * Controller for admin user management with decorator-based routing
 */
@injectable()
@JsonController('/api/admins')
export class AdminController {
  constructor(@inject(AdminService) private readonly adminService: AdminService) {}

  /**
   * POST /api/admins
   * Create a new admin user
   */
  @OpenAPI({
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
  })
  @RequirePermissions([PERMISSIONS.ADMIN_WRITE])
  @Post('/')
  @HttpCode(201)
  async createAdmin(@Validated(createAdminSchema) @Body() body: CreateAdminRequest, @Req() req: Request) {
    const admin = await this.adminService.createAdmin(body, req.context);
    return admin;
  }

  /**
   * GET /api/admins/:id
   * Get an admin user by ID
   */
  @OpenAPI({
    tags: ['Admins'],
    summary: 'Get admin user by ID',
    description: 'Retrieves a single admin user by their unique identifier',
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
  })
  @RequirePermissions([PERMISSIONS.ADMIN_READ])
  @Get('/:id')
  async getAdminById(@Param('id') id: string) {
    const admin = await this.adminService.getAdminById(id);
    return admin;
  }

  /**
   * GET /api/admins
   * List admin users with optional filters
   */
  @OpenAPI({
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
  })
  @RequirePermissions([PERMISSIONS.ADMIN_READ])
  @Get('/')
  async listAdmins(@Validated(listParamsSchema, 'query') @QueryParams() query: ListParams) {
    return await this.adminService.listAdmins(query);
  }

  /**
   * PUT /api/admins/:id
   * Update an admin user
   */
  @OpenAPI({
    tags: ['Admins'],
    summary: 'Update admin user',
    description: 'Updates an existing admin user with optimistic locking',
    request: {
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
  })
  @RequirePermissions([PERMISSIONS.ADMIN_WRITE])
  @Put('/:id')
  async updateAdmin(@Param('id') id: string, @Validated(updateAdminBodySchema) @Body() body: UpdateAdminRequest, @Req() req: Request) {
    const { version, ...updateData } = body;
    const admin = await this.adminService.updateAdmin(id, updateData, version, req.context);
    return admin;
  }

  /**
   * DELETE /api/admins/:id
   * Delete an admin user
   */
  @OpenAPI({
    tags: ['Admins'],
    summary: 'Delete admin user',
    description: 'Deletes an admin user with optimistic locking',
    request: {
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
  })
  @RequirePermissions([PERMISSIONS.ADMIN_DELETE])
  @Delete('/:id')
  @HttpCode(204)
  async deleteAdmin(@Param('id') id: string, @Validated(deleteAdminBodySchema) @Body() body: DeleteAdminRequest, @Req() req: Request) {
    const { version } = body;
    await this.adminService.deleteAdmin(id, version, req.context);
  }

  /**
   * GET /api/admins/:id/audit-logs
   * Get audit logs for an admin user
   */
  @OpenAPI({
    tags: ['Admins'],
    summary: 'Get admin audit logs',
    description: 'Retrieves audit logs for a specific admin user',
    responses: {
      200: {
        description: 'Audit logs retrieved successfully',
      },
      404: { description: 'Admin user not found' },
    },
  })
  @RequirePermissions([PERMISSIONS.AUDIT_READ])
  @Get('/:id/audit-logs')
  async getAdminAuditLogs(@Param('id') id: string) {
    return await this.adminService.getAdminAuditLogs(id);
  }
}
