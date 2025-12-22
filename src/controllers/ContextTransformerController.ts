import 'reflect-metadata';
import { JsonController, Get, Post, Put, Delete, Param, Body, QueryParams, HttpCode, Req } from 'routing-controllers';
import { injectable, inject } from 'tsyringe';
import { Validated } from '../decorators/validation';
import { OpenAPI } from '../decorators/openapi';
import { RequirePermissions } from '../decorators/auth';
import { PERMISSIONS } from '../config/permissions';
import type { Request } from 'express';
import { ContextTransformerService } from '../services/ContextTransformerService';
import { createContextTransformerSchema, updateContextTransformerBodySchema, deleteContextTransformerBodySchema, contextTransformerResponseSchema, contextTransformerListResponseSchema } from '../api/contextTransformer';
import type { CreateContextTransformerRequest, UpdateContextTransformerRequest, DeleteContextTransformerRequest } from '../api/contextTransformer';
import { listParamsSchema } from '../api/common';
import type { ListParams } from '../api/common';

/**
 * Controller for context transformer management with decorator-based routing
 * Manages context transformers which transform and enrich conversation context using LLMs
 */
@injectable()
@JsonController('/api/context-transformers')
export class ContextTransformerController {
  constructor(@inject(ContextTransformerService) private readonly contextTransformerService: ContextTransformerService) {}

  /**
   * POST /api/context-transformers
   * Create a new context transformer
   */
  @RequirePermissions([PERMISSIONS.CONTEXT_TRANSFORMER_WRITE])
  @OpenAPI({
    tags: ['Context Transformers'],
    summary: 'Create a new context transformer',
    description: 'Creates a new context transformer with specified name, prompt, and configuration',
    request: {
      body: {
        content: {
          'application/json': {
            schema: createContextTransformerSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Context transformer created successfully',
        content: {
          'application/json': {
            schema: contextTransformerResponseSchema,
          },
        },
      },
      400: { description: 'Invalid request body' },
      409: { description: 'Context transformer already exists' },
    },
  })
  @Post('/')
  @HttpCode(201)
  async createContextTransformer(@Validated(createContextTransformerSchema) @Body() body: CreateContextTransformerRequest, @Req() req: Request) {
    const transformer = await this.contextTransformerService.createContextTransformer(body, req.context);
    return transformer;
  }

  /**
   * GET /api/context-transformers/:id
   * Get a context transformer by ID
   */
  @RequirePermissions([PERMISSIONS.CONTEXT_TRANSFORMER_READ])
  @OpenAPI({
    tags: ['Context Transformers'],
    summary: 'Get context transformer by ID',
    description: 'Retrieves a single context transformer by its unique identifier',
    responses: {
      200: {
        description: 'Context transformer retrieved successfully',
        content: {
          'application/json': {
            schema: contextTransformerResponseSchema,
          },
        },
      },
      404: { description: 'Context transformer not found' },
    },
  })
  @Get('/:id')
  async getContextTransformerById(@Param('id') id: string) {
    const transformer = await this.contextTransformerService.getContextTransformerById(id);
    return transformer;
  }

  /**
   * GET /api/context-transformers
   * List context transformers with optional filters
   */
  @RequirePermissions([PERMISSIONS.CONTEXT_TRANSFORMER_READ])
  @OpenAPI({
    tags: ['Context Transformers'],
    summary: 'List context transformers',
    description: 'Retrieves a paginated list of context transformers with optional filtering and sorting',
    request: {
      query: listParamsSchema,
    },
    responses: {
      200: {
        description: 'List of context transformers retrieved successfully',
        content: {
          'application/json': {
            schema: contextTransformerListResponseSchema,
          },
        },
      },
      400: { description: 'Invalid query parameters' },
    },
  })
  @Get('/')
  async listContextTransformers(@Validated(listParamsSchema, 'query') @QueryParams() query: ListParams) {
    return await this.contextTransformerService.listContextTransformers(query);
  }

  /**
   * PUT /api/context-transformers/:id
   * Update a context transformer
   */
  @RequirePermissions([PERMISSIONS.CONTEXT_TRANSFORMER_WRITE])
  @OpenAPI({
    tags: ['Context Transformers'],
    summary: 'Update context transformer',
    description: 'Updates an existing context transformer with optimistic locking',
    request: {
      body: {
        content: {
          'application/json': {
            schema: updateContextTransformerBodySchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Context transformer updated successfully',
        content: {
          'application/json': {
            schema: contextTransformerResponseSchema,
          },
        },
      },
      400: { description: 'Invalid request body' },
      404: { description: 'Context transformer not found' },
      409: { description: 'Version conflict - entity was modified' },
    },
  })
  @Put('/:id')
  async updateContextTransformer(@Param('id') id: string, @Validated(updateContextTransformerBodySchema) @Body() body: UpdateContextTransformerRequest, @Req() req: Request) {
    const { version, ...updateData } = body;
    const transformer = await this.contextTransformerService.updateContextTransformer(id, updateData, version, req.context);
    return transformer;
  }

  /**
   * DELETE /api/context-transformers/:id
   * Delete a context transformer
   */
  @RequirePermissions([PERMISSIONS.CONTEXT_TRANSFORMER_DELETE])
  @OpenAPI({
    tags: ['Context Transformers'],
    summary: 'Delete context transformer',
    description: 'Deletes a context transformer with optimistic locking',
    request: {
      body: {
        content: {
          'application/json': {
            schema: deleteContextTransformerBodySchema,
          },
        },
      },
    },
    responses: {
      204: { description: 'Context transformer deleted successfully' },
      400: { description: 'Invalid request body' },
      404: { description: 'Context transformer not found' },
      409: { description: 'Version conflict - entity was modified' },
    },
  })
  @Delete('/:id')
  @HttpCode(204)
  async deleteContextTransformer(@Param('id') id: string, @Validated(deleteContextTransformerBodySchema) @Body() body: DeleteContextTransformerRequest, @Req() req: Request) {
    await this.contextTransformerService.deleteContextTransformer(id, body.version, req.context);
  }

  /**
   * GET /api/context-transformers/:id/audit-logs
   * Get audit logs for a context transformer
   */
  @RequirePermissions([PERMISSIONS.AUDIT_READ])
  @OpenAPI({
    tags: ['Context Transformers'],
    summary: 'Get context transformer audit logs',
    description: 'Retrieves audit logs for a specific context transformer',
    responses: {
      200: {
        description: 'Audit logs retrieved successfully',
      },
      404: { description: 'Context transformer not found' },
    },
  })
  @Get('/:id/audit-logs')
  async getContextTransformerAuditLogs(@Param('id') id: string) {
    return await this.contextTransformerService.getContextTransformerAuditLogs(id);
  }
}
