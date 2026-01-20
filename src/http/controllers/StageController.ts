import 'reflect-metadata';
import { JsonController, Get, Post, Put, Delete, Param, Body, QueryParams, HttpCode, Req } from 'routing-controllers';
import { injectable, inject } from 'tsyringe';
import { Validated } from '../decorators/validation';
import { OpenAPI } from '../decorators/openapi';
import { RequirePermissions } from '../decorators/auth';
import { PERMISSIONS } from '../../permissions';
import type { Request } from 'express';
import { StageService } from '../../services/StageService';
import { createStageSchema, updateStageBodySchema, deleteStageBodySchema, stageResponseSchema, stageListResponseSchema } from '../contracts/stage';
import type { CreateStageRequest, UpdateStageRequest, DeleteStageRequest } from '../contracts/stage';
import { listParamsSchema } from '../contracts/common';
import type { ListParams } from '../contracts/common';

/**
 * Controller for stage management with decorator-based routing
 * Manages stages which define behavior, prompts, and actions for different conversation phases
 */
@injectable()
@JsonController('/api/stages')
export class StageController {
  constructor(@inject(StageService) private readonly stageService: StageService) {}

  /**
   * POST /api/stages
   * Create a new stage
   */
  @RequirePermissions([PERMISSIONS.STAGE_WRITE])
  @OpenAPI({
    tags: ['Stages'],
    summary: 'Create a new stage',
    description: 'Creates a new stage with specified behavior, prompts, and configuration',
    request: {
      body: {
        content: {
          'application/json': {
            schema: createStageSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Stage created successfully',
        content: {
          'application/json': {
            schema: stageResponseSchema,
          },
        },
      },
      400: { description: 'Invalid request body' },
      409: { description: 'Stage already exists' },
    },
  })
  @Post('/')
  @HttpCode(201)
  async createStage(@Validated(createStageSchema) @Body() body: CreateStageRequest, @Req() req: Request) {
    const stage = await this.stageService.createStage(body, req.context);
    return stage;
  }

  /**
   * GET /api/stages/:id
   * Get a stage by ID
   */
  @RequirePermissions([PERMISSIONS.STAGE_READ])
  @OpenAPI({
    tags: ['Stages'],
    summary: 'Get stage by ID',
    description: 'Retrieves a single stage by its unique identifier',
    responses: {
      200: {
        description: 'Stage retrieved successfully',
        content: {
          'application/json': {
            schema: stageResponseSchema,
          },
        },
      },
      404: { description: 'Stage not found' },
    },
  })
  @Get('/:id')
  async getStageById(@Param('id') id: string) {
    const stage = await this.stageService.getStageById(id);
    return stage;
  }

  /**
   * GET /api/stages
   * List stages with optional filters
   */
  @RequirePermissions([PERMISSIONS.STAGE_READ])
  @OpenAPI({
    tags: ['Stages'],
    summary: 'List stages',
    description: 'Retrieves a paginated list of stages with optional filtering and sorting',
    request: {
      query: listParamsSchema,
    },
    responses: {
      200: {
        description: 'List of stages retrieved successfully',
        content: {
          'application/json': {
            schema: stageListResponseSchema,
          },
        },
      },
      400: { description: 'Invalid query parameters' },
    },
  })
  @Get('/')
  async listStages(@Validated(listParamsSchema, 'query') @QueryParams() query: ListParams) {
    return await this.stageService.listStages(query);
  }

  /**
   * PUT /api/stages/:id
   * Update a stage
   */
  @RequirePermissions([PERMISSIONS.STAGE_WRITE])
  @OpenAPI({
    tags: ['Stages'],
    summary: 'Update stage',
    description: 'Updates an existing stage with optimistic locking',
    request: {
      body: {
        content: {
          'application/json': {
            schema: updateStageBodySchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Stage updated successfully',
        content: {
          'application/json': {
            schema: stageResponseSchema,
          },
        },
      },
      400: { description: 'Invalid request body' },
      404: { description: 'Stage not found' },
      409: { description: 'Version conflict - entity was modified' },
    },
  })
  @Put('/:id')
  async updateStage(@Param('id') id: string, @Validated(updateStageBodySchema) @Body() body: UpdateStageRequest, @Req() req: Request) {
    const { version, ...updateData } = body;
    const stage = await this.stageService.updateStage(id, updateData, version, req.context);
    return stage;
  }

  /**
   * DELETE /api/stages/:id
   * Delete a stage
   */
  @RequirePermissions([PERMISSIONS.STAGE_DELETE])
  @OpenAPI({
    tags: ['Stages'],
    summary: 'Delete stage',
    description: 'Deletes a stage with optimistic locking',
    request: {
      body: {
        content: {
          'application/json': {
            schema: deleteStageBodySchema,
          },
        },
      },
    },
    responses: {
      204: { description: 'Stage deleted successfully' },
      400: { description: 'Invalid request body' },
      404: { description: 'Stage not found' },
      409: { description: 'Version conflict - entity was modified' },
    },
  })
  @Delete('/:id')
  @HttpCode(204)
  async deleteStage(@Param('id') id: string, @Validated(deleteStageBodySchema) @Body() body: DeleteStageRequest, @Req() req: Request) {
    await this.stageService.deleteStage(id, body.version, req.context);
  }

  /**
   * GET /api/stages/:id/audit-logs
   * Get audit logs for a stage
   */
  @RequirePermissions([PERMISSIONS.AUDIT_READ])
  @OpenAPI({
    tags: ['Stages'],
    summary: 'Get stage audit logs',
    description: 'Retrieves audit logs for a specific stage',
    responses: {
      200: {
        description: 'Audit logs retrieved successfully',
      },
      404: { description: 'Stage not found' },
    },
  })
  @Get('/:id/audit-logs')
  async getStageAuditLogs(@Param('id') id: string) {
    return await this.stageService.getStageAuditLogs(id);
  }
}
