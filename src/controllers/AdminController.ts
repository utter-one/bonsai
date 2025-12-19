import 'reflect-metadata';
import { JsonController, Get, Post, Put, Delete, Param, Body, QueryParams, HttpCode, Req } from 'routing-controllers';
import { injectable, inject } from 'tsyringe';
import type { Request } from 'express';
import { AdminService } from '../services/AdminService';
import { createAdminSchema, updateAdminBodySchema, deleteAdminBodySchema, listParamsSchema } from '../api/admin';
import type { CreateAdminRequest, UpdateAdminRequest, DeleteAdminRequest } from '../api/admin';
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
  @Post('/')
  @HttpCode(201)
  async createAdmin(@Body() body: CreateAdminRequest, @Req() req: Request) {
    const validatedData = createAdminSchema.parse(body);
    const admin = await this.adminService.createAdmin(validatedData, req.context?.userId);
    return admin;
  }

  /**
   * GET /api/admins/:id
   * Get an admin user by ID
   */
  @Get('/:id')
  async getAdminById(@Param('id') id: string) {
    const admin = await this.adminService.getAdminById(id);
    return admin;
  }

  /**
   * GET /api/admins
   * List admin users with optional filters
   */
  @Get('/')
  async listAdmins(@QueryParams() query: ListParams) {
    const params = listParamsSchema.parse(query);
    return await this.adminService.listAdmins(params);
  }

  /**
   * PUT /api/admins/:id
   * Update an admin user
   */
  @Put('/:id')
  async updateAdmin(@Param('id') id: string, @Body() body: UpdateAdminRequest, @Req() req: Request) {
    const validated = updateAdminBodySchema.parse(body);
    const { version, ...updateData } = validated;
    const admin = await this.adminService.updateAdmin(id, updateData, version, req.context?.userId);
    return admin;
  }

  /**
   * DELETE /api/admins/:id
   * Delete an admin user
   */
  @Delete('/:id')
  @HttpCode(204)
  async deleteAdmin(@Param('id') id: string, @Body() body: DeleteAdminRequest, @Req() req: Request) {
    const { version } = deleteAdminBodySchema.parse(body);
    await this.adminService.deleteAdmin(id, version, req.context?.userId);
  }

  /**
   * GET /api/admins/:id/audit-logs
   * Get audit logs for an admin user
   */
  @Get('/:id/audit-logs')
  async getAdminAuditLogs(@Param('id') id: string) {
    return await this.adminService.getAdminAuditLogs(id);
  }
}
