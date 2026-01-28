import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { PERMISSIONS } from '../../permissions';
import { KnowledgeService } from '../../services/KnowledgeService';
import { createKnowledgeSectionSchema, updateKnowledgeSectionSchema, knowledgeSectionResponseSchema, knowledgeSectionListResponseSchema, createKnowledgeCategorySchema, updateKnowledgeCategoryBodySchema, deleteKnowledgeCategoryBodySchema, knowledgeCategoryResponseSchema, knowledgeCategoryListResponseSchema, createKnowledgeItemSchema, updateKnowledgeItemBodySchema, deleteKnowledgeItemBodySchema, knowledgeItemResponseSchema, knowledgeItemListResponseSchema, knowledgeSectionRouteParamsSchema, knowledgeCategoryRouteParamsSchema, knowledgeItemRouteParamsSchema, knowledgeCategoryItemsRouteParamsSchema } from '../contracts/knowledge';
import type { CreateKnowledgeSectionRequest, UpdateKnowledgeSectionRequest, CreateKnowledgeCategoryRequest, UpdateKnowledgeCategoryRequest, DeleteKnowledgeCategoryRequest, CreateKnowledgeItemRequest, UpdateKnowledgeItemRequest, DeleteKnowledgeItemRequest } from '../contracts/knowledge';
import { listParamsSchema } from '../contracts/common';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for knowledge base management including sections, categories, and items
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
      // KNOWLEDGE SECTION ENDPOINTS
      // ============================================================
      {
        method: 'post',
        path: '/api/knowledge/sections',
        tags: ['Knowledge'],
        summary: 'Create a new knowledge section',
        description: 'Creates a new knowledge section that can contain multiple categories',
        request: {
          body: {
            content: {
              'application/json': {
                schema: createKnowledgeSectionSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Knowledge section created successfully',
            content: {
              'application/json': {
                schema: knowledgeSectionResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          409: { description: 'Knowledge section already exists' },
        },
      },
      {
        method: 'get',
        path: '/api/knowledge/sections/{id}',
        tags: ['Knowledge'],
        summary: 'Get knowledge section by ID',
        description: 'Retrieves a single knowledge section by its unique identifier',
        request: {
          params: knowledgeSectionRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Knowledge section retrieved successfully',
            content: {
              'application/json': {
                schema: knowledgeSectionResponseSchema,
              },
            },
          },
          404: { description: 'Knowledge section not found' },
        },
      },
      {
        method: 'get',
        path: '/api/knowledge/sections',
        tags: ['Knowledge'],
        summary: 'List knowledge sections',
        description: 'Retrieves a paginated list of knowledge sections with optional filtering and sorting',
        request: {
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'List of knowledge sections retrieved successfully',
            content: {
              'application/json': {
                schema: knowledgeSectionListResponseSchema,
              },
            },
          },
          400: { description: 'Invalid query parameters' },
        },
      },
      {
        method: 'put',
        path: '/api/knowledge/sections/{id}',
        tags: ['Knowledge'],
        summary: 'Update knowledge section',
        description: 'Updates an existing knowledge section',
        request: {
          params: knowledgeSectionRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: updateKnowledgeSectionSchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Knowledge section updated successfully',
            content: {
              'application/json': {
                schema: knowledgeSectionResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Knowledge section not found' },
        },
      },
      {
        method: 'delete',
        path: '/api/knowledge/sections/{id}',
        tags: ['Knowledge'],
        summary: 'Delete knowledge section',
        description: 'Deletes a knowledge section',
        request: {
          params: knowledgeSectionRouteParamsSchema,
        },
        responses: {
          204: { description: 'Knowledge section deleted successfully' },
          404: { description: 'Knowledge section not found' },
        },
      },
      // ============================================================
      // KNOWLEDGE CATEGORY ENDPOINTS
      // ============================================================
      {
        method: 'post',
        path: '/api/knowledge/categories',
        tags: ['Knowledge'],
        summary: 'Create a new knowledge category',
        description: 'Creates a new knowledge category with trigger phrase and associated sections',
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
        path: '/api/knowledge/categories/{id}',
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
        path: '/api/knowledge/categories',
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
        path: '/api/knowledge/categories/{id}',
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
        path: '/api/knowledge/categories/{id}',
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
        path: '/api/knowledge/items',
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
        path: '/api/knowledge/items/{id}',
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
        path: '/api/knowledge/items',
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
        path: '/api/knowledge/items/{id}',
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
        path: '/api/knowledge/items/{id}',
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
        path: '/api/knowledge/categories/{categoryId}/items',
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
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    // Section routes
    router.post('/api/knowledge/sections', asyncHandler(this.createKnowledgeSection.bind(this)));
    router.get('/api/knowledge/sections/:id', asyncHandler(this.getKnowledgeSectionById.bind(this)));
    router.get('/api/knowledge/sections', asyncHandler(this.listKnowledgeSections.bind(this)));
    router.put('/api/knowledge/sections/:id', asyncHandler(this.updateKnowledgeSection.bind(this)));
    router.delete('/api/knowledge/sections/:id', asyncHandler(this.deleteKnowledgeSection.bind(this)));

    // Category routes
    router.post('/api/knowledge/categories', asyncHandler(this.createKnowledgeCategory.bind(this)));
    router.get('/api/knowledge/categories/:id', asyncHandler(this.getKnowledgeCategoryById.bind(this)));
    router.get('/api/knowledge/categories', asyncHandler(this.listKnowledgeCategories.bind(this)));
    router.put('/api/knowledge/categories/:id', asyncHandler(this.updateKnowledgeCategory.bind(this)));
    router.delete('/api/knowledge/categories/:id', asyncHandler(this.deleteKnowledgeCategory.bind(this)));

    // Item routes
    router.post('/api/knowledge/items', asyncHandler(this.createKnowledgeItem.bind(this)));
    router.get('/api/knowledge/items/:id', asyncHandler(this.getKnowledgeItemById.bind(this)));
    router.get('/api/knowledge/items', asyncHandler(this.listKnowledgeItems.bind(this)));
    router.put('/api/knowledge/items/:id', asyncHandler(this.updateKnowledgeItem.bind(this)));
    router.delete('/api/knowledge/items/:id', asyncHandler(this.deleteKnowledgeItem.bind(this)));

    // Category items route
    router.get('/api/knowledge/categories/:categoryId/items', asyncHandler(this.getItemsByCategory.bind(this)));
  }

  // ============================================================
  // KNOWLEDGE SECTION HANDLERS
  // ============================================================

  /**
   * POST /api/knowledge/sections
   * Create a new knowledge section
   */
  private async createKnowledgeSection(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.KNOWLEDGE_WRITE]);
    const body = createKnowledgeSectionSchema.parse(req.body);
    const section = await this.knowledgeService.createKnowledgeSection(body, req.context);
    res.status(201).json(section);
  }

  /**
   * GET /api/knowledge/sections/:id
   * Get a knowledge section by ID
   */
  private async getKnowledgeSectionById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.KNOWLEDGE_READ]);
    const params = knowledgeSectionRouteParamsSchema.parse(req.params);
    const section = await this.knowledgeService.getKnowledgeSectionById(params.id);
    res.status(200).json(section);
  }

  /**
   * GET /api/knowledge/sections
   * List knowledge sections with optional filters
   */
  private async listKnowledgeSections(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.KNOWLEDGE_READ]);
    const query = listParamsSchema.parse(req.query);
    const sections = await this.knowledgeService.listKnowledgeSections(query);
    res.status(200).json(sections);
  }

  /**
   * PUT /api/knowledge/sections/:id
   * Update a knowledge section
   */
  private async updateKnowledgeSection(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.KNOWLEDGE_WRITE]);
    const params = knowledgeSectionRouteParamsSchema.parse(req.params);
    const body = updateKnowledgeSectionSchema.parse(req.body);
    const section = await this.knowledgeService.updateKnowledgeSection(params.id, body, req.context);
    res.status(200).json(section);
  }

  /**
   * DELETE /api/knowledge/sections/:id
   * Delete a knowledge section
   */
  private async deleteKnowledgeSection(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.KNOWLEDGE_DELETE]);
    const params = knowledgeSectionRouteParamsSchema.parse(req.params);
    await this.knowledgeService.deleteKnowledgeSection(params.id, req.context);
    res.status(204).send();
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
    const body = createKnowledgeCategorySchema.parse(req.body);
    const category = await this.knowledgeService.createKnowledgeCategory(body, req.context);
    res.status(201).json(category);
  }

  /**
   * GET /api/knowledge/categories/:id
   * Get a knowledge category by ID with its items
   */
  private async getKnowledgeCategoryById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.KNOWLEDGE_READ]);
    const params = knowledgeCategoryRouteParamsSchema.parse(req.params);
    const category = await this.knowledgeService.getKnowledgeCategoryById(params.id);
    res.status(200).json(category);
  }

  /**
   * GET /api/knowledge/categories
   * List knowledge categories with optional filters
   */
  private async listKnowledgeCategories(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.KNOWLEDGE_READ]);
    const query = listParamsSchema.parse(req.query);
    const categories = await this.knowledgeService.listKnowledgeCategories(query);
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
    const category = await this.knowledgeService.updateKnowledgeCategory(params.id, body, req.context);
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
    await this.knowledgeService.deleteKnowledgeCategory(params.id, body.version, req.context);
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
    const body = createKnowledgeItemSchema.parse(req.body);
    const item = await this.knowledgeService.createKnowledgeItem(body, req.context);
    res.status(201).json(item);
  }

  /**
   * GET /api/knowledge/items/:id
   * Get a knowledge item by ID
   */
  private async getKnowledgeItemById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.KNOWLEDGE_READ]);
    const params = knowledgeItemRouteParamsSchema.parse(req.params);
    const item = await this.knowledgeService.getKnowledgeItemById(params.id);
    res.status(200).json(item);
  }

  /**
   * GET /api/knowledge/items
   * List knowledge items with optional filters
   */
  private async listKnowledgeItems(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.KNOWLEDGE_READ]);
    const query = listParamsSchema.parse(req.query);
    const items = await this.knowledgeService.listKnowledgeItems(query);
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
    const item = await this.knowledgeService.updateKnowledgeItem(params.id, body, req.context);
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
    await this.knowledgeService.deleteKnowledgeItem(params.id, body.version, req.context);
    res.status(204).send();
  }

  /**
   * GET /api/knowledge/categories/:categoryId/items
   * Get all items for a specific category
   */
  private async getItemsByCategory(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.KNOWLEDGE_READ]);
    const params = knowledgeCategoryItemsRouteParamsSchema.parse(req.params);
    const items = await this.knowledgeService.getItemsByCategory(params.categoryId);
    res.status(200).json(items);
  }
}
