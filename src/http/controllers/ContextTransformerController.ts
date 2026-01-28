import { inject, singleton } from 'tsyringe';
import type { Request, Response, NextFunction, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { ContextTransformerService } from '../../services/ContextTransformerService';
import { createContextTransformerSchema, updateContextTransformerBodySchema, deleteContextTransformerBodySchema, contextTransformerResponseSchema, contextTransformerListResponseSchema, contextTransformerRouteParamsSchema } from '../contracts/contextTransformer';
import { listParamsSchema } from '../contracts/common';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for context transformer management with explicit routing
 */
@singleton()
export class ContextTransformerController {
  constructor(@inject(ContextTransformerService) private readonly contextTransformerService: ContextTransformerService) {}

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/context-transformers',
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
      },
      {
        method: 'get',
        path: '/api/context-transformers/{id}',
        tags: ['Context Transformers'],
        summary: 'Get context transformer by ID',
        description: 'Retrieves a single context transformer by its unique identifier',
        request: {
          params: contextTransformerRouteParamsSchema,
        },
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
      },
      {
        method: 'get',
        path: '/api/context-transformers',
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
      },
      {
        method: 'put',
        path: '/api/context-transformers/{id}',
        tags: ['Context Transformers'],
        summary: 'Update context transformer',
        description: 'Updates an existing context transformer with optimistic locking',
        request: {
          params: contextTransformerRouteParamsSchema,
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
      },
      {
        method: 'delete',
        path: '/api/context-transformers/{id}',
        tags: ['Context Transformers'],
        summary: 'Delete context transformer',
        description: 'Deletes a context transformer with optimistic locking',
        request: {
          params: contextTransformerRouteParamsSchema,
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
      },
      {
        method: 'get',
        path: '/api/context-transformers/{id}/audit-logs',
        tags: ['Context Transformers'],
        summary: 'Get context transformer audit logs',
        description: 'Retrieves audit logs for a specific context transformer',
        request: {
          params: contextTransformerRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Audit logs retrieved successfully',
          },
          404: { description: 'Context transformer not found' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    router.post('/api/context-transformers', asyncHandler(this.createContextTransformer.bind(this)));
    router.get('/api/context-transformers/:id', asyncHandler(this.getContextTransformerById.bind(this)));
    router.get('/api/context-transformers', asyncHandler(this.listContextTransformers.bind(this)));
    router.put('/api/context-transformers/:id', asyncHandler(this.updateContextTransformer.bind(this)));
    router.delete('/api/context-transformers/:id', asyncHandler(this.deleteContextTransformer.bind(this)));
    router.get('/api/context-transformers/:id/audit-logs', asyncHandler(this.getContextTransformerAuditLogs.bind(this)));
  }

  /**
   * POST /api/context-transformers
   * Create a new context transformer
   */
  private async createContextTransformer(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.CONTEXT_TRANSFORMER_WRITE]);
    const body = createContextTransformerSchema.parse(req.body);
    const transformer = await this.contextTransformerService.createContextTransformer(body, req.context);
    res.status(201).json(transformer);
  }

  /**
   * GET /api/context-transformers/:id
   * Get a context transformer by ID
   */
  private async getContextTransformerById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.CONTEXT_TRANSFORMER_READ]);
    const params = contextTransformerRouteParamsSchema.parse(req.params);
    const transformer = await this.contextTransformerService.getContextTransformerById(params.id);
    res.status(200).json(transformer);
  }

  /**
   * GET /api/context-transformers
   * List context transformers with optional filters
   */
  private async listContextTransformers(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.CONTEXT_TRANSFORMER_READ]);
    const query = listParamsSchema.parse(req.query);
    const transformers = await this.contextTransformerService.listContextTransformers(query);
    res.status(200).json(transformers);
  }

  /**
   * PUT /api/context-transformers/:id
   * Update a context transformer
   */
  private async updateContextTransformer(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.CONTEXT_TRANSFORMER_WRITE]);
    const params = contextTransformerRouteParamsSchema.parse(req.params);
    const body = updateContextTransformerBodySchema.parse(req.body);
    const transformer = await this.contextTransformerService.updateContextTransformer(params.id, body, req.context);
    res.status(200).json(transformer);
  }

  /**
   * DELETE /api/context-transformers/:id
   * Delete a context transformer
   */
  private async deleteContextTransformer(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.CONTEXT_TRANSFORMER_DELETE]);
    const params = contextTransformerRouteParamsSchema.parse(req.params);
    const body = deleteContextTransformerBodySchema.parse(req.body);
    await this.contextTransformerService.deleteContextTransformer(params.id, body.version, req.context);
    res.status(204).send();
  }

  /**
   * GET /api/context-transformers/:id/audit-logs
   * Get audit logs for a context transformer
   */
  private async getContextTransformerAuditLogs(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.AUDIT_READ]);
    const params = contextTransformerRouteParamsSchema.parse(req.params);
    const auditLogs = await this.contextTransformerService.getContextTransformerAuditLogs(params.id);
    res.status(200).json(auditLogs);
  }
}
