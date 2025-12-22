import 'reflect-metadata';
import { JsonController, Get, Post, Put, Delete, Param, Body, QueryParams, HttpCode, Req } from 'routing-controllers';
import { injectable, inject } from 'tsyringe';
import { Validated } from '../decorators/validation';
import { OpenAPI } from '../decorators/openapi';
import { RequirePermissions } from '../decorators/auth';
import { PERMISSIONS } from '../permissions';
import type { Request } from 'express';
import { EnvironmentService } from '../services/EnvironmentService';
import { createEnvironmentSchema, updateEnvironmentBodySchema, deleteEnvironmentBodySchema, environmentResponseSchema, environmentListResponseSchema } from '../api/environment';
import type { CreateEnvironmentRequest, UpdateEnvironmentRequest, DeleteEnvironmentRequest } from '../api/environment';
import { listParamsSchema } from '../api/common';
import type { ListParams } from '../api/common';

/**
 * Controller for environment management with decorator-based routing
 * Manages environments which are used for data migration between server instances
 */
@injectable()
@JsonController('/api/environments')
export class EnvironmentController {
  constructor(@inject(EnvironmentService) private readonly environmentService: EnvironmentService) {}

  /**
   * POST /api/environments
   * Create a new environment
   */
  @RequirePermissions([PERMISSIONS.ENVIRONMENT_WRITE])
  @OpenAPI({
    tags: ['Environments'],
    summary: 'Create a new environment',
    description: 'Creates a new environment configuration for data migration between server instances',
    request: {
      body: {
        content: {
          'application/json': {
            schema: createEnvironmentSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Environment created successfully',
        content: {
          'application/json': {
            schema: environmentResponseSchema,
          },
        },
      },
      400: { description: 'Invalid request body' },
      409: { description: 'Environment already exists' },
    },
  })
  @Post('/')
  @HttpCode(201)
  async createEnvironment(@Validated(createEnvironmentSchema) @Body() body: CreateEnvironmentRequest, @Req() req: Request) {
    const environment = await this.environmentService.createEnvironment(body, req.context);
    return environment;
  }

  /**
   * GET /api/environments/:id
   * Get an environment by ID
   */
  @RequirePermissions([PERMISSIONS.ENVIRONMENT_READ])
  @OpenAPI({
    tags: ['Environments'],
    summary: 'Get environment by ID',
    description: 'Retrieves a single environment by its unique identifier (password excluded)',
    responses: {
      200: {
        description: 'Environment retrieved successfully',
        content: {
          'application/json': {
            schema: environmentResponseSchema,
          },
        },
      },
      404: { description: 'Environment not found' },
    },
  })
  @Get('/:id')
  async getEnvironmentById(@Param('id') id: string) {
    const environment = await this.environmentService.getEnvironmentById(id);
    return environment;
  }

  /**
   * GET /api/environments
   * List environments with optional filters
   */
  @RequirePermissions([PERMISSIONS.ENVIRONMENT_READ])
  @OpenAPI({
    tags: ['Environments'],
    summary: 'List environments',
    description: 'Retrieves a paginated list of environments with optional filtering and sorting (passwords excluded)',
    request: {
      query: listParamsSchema,
    },
    responses: {
      200: {
        description: 'List of environments retrieved successfully',
        content: {
          'application/json': {
            schema: environmentListResponseSchema,
          },
        },
      },
      400: { description: 'Invalid query parameters' },
    },
  })
  @Get('/')
  async listEnvironments(@Validated(listParamsSchema, 'query') @QueryParams() query: ListParams) {
    return await this.environmentService.listEnvironments(query);
  }

  /**
   * PUT /api/environments/:id
   * Update an environment
   */
  @RequirePermissions([PERMISSIONS.ENVIRONMENT_WRITE])
  @OpenAPI({
    tags: ['Environments'],
    summary: 'Update environment',
    description: 'Updates an existing environment with optimistic locking',
    request: {
      body: {
        content: {
          'application/json': {
            schema: updateEnvironmentBodySchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Environment updated successfully',
        content: {
          'application/json': {
            schema: environmentResponseSchema,
          },
        },
      },
      400: { description: 'Invalid request body' },
      404: { description: 'Environment not found' },
      409: { description: 'Version conflict - entity was modified' },
    },
  })
  @Put('/:id')
  async updateEnvironment(@Param('id') id: string, @Validated(updateEnvironmentBodySchema) @Body() body: UpdateEnvironmentRequest, @Req() req: Request) {
    const { version, ...updateData } = body;
    const environment = await this.environmentService.updateEnvironment(id, updateData, version, req.context);
    return environment;
  }

  /**
   * DELETE /api/environments/:id
   * Delete an environment
   */
  @RequirePermissions([PERMISSIONS.ENVIRONMENT_DELETE])
  @OpenAPI({
    tags: ['Environments'],
    summary: 'Delete environment',
    description: 'Deletes an environment with optimistic locking',
    request: {
      body: {
        content: {
          'application/json': {
            schema: deleteEnvironmentBodySchema,
          },
        },
      },
    },
    responses: {
      204: { description: 'Environment deleted successfully' },
      400: { description: 'Invalid request body' },
      404: { description: 'Environment not found' },
      409: { description: 'Version conflict - entity was modified' },
    },
  })
  @Delete('/:id')
  @HttpCode(204)
  async deleteEnvironment(@Param('id') id: string, @Validated(deleteEnvironmentBodySchema) @Body() body: DeleteEnvironmentRequest, @Req() req: Request) {
    await this.environmentService.deleteEnvironment(id, body.version, req.context);
  }

  /**
   * GET /api/environments/:id/audit-logs
   * Get audit logs for an environment
   */
  @RequirePermissions([PERMISSIONS.AUDIT_READ])
  @OpenAPI({
    tags: ['Environments'],
    summary: 'Get environment audit logs',
    description: 'Retrieves audit logs for a specific environment',
    responses: {
      200: {
        description: 'Audit logs retrieved successfully',
      },
      404: { description: 'Environment not found' },
    },
  })
  @Get('/:id/audit-logs')
  async getEnvironmentAuditLogs(@Param('id') id: string) {
    return await this.environmentService.getEnvironmentAuditLogs(id);
  }
}
