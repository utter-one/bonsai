import 'reflect-metadata';
import { JsonController, Get, Post, Put, Delete, Param, Body, QueryParams, HttpCode, Req } from 'routing-controllers';
import { injectable, inject } from 'tsyringe';
import { Validated } from '../decorators/validation';
import { OpenAPI } from '../decorators/openapi';
import type { Request } from 'express';
import { UserService } from '../services/UserService';
import { createUserSchema, updateUserBodySchema, userResponseSchema, userListResponseSchema } from '../api/user';
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
  @OpenAPI({
    tags: ['Users'],
    summary: 'Create a new user',
    description: 'Creates a new user with the specified profile data',
    request: {
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
      409: { description: 'User already exists' },
    },
  })
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
  @OpenAPI({
    tags: ['Users'],
    summary: 'Get user by ID',
    description: 'Retrieves a single user by their unique identifier',
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
  })
  @Get('/:id')
  async getUserById(@Param('id') id: string) {
    const user = await this.userService.getUserById(id);
    return user;
  }

  /**
   * GET /api/users
   * List users with optional filters
   */
  @OpenAPI({
    tags: ['Users'],
    summary: 'List users',
    description: 'Retrieves a paginated list of users with optional filtering',
    request: {
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
  })
  @Get('/')
  async listUsers(@Validated(listParamsSchema, 'query') @QueryParams() query: ListParams) {
    return await this.userService.listUsers(query);
  }

  /**
   * PUT /api/users/:id
   * Update a user
   */
  @OpenAPI({
    tags: ['Users'],
    summary: 'Update user',
    description: 'Updates an existing user',
    request: {
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
  })
  @Put('/:id')
  async updateUser(@Param('id') id: string, @Validated(updateUserBodySchema) @Body() body: UpdateUserRequest, @Req() req: Request) {
    const user = await this.userService.updateUser(id, body, req.context?.userId);
    return user;
  }

  /**
   * DELETE /api/users/:id
   * Delete a user
   */
  @OpenAPI({
    tags: ['Users'],
    summary: 'Delete user',
    description: 'Deletes a user',
    responses: {
      204: { description: 'User deleted successfully' },
      404: { description: 'User not found' },
    },
  })
  @Delete('/:id')
  @HttpCode(204)
  async deleteUser(@Param('id') id: string, @Req() req: Request) {
    await this.userService.deleteUser(id, req.context?.userId);
  }

  /**
   * GET /api/users/:id/audit-logs
   * Get audit logs for a user
   */
  @OpenAPI({
    tags: ['Users'],
    summary: 'Get user audit logs',
    description: 'Retrieves audit logs for a specific user',
    responses: {
      200: {
        description: 'Audit logs retrieved successfully',
      },
      404: { description: 'User not found' },
    },
  })
  @Get('/:id/audit-logs')
  async getUserAuditLogs(@Param('id') id: string) {
    return await this.userService.getUserAuditLogs(id);
  }
}
