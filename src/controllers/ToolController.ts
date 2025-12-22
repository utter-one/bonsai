import 'reflect-metadata';
import { JsonController, Get, Post, Put, Delete, Param, Body, QueryParams, HttpCode, Req } from 'routing-controllers';
import { injectable, inject } from 'tsyringe';
import { Validated } from '../decorators/validation';
import { OpenAPI } from '../decorators/openapi';
import { RequirePermissions } from '../decorators/auth';
import { PERMISSIONS } from '../permissions';
import type { Request } from 'express';
import { ToolService } from '../services/ToolService';
import { createToolSchema, updateToolBodySchema, deleteToolBodySchema, toolResponseSchema, toolListResponseSchema } from '../api/tool';
import type { CreateToolRequest, UpdateToolRequest, DeleteToolRequest } from '../api/tool';
import { listParamsSchema } from '../api/common';
import type { ListParams } from '../api/common';

/**
 * Controller for tool management with decorator-based routing
 * Manages tools which are reusable components invoked during conversation stages for LLM calls
 */
@injectable()
@JsonController('/api/tools')
export class ToolController {
  constructor(@inject(ToolService) private readonly toolService: ToolService) {}

  /**
   * POST /api/tools
   * Create a new tool
   */
  @RequirePermissions([PERMISSIONS.TOOL_WRITE])
  @OpenAPI({
    tags: ['Tools'],
    summary: 'Create a new tool',
    description: 'Creates a new tool with specified name, prompt, input/output types, and configuration',
    request: {
      body: {
        content: {
          'application/json': {
            schema: createToolSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Tool created successfully',
        content: {
          'application/json': {
            schema: toolResponseSchema,
          },
        },
      },
      400: { description: 'Invalid request body' },
      409: { description: 'Tool already exists' },
    },
  })
  @Post('/')
  @HttpCode(201)
  async createTool(@Validated(createToolSchema) @Body() body: CreateToolRequest, @Req() req: Request) {
    const tool = await this.toolService.createTool(body, req.context);
    return tool;
  }

  /**
   * GET /api/tools/:id
   * Get a tool by ID
   */
  @RequirePermissions([PERMISSIONS.TOOL_READ])
  @OpenAPI({
    tags: ['Tools'],
    summary: 'Get tool by ID',
    description: 'Retrieves a single tool by its unique identifier',
    responses: {
      200: {
        description: 'Tool retrieved successfully',
        content: {
          'application/json': {
            schema: toolResponseSchema,
          },
        },
      },
      404: { description: 'Tool not found' },
    },
  })
  @Get('/:id')
  async getToolById(@Param('id') id: string) {
    const tool = await this.toolService.getToolById(id);
    return tool;
  }

  /**
   * GET /api/tools
   * List tools with optional filters
   */
  @RequirePermissions([PERMISSIONS.TOOL_READ])
  @OpenAPI({
    tags: ['Tools'],
    summary: 'List tools',
    description: 'Retrieves a paginated list of tools with optional filtering and sorting',
    request: {
      query: listParamsSchema,
    },
    responses: {
      200: {
        description: 'List of tools retrieved successfully',
        content: {
          'application/json': {
            schema: toolListResponseSchema,
          },
        },
      },
      400: { description: 'Invalid query parameters' },
    },
  })
  @Get('/')
  async listTools(@Validated(listParamsSchema, 'query') @QueryParams() query: ListParams) {
    return await this.toolService.listTools(query);
  }

  /**
   * PUT /api/tools/:id
   * Update a tool
   */
  @RequirePermissions([PERMISSIONS.TOOL_WRITE])
  @OpenAPI({
    tags: ['Tools'],
    summary: 'Update tool',
    description: 'Updates an existing tool with optimistic locking',
    request: {
      body: {
        content: {
          'application/json': {
            schema: updateToolBodySchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Tool updated successfully',
        content: {
          'application/json': {
            schema: toolResponseSchema,
          },
        },
      },
      400: { description: 'Invalid request body' },
      404: { description: 'Tool not found' },
      409: { description: 'Version conflict - entity was modified' },
    },
  })
  @Put('/:id')
  async updateTool(@Param('id') id: string, @Validated(updateToolBodySchema) @Body() body: UpdateToolRequest, @Req() req: Request) {
    const { version, ...updateData } = body;
    const tool = await this.toolService.updateTool(id, updateData, version, req.context);
    return tool;
  }

  /**
   * DELETE /api/tools/:id
   * Delete a tool
   */
  @RequirePermissions([PERMISSIONS.TOOL_DELETE])
  @OpenAPI({
    tags: ['Tools'],
    summary: 'Delete tool',
    description: 'Deletes a tool with optimistic locking',
    request: {
      body: {
        content: {
          'application/json': {
            schema: deleteToolBodySchema,
          },
        },
      },
    },
    responses: {
      204: { description: 'Tool deleted successfully' },
      400: { description: 'Invalid request body' },
      404: { description: 'Tool not found' },
      409: { description: 'Version conflict - entity was modified' },
    },
  })
  @Delete('/:id')
  @HttpCode(204)
  async deleteTool(@Param('id') id: string, @Validated(deleteToolBodySchema) @Body() body: DeleteToolRequest, @Req() req: Request) {
    await this.toolService.deleteTool(id, body.version, req.context);
  }

  /**
   * GET /api/tools/:id/audit-logs
   * Get audit logs for a tool
   */
  @RequirePermissions([PERMISSIONS.AUDIT_READ])
  @OpenAPI({
    tags: ['Tools'],
    summary: 'Get tool audit logs',
    description: 'Retrieves audit logs for a specific tool',
    responses: {
      200: {
        description: 'Audit logs retrieved successfully',
      },
      404: { description: 'Tool not found' },
    },
  })
  @Get('/:id/audit-logs')
  async getToolAuditLogs(@Param('id') id: string) {
    return await this.toolService.getToolAuditLogs(id);
  }
}
