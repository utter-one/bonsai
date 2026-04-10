import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { ToolService } from '../../services/ToolService';
import { createToolSchema, updateToolBodySchema, deleteToolBodySchema, toolResponseSchema, toolListResponseSchema, toolRouteParamsSchema, cloneToolSchema } from '../contracts/tool';
import type { UpdateToolRequest, CloneToolRequest } from '../contracts/tool';
import { listParamsSchema, projectScopedParamsSchema } from '../contracts/common';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for tool management with explicit routing
 * Manages tools which are reusable components invoked during conversation stages for LLM calls
 */
@singleton()
export class ToolController {
  constructor(@inject(ToolService) private readonly toolService: ToolService) { }

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/projects/{projectId}/tools',
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
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/tools/{id}',
        tags: ['Tools'],
        summary: 'Get tool by ID',
        description: 'Retrieves a single tool by its unique identifier',
        request: {
          params: toolRouteParamsSchema,
        },
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
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/tools',
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
      },
      {
        method: 'put',
        path: '/api/projects/{projectId}/tools/{id}',
        tags: ['Tools'],
        summary: 'Update tool',
        description: 'Updates an existing tool with optimistic locking',
        request: {
          params: toolRouteParamsSchema,
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
      },
      {
        method: 'delete',
        path: '/api/projects/{projectId}/tools/{id}',
        tags: ['Tools'],
        summary: 'Delete tool',
        description: 'Deletes a tool with optimistic locking',
        request: {
          params: toolRouteParamsSchema,
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
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/tools/{id}/audit-logs',
        tags: ['Tools'],
        summary: 'Get tool audit logs',
        description: 'Retrieves audit logs for a specific tool',
        request: {
          params: toolRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Audit logs retrieved successfully',
          },
          404: { description: 'Tool not found' },
        },
      },
      {
        method: 'post',
        path: '/api/projects/{projectId}/tools/{id}/clone',
        tags: ['Tools'],
        summary: 'Clone tool',
        description: 'Creates a copy of an existing tool with a new ID and optional name override',
        request: {
          params: toolRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: cloneToolSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Tool cloned successfully',
            content: {
              'application/json': {
                schema: toolResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Tool not found' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    router.post('/api/projects/:projectId/tools', asyncHandler(this.createTool.bind(this)));
    router.get('/api/projects/:projectId/tools/:id', asyncHandler(this.getToolById.bind(this)));
    router.get('/api/projects/:projectId/tools', asyncHandler(this.listTools.bind(this)));
    router.put('/api/projects/:projectId/tools/:id', asyncHandler(this.updateTool.bind(this)));
    router.delete('/api/projects/:projectId/tools/:id', asyncHandler(this.deleteTool.bind(this)));
    router.get('/api/projects/:projectId/tools/:id/audit-logs', asyncHandler(this.getToolAuditLogs.bind(this)));
    router.post('/api/projects/:projectId/tools/:id/clone', asyncHandler(this.cloneTool.bind(this)));
  }

  /**
   * POST /api/tools
   * Create a new tool
   */
  private async createTool(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.TOOL_WRITE]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const body = createToolSchema.parse(req.body);
    const tool = await this.toolService.createTool(projectId, body, req.context);
    res.status(201).json(tool);
  }

  /**
   * GET /api/tools/:id
   * Get a tool by ID
   */
  private async getToolById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.TOOL_READ]);
    const params = toolRouteParamsSchema.parse(req.params);
    const tool = await this.toolService.getToolById(params.projectId, params.id);
    res.status(200).json(tool);
  }

  /**
   * GET /api/tools
   * List tools with optional filters
   */
  private async listTools(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.TOOL_READ]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const query = listParamsSchema.parse(req.query);
    const tools = await this.toolService.listTools(projectId, query);
    res.status(200).json(tools);
  }

  /**
   * PUT /api/tools/:id
   * Update a tool
   */
  private async updateTool(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.TOOL_WRITE]);
    const params = toolRouteParamsSchema.parse(req.params);
    const body = updateToolBodySchema.parse(req.body);
    const tool = await this.toolService.updateTool(params.projectId, params.id, body, req.context);
    res.status(200).json(tool);
  }

  /**
   * DELETE /api/tools/:id
   * Delete a tool
   */
  private async deleteTool(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.TOOL_DELETE]);
    const params = toolRouteParamsSchema.parse(req.params);
    const body = deleteToolBodySchema.parse(req.body);
    await this.toolService.deleteTool(params.projectId, params.id, body.version, req.context);
    res.status(204).send();
  }

  /**
   * GET /api/tools/:id/audit-logs
   * Get audit logs for a tool
   */
  private async getToolAuditLogs(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.AUDIT_READ]);
    const params = toolRouteParamsSchema.parse(req.params);
    const logs = await this.toolService.getToolAuditLogs(params.id, params.projectId);
    res.status(200).json(logs);
  }

  /**
   * POST /api/tools/:id/clone
   * Clone a tool
   */
  private async cloneTool(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.TOOL_WRITE]);
    const params = toolRouteParamsSchema.parse(req.params);
    const body = cloneToolSchema.parse(req.body);
    const tool = await this.toolService.cloneTool(params.projectId, params.id, body, req.context);
    res.status(201).json(tool);
  }
}
