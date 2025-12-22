import 'reflect-metadata';
import { JsonController, Get, Post, Put, Delete, Param, Body, QueryParams, HttpCode, Req } from 'routing-controllers';
import { injectable, inject } from 'tsyringe';
import { Validated } from '../decorators/validation';
import { OpenAPI } from '../decorators/openapi';
import { RequirePermissions } from '../decorators/auth';
import { PERMISSIONS } from '../permissions';
import type { Request } from 'express';
import { GlobalActionService } from '../services/GlobalActionService';
import { createGlobalActionSchema, updateGlobalActionBodySchema, deleteGlobalActionBodySchema, globalActionResponseSchema, globalActionListResponseSchema } from '../api/globalAction';
import type { CreateGlobalActionRequest, UpdateGlobalActionRequest, DeleteGlobalActionRequest } from '../api/globalAction';
import { listParamsSchema } from '../api/common';
import type { ListParams } from '../api/common';

/**
 * Controller for global action management with decorator-based routing
 * Manages global actions which are user actions that can be triggered at any point during a conversation
 */
@injectable()
@JsonController('/api/global-actions')
export class GlobalActionController {
  constructor(@inject(GlobalActionService) private readonly globalActionService: GlobalActionService) {}

  /**
   * POST /api/global-actions
   * Create a new global action
   */
  @RequirePermissions([PERMISSIONS.GLOBAL_ACTION_WRITE])
  @OpenAPI({
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
  })
  @Post('/')
  @HttpCode(201)
  async createGlobalAction(@Validated(createGlobalActionSchema) @Body() body: CreateGlobalActionRequest, @Req() req: Request) {
    const globalAction = await this.globalActionService.createGlobalAction(body, req.context);
    return globalAction;
  }

  /**
   * GET /api/global-actions/:id
   * Get a global action by ID
   */
  @RequirePermissions([PERMISSIONS.GLOBAL_ACTION_READ])
  @OpenAPI({
    tags: ['Global Actions'],
    summary: 'Get global action by ID',
    description: 'Retrieves a single global action by its unique identifier',
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
  })
  @Get('/:id')
  async getGlobalActionById(@Param('id') id: string) {
    const globalAction = await this.globalActionService.getGlobalActionById(id);
    return globalAction;
  }

  /**
   * GET /api/global-actions
   * List global actions with optional filters
   */
  @RequirePermissions([PERMISSIONS.GLOBAL_ACTION_READ])
  @OpenAPI({
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
  })
  @Get('/')
  async listGlobalActions(@Validated(listParamsSchema, 'query') @QueryParams() query: ListParams) {
    return await this.globalActionService.listGlobalActions(query);
  }

  /**
   * PUT /api/global-actions/:id
   * Update a global action
   */
  @RequirePermissions([PERMISSIONS.GLOBAL_ACTION_WRITE])
  @OpenAPI({
    tags: ['Global Actions'],
    summary: 'Update global action',
    description: 'Updates an existing global action with optimistic locking',
    request: {
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
  })
  @Put('/:id')
  async updateGlobalAction(@Param('id') id: string, @Validated(updateGlobalActionBodySchema) @Body() body: UpdateGlobalActionRequest, @Req() req: Request) {
    const { version, ...updateData } = body;
    const globalAction = await this.globalActionService.updateGlobalAction(id, updateData, version, req.context);
    return globalAction;
  }

  /**
   * DELETE /api/global-actions/:id
   * Delete a global action
   */
  @RequirePermissions([PERMISSIONS.GLOBAL_ACTION_DELETE])
  @OpenAPI({
    tags: ['Global Actions'],
    summary: 'Delete global action',
    description: 'Deletes a global action with optimistic locking',
    request: {
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
  })
  @Delete('/:id')
  @HttpCode(204)
  async deleteGlobalAction(@Param('id') id: string, @Validated(deleteGlobalActionBodySchema) @Body() body: DeleteGlobalActionRequest, @Req() req: Request) {
    await this.globalActionService.deleteGlobalAction(id, body.version, req.context);
  }

  /**
   * GET /api/global-actions/:id/audit-logs
   * Get audit logs for a global action
   */
  @RequirePermissions([PERMISSIONS.AUDIT_READ])
  @OpenAPI({
    tags: ['Global Actions'],
    summary: 'Get global action audit logs',
    description: 'Retrieves audit logs for a specific global action',
    responses: {
      200: {
        description: 'Audit logs retrieved successfully',
      },
      404: { description: 'Global action not found' },
    },
  })
  @Get('/:id/audit-logs')
  async getGlobalActionAuditLogs(@Param('id') id: string) {
    return await this.globalActionService.getGlobalActionAuditLogs(id);
  }
}
