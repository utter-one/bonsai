import 'reflect-metadata';
import { JsonController, Get, Post, Put, Delete, Param, Body, QueryParams, HttpCode, Req } from 'routing-controllers';
import { injectable, inject } from 'tsyringe';
import { Validated } from '../decorators/validation';
import type { Request } from 'express';
import { UserService } from '../services/UserService';
import { createUserSchema, updateUserBodySchema } from '../api/user';
import type { CreateUserRequest, UpdateUserRequest } from '../api/user';
import { listParamsSchema } from '../api/common';
import type { ListParams } from '../api/common';

/**
 * Controller for user management with decorator-based routing
 */
@injectable()
@JsonController('/api/users')
export class UserController {
  constructor(@inject(UserService) private readonly userService: UserService) {}

  /**
   * POST /api/users
   * Create a new user
   */
  @Post('/')
  @HttpCode(201)
  async createUser(@Validated(createUserSchema) @Body() body: CreateUserRequest, @Req() req: Request) {
    const user = await this.userService.createUser(body, req.context?.userId);
    return user;
  }

  /**
   * GET /api/users/:id
   * Get a user by ID
   */
  @Get('/:id')
  async getUserById(@Param('id') id: string) {
    const user = await this.userService.getUserById(id);
    return user;
  }

  /**
   * GET /api/users
   * List users with optional filters
   */
  @Get('/')
  async listUsers(@Validated(listParamsSchema, 'query') @QueryParams() query: ListParams) {
    return await this.userService.listUsers(query);
  }

  /**
   * PUT /api/users/:id
   * Update a user
   */
  @Put('/:id')
  async updateUser(@Param('id') id: string, @Validated(updateUserBodySchema) @Body() body: UpdateUserRequest, @Req() req: Request) {
    const user = await this.userService.updateUser(id, body, req.context?.userId);
    return user;
  }

  /**
   * DELETE /api/users/:id
   * Delete a user
   */
  @Delete('/:id')
  @HttpCode(204)
  async deleteUser(@Param('id') id: string, @Req() req: Request) {
    await this.userService.deleteUser(id, req.context?.userId);
  }

  /**
   * GET /api/users/:id/audit-logs
   * Get audit logs for a user
   */
  @Get('/:id/audit-logs')
  async getUserAuditLogs(@Param('id') id: string) {
    return await this.userService.getUserAuditLogs(id);
  }
}
