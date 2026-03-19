import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { PERMISSIONS } from '../../permissions';
import { KnowledgeService } from '../../services/KnowledgeService';
import { createKnowledgeCategorySchema, updateKnowledgeCategoryBodySchema, deleteKnowledgeCategoryBodySchema, knowledgeCategoryResponseSchema, knowledgeCategoryListResponseSchema, createKnowledgeItemSchema, updateKnowledgeItemBodySchema, deleteKnowledgeItemBodySchema, knowledgeItemResponseSchema, knowledgeItemListResponseSchema, knowledgeCategoryRouteParamsSchema, knowledgeItemRouteParamsSchema, knowledgeCategoryItemsRouteParamsSchema } from '../contracts/knowledge';
import { listParamsSchema, projectScopedParamsSchema } from '../contracts/common';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for knowledge base management including categories, and items
 */
@singleton()
export class KnowledgeController {
  constructor(@inject(KnowledgeService) private readonly knowledgeService: KnowledgeService) {}

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      // ============================================================
      // KNOWLEDGE CATEGORY ENDPOINTS
      // ============================================================
      {
        method: 'post',
        path: '/api/projects/{projectId}/knowledge/categories',
        tags: ['Knowledge'],
        summary: 'Create a new knowledge category',
        description: 'Creates a new knowledge category with trigger phrase and associated tags',
        request: {
          body: {
            content: {
              'application/json': {
                schema: createKnowledgeCategorySchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Knowledge category created successfully',
            content: {
              'application/json': {
                schema: knowledgeCategoryResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          409: { description: 'Knowledge category already exists' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/knowledge/categories/{id}',
        tags: ['Knowledge'],
        summary: 'Get knowledge category by ID',
        description: 'Retrieves a single knowledge category with all its items by unique identifier',
        request: {
          params: knowledgeCategoryRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Knowledge category retrieved successfully',
            content: {
              'application/json': {
                schema: knowledgeCategoryResponseSchema,
              },
            },
          },
          404: { description: 'Knowledge category not found' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/knowledge/categories',
        tags: ['Knowledge'],
        summary: 'List knowledge categories',
        description: 'Retrieves a paginated list of knowledge categories with their items. Supports filtering, sorting, and text search',
        request: {
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'List of knowledge categories retrieved successfully',
            content: {
              'application/json': {
                schema: knowledgeCategoryListResponseSchema,
              },
            },
          },
          400: { description: 'Invalid query parameters' },
        },
      },
      {
        method: 'put',
        path: '/api/projects/{projectId}/knowledge/categories/{id}',
        tags: ['Knowledge'],
        summary: 'Update knowledge category',
        description: 'Updates an existing knowledge category with optimistic locking',
        request: {
          params: knowledgeCategoryRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: updateKnowledgeCategoryBodySchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Knowledge category updated successfully',
            content: {
              'application/json': {
                schema: knowledgeCategoryResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Knowledge category not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'delete',
        path: '/api/projects/{projectId}/knowledge/categories/{id}',
        tags: ['Knowledge'],
        summary: 'Delete knowledge category',
        description: 'Deletes a knowledge category with optimistic locking. This will also delete all items in the category',
        request: {
          params: knowledgeCategoryRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: deleteKnowledgeCategoryBodySchema,
              },
            },
          },
        },
        responses: {
          204: { description: 'Knowledge category deleted successfully' },
          400: { description: 'Invalid request body' },
          404: { description: 'Knowledge category not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      // ============================================================
      // KNOWLEDGE ITEM ENDPOINTS
      // ============================================================
      {
        method: 'post',
        path: '/api/projects/{projectId}/knowledge/items',
        tags: ['Knowledge'],
        summary: 'Create a new knowledge item',
        description: 'Creates a new knowledge item (Q&A pair) within a specific category',
        request: {
          body: {
            content: {
              'application/json': {
                schema: createKnowledgeItemSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Knowledge item created successfully',
            content: {
              'application/json': {
                schema: knowledgeItemResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          409: { description: 'Knowledge item already exists' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/knowledge/items/{id}',
        tags: ['Knowledge'],
        summary: 'Get knowledge item by ID',
        description: 'Retrieves a single knowledge item by its unique identifier',
        request: {
          params: knowledgeItemRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Knowledge item retrieved successfully',
            content: {
              'application/json': {
                schema: knowledgeItemResponseSchema,
              },
            },
          },
          404: { description: 'Knowledge item not found' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/knowledge/items',
        tags: ['Knowledge'],
        summary: 'List knowledge items',
        description: 'Retrieves a paginated list of knowledge items. Supports filtering by categoryId, text search, sorting, and pagination',
        request: {
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'List of knowledge items retrieved successfully',
            content: {
              'application/json': {
                schema: knowledgeItemListResponseSchema,
              },
            },
          },
          400: { description: 'Invalid query parameters' },
        },
      },
      {
        method: 'put',
        path: '/api/projects/{projectId}/knowledge/items/{id}',
        tags: ['Knowledge'],
        summary: 'Update knowledge item',
        description: 'Updates an existing knowledge item with optimistic locking',
        request: {
          params: knowledgeItemRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: updateKnowledgeItemBodySchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Knowledge item updated successfully',
            content: {
              'application/json': {
                schema: knowledgeItemResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Knowledge item not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'delete',
        path: '/api/projects/{projectId}/knowledge/items/{id}',
        tags: ['Knowledge'],
        summary: 'Delete knowledge item',
        description: 'Deletes a knowledge item with optimistic locking',
        request: {
          params: knowledgeItemRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: deleteKnowledgeItemBodySchema,
              },
            },
          },
        },
        responses: {
          204: { description: 'Knowledge item deleted successfully' },
          400: { description: 'Invalid request body' },
          404: { description: 'Knowledge item not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/knowledge/categories/{categoryId}/items',
        tags: ['Knowledge'],
        summary: 'Get items by category',
        description: 'Retrieves all knowledge items belonging to a specific category, ordered by their display order',
        request: {
          params: knowledgeCategoryItemsRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Knowledge items retrieved successfully',
            content: {
              'application/json': {
                schema: z.array(knowledgeItemResponseSchema),
              },
            },
          },
          404: { description: 'Category not found' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/knowledge/categories/{id}/audit-logs',
        tags: ['Knowledge'],
        summary: 'Get knowledge category audit logs',
        description: 'Retrieves audit logs for a specific knowledge category',
        request: {
          params: knowledgeCategoryRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Audit logs retrieved successfully',
          },
          404: { description: 'Knowledge category not found' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/knowledge/items/{id}/audit-logs',
        tags: ['Knowledge'],
        summary: 'Get knowledge item audit logs',
        description: 'Retrieves audit logs for a specific knowledge item',
        request: {
          params: knowledgeItemRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Audit logs retrieved successfully',
          },
          404: { description: 'Knowledge item not found' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    // Category routes
    router.post('/api/projects/:projectId/knowledge/categories', asyncHandler(this.createKnowledgeCategory.bind(this)));
    router.get('/api/projects/:projectId/knowledge/categories/:id', asyncHandler(this.getKnowledgeCategoryById.bind(this)));
    router.get('/api/projects/:projectId/knowledge/categories', asyncHandler(this.listKnowledgeCategories.bind(this)));
    router.put('/api/projects/:projectId/knowledge/categories/:id', asyncHandler(this.updateKnowledgeCategory.bind(this)));
    router.delete('/api/projects/:projectId/knowledge/categories/:id', asyncHandler(this.deleteKnowledgeCategory.bind(this)));

    // Item routes
    router.post('/api/projects/:projectId/knowledge/items', asyncHandler(this.createKnowledgeItem.bind(this)));
    router.get('/api/projects/:projectId/knowledge/items/:id', asyncHandler(this.getKnowledgeItemById.bind(this)));
    router.get('/api/projects/:projectId/knowledge/items', asyncHandler(this.listKnowledgeItems.bind(this)));
    router.put('/api/projects/:projectId/knowledge/items/:id', asyncHandler(this.updateKnowledgeItem.bind(this)));
    router.delete('/api/projects/:projectId/knowledge/items/:id', asyncHandler(this.deleteKnowledgeItem.bind(this)));

    // Category items route
    router.get('/api/projects/:projectId/knowledge/categories/:categoryId/items', asyncHandler(this.getItemsByCategory.bind(this)));

    // Audit log routes
    router.get('/api/projects/:projectId/knowledge/categories/:id/audit-logs', asyncHandler(this.getKnowledgeCategoryAuditLogs.bind(this)));
    router.get('/api/projects/:projectId/knowledge/items/:id/audit-logs', asyncHandler(this.getKnowledgeItemAuditLogs.bind(this)));
  }

  // ============================================================
  // KNOWLEDGE CATEGORY HANDLERS
  // ============================================================

  /**
   * POST /api/knowledge/categories
   * Create a new knowledge category
   */
  private async createKnowledgeCategory(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.KNOWLEDGE_WRITE]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const body = createKnowledgeCategorySchema.parse(req.body);
    const category = await this.knowledgeService.createKnowledgeCategory(projectId, body, req.context);
    res.status(201).json(category);
  }

  /**
   * GET /api/knowledge/categories/:id
   * Get a knowledge category by ID with its items
   */
  private async getKnowledgeCategoryById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.KNOWLEDGE_READ]);
    const params = knowledgeCategoryRouteParamsSchema.parse(req.params);
    const category = await this.knowledgeService.getKnowledgeCategoryById(params.projectId, params.id);
    res.status(200).json(category);
  }

  /**
   * GET /api/knowledge/categories
   * List knowledge categories with optional filters
   */
  private async listKnowledgeCategories(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.KNOWLEDGE_READ]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const query = listParamsSchema.parse(req.query);
    const categories = await this.knowledgeService.listKnowledgeCategories(projectId, query);
    res.status(200).json(categories);
  }

  /**
   * PUT /api/knowledge/categories/:id
   * Update a knowledge category
   */
  private async updateKnowledgeCategory(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.KNOWLEDGE_WRITE]);
    const params = knowledgeCategoryRouteParamsSchema.parse(req.params);
    const body = updateKnowledgeCategoryBodySchema.parse(req.body);
    const category = await this.knowledgeService.updateKnowledgeCategory(params.projectId, params.id, body, req.context);
    res.status(200).json(category);
  }

  /**
   * DELETE /api/knowledge/categories/:id
   * Delete a knowledge category
   */
  private async deleteKnowledgeCategory(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.KNOWLEDGE_DELETE]);
    const params = knowledgeCategoryRouteParamsSchema.parse(req.params);
    const body = deleteKnowledgeCategoryBodySchema.parse(req.body);
    await this.knowledgeService.deleteKnowledgeCategory(params.projectId, params.id, body.version, req.context);
    res.status(204).send();
  }

  // ============================================================
  // KNOWLEDGE ITEM HANDLERS
  // ============================================================

  /**
   * POST /api/knowledge/items
   * Create a new knowledge item
   */
  private async createKnowledgeItem(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.KNOWLEDGE_WRITE]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const body = createKnowledgeItemSchema.parse(req.body);
    const item = await this.knowledgeService.createKnowledgeItem(projectId, body, req.context);
    res.status(201).json(item);
  }

  /**
   * GET /api/knowledge/items/:id
   * Get a knowledge item by ID
   */
  private async getKnowledgeItemById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.KNOWLEDGE_READ]);
    const params = knowledgeItemRouteParamsSchema.parse(req.params);
    const item = await this.knowledgeService.getKnowledgeItemById(params.projectId, params.id);
    res.status(200).json(item);
  }

  /**
   * GET /api/knowledge/items
   * List knowledge items with optional filters
   */
  private async listKnowledgeItems(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.KNOWLEDGE_READ]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const query = listParamsSchema.parse(req.query);
    const items = await this.knowledgeService.listKnowledgeItems(projectId, query);
    res.status(200).json(items);
  }

  /**
   * PUT /api/knowledge/items/:id
   * Update a knowledge item
   */
  private async updateKnowledgeItem(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.KNOWLEDGE_WRITE]);
    const params = knowledgeItemRouteParamsSchema.parse(req.params);
    const body = updateKnowledgeItemBodySchema.parse(req.body);
    const item = await this.knowledgeService.updateKnowledgeItem(params.projectId, params.id, body, req.context);
    res.status(200).json(item);
  }

  /**
   * DELETE /api/knowledge/items/:id
   * Delete a knowledge item
   */
  private async deleteKnowledgeItem(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.KNOWLEDGE_DELETE]);
    const params = knowledgeItemRouteParamsSchema.parse(req.params);
    const body = deleteKnowledgeItemBodySchema.parse(req.body);
    await this.knowledgeService.deleteKnowledgeItem(params.projectId, params.id, body.version, req.context);
    res.status(204).send();
  }

  /**
   * GET /api/knowledge/categories/:categoryId/items
   * Get all items for a specific category
   */
  private async getItemsByCategory(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.KNOWLEDGE_READ]);
    const params = knowledgeCategoryItemsRouteParamsSchema.parse(req.params);
    const items = await this.knowledgeService.getItemsByCategory(params.projectId, params.categoryId);
    res.status(200).json(items);
  }

  /**
   * GET /api/projects/:projectId/knowledge/categories/:id/audit-logs
   * Get audit logs for a knowledge category
   */
  private async getKnowledgeCategoryAuditLogs(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.AUDIT_READ]);
    const params = knowledgeCategoryRouteParamsSchema.parse(req.params);
    const auditLogs = await this.knowledgeService.getKnowledgeCategoryAuditLogs(params.id);
    res.status(200).json(auditLogs);
  }

  /**
   * GET /api/projects/:projectId/knowledge/items/:id/audit-logs
   * Get audit logs for a knowledge item
   */
  private async getKnowledgeItemAuditLogs(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.AUDIT_READ]);
    const params = knowledgeItemRouteParamsSchema.parse(req.params);
    const auditLogs = await this.knowledgeService.getKnowledgeItemAuditLogs(params.id);
    res.status(200).json(auditLogs);
  }
}
