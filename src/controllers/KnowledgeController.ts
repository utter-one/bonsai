import 'reflect-metadata';
import { JsonController, Get, Post, Put, Delete, Param, Body, QueryParams, HttpCode, Req } from 'routing-controllers';
import { injectable, inject } from 'tsyringe';
import { z } from 'zod';
import { Validated } from '../decorators/validation';
import { OpenAPI } from '../decorators/openapi';
import { RequirePermissions } from '../decorators/auth';
import { PERMISSIONS } from '../permissions';
import type { Request } from 'express';
import { KnowledgeService } from '../services/KnowledgeService';
import { createKnowledgeSectionSchema, updateKnowledgeSectionSchema, knowledgeSectionResponseSchema, knowledgeSectionListResponseSchema, createKnowledgeCategorySchema, updateKnowledgeCategoryBodySchema, deleteKnowledgeCategoryBodySchema, knowledgeCategoryResponseSchema, knowledgeCategoryListResponseSchema, createKnowledgeItemSchema, updateKnowledgeItemBodySchema, deleteKnowledgeItemBodySchema, knowledgeItemResponseSchema, knowledgeItemListResponseSchema } from '../contracts/rest/knowledge';
import type { CreateKnowledgeSectionRequest, UpdateKnowledgeSectionRequest, CreateKnowledgeCategoryRequest, UpdateKnowledgeCategoryRequest, DeleteKnowledgeCategoryRequest, CreateKnowledgeItemRequest, UpdateKnowledgeItemRequest, DeleteKnowledgeItemRequest } from '../contracts/rest/knowledge';
import { listParamsSchema } from '../contracts/rest/common';
import type { ListParams } from '../contracts/rest/common';

/**
 * Controller for knowledge base management including sections, categories, and items
 */
@injectable()
@JsonController('/api/knowledge')
export class KnowledgeController {
  constructor(@inject(KnowledgeService) private readonly knowledgeService: KnowledgeService) {}

  // ============================================================
  // KNOWLEDGE SECTION ENDPOINTS
  // ============================================================

  /**
   * POST /api/knowledge/sections
   * Create a new knowledge section
   */
  @RequirePermissions([PERMISSIONS.KNOWLEDGE_WRITE])
  @OpenAPI({
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
  })
  @Post('/sections')
  @HttpCode(201)
  async createKnowledgeSection(@Validated(createKnowledgeSectionSchema) @Body() body: CreateKnowledgeSectionRequest, @Req() req: Request) {
    return await this.knowledgeService.createKnowledgeSection(body, req.context);
  }

  /**
   * GET /api/knowledge/sections/:id
   * Get a knowledge section by ID
   */
  @RequirePermissions([PERMISSIONS.KNOWLEDGE_READ])
  @OpenAPI({
    tags: ['Knowledge'],
    summary: 'Get knowledge section by ID',
    description: 'Retrieves a single knowledge section by its unique identifier',
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
  })
  @Get('/sections/:id')
  async getKnowledgeSectionById(@Param('id') id: string) {
    return await this.knowledgeService.getKnowledgeSectionById(id);
  }

  /**
   * GET /api/knowledge/sections
   * List knowledge sections with optional filters
   */
  @RequirePermissions([PERMISSIONS.KNOWLEDGE_READ])
  @OpenAPI({
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
  })
  @Get('/sections')
  async listKnowledgeSections(@Validated(listParamsSchema, 'query') @QueryParams() query: ListParams) {
    return await this.knowledgeService.listKnowledgeSections(query);
  }

  /**
   * PUT /api/knowledge/sections/:id
   * Update a knowledge section
   */
  @RequirePermissions([PERMISSIONS.KNOWLEDGE_WRITE])
  @OpenAPI({
    tags: ['Knowledge'],
    summary: 'Update knowledge section',
    description: 'Updates an existing knowledge section',
    request: {
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
  })
  @Put('/sections/:id')
  async updateKnowledgeSection(@Param('id') id: string, @Validated(updateKnowledgeSectionSchema) @Body() body: UpdateKnowledgeSectionRequest, @Req() req: Request) {
    return await this.knowledgeService.updateKnowledgeSection(id, body, req.context);
  }

  /**
   * DELETE /api/knowledge/sections/:id
   * Delete a knowledge section
   */
  @RequirePermissions([PERMISSIONS.KNOWLEDGE_DELETE])
  @OpenAPI({
    tags: ['Knowledge'],
    summary: 'Delete knowledge section',
    description: 'Deletes a knowledge section',
    responses: {
      204: { description: 'Knowledge section deleted successfully' },
      404: { description: 'Knowledge section not found' },
    },
  })
  @Delete('/sections/:id')
  @HttpCode(204)
  async deleteKnowledgeSection(@Param('id') id: string, @Req() req: Request) {
    await this.knowledgeService.deleteKnowledgeSection(id, req.context);
  }

  // ============================================================
  // KNOWLEDGE CATEGORY ENDPOINTS
  // ============================================================

  /**
   * POST /api/knowledge/categories
   * Create a new knowledge category
   */
  @RequirePermissions([PERMISSIONS.KNOWLEDGE_WRITE])
  @OpenAPI({
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
  })
  @Post('/categories')
  @HttpCode(201)
  async createKnowledgeCategory(@Validated(createKnowledgeCategorySchema) @Body() body: CreateKnowledgeCategoryRequest, @Req() req: Request) {
    return await this.knowledgeService.createKnowledgeCategory(body, req.context);
  }

  /**
   * GET /api/knowledge/categories/:id
   * Get a knowledge category by ID with its items
   */
  @RequirePermissions([PERMISSIONS.KNOWLEDGE_READ])
  @OpenAPI({
    tags: ['Knowledge'],
    summary: 'Get knowledge category by ID',
    description: 'Retrieves a single knowledge category with all its items by unique identifier',
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
  })
  @Get('/categories/:id')
  async getKnowledgeCategoryById(@Param('id') id: string) {
    return await this.knowledgeService.getKnowledgeCategoryById(id);
  }

  /**
   * GET /api/knowledge/categories
   * List knowledge categories with optional filters
   */
  @RequirePermissions([PERMISSIONS.KNOWLEDGE_READ])
  @OpenAPI({
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
  })
  @Get('/categories')
  async listKnowledgeCategories(@Validated(listParamsSchema, 'query') @QueryParams() query: ListParams) {
    return await this.knowledgeService.listKnowledgeCategories(query);
  }

  /**
   * PUT /api/knowledge/categories/:id
   * Update a knowledge category
   */
  @RequirePermissions([PERMISSIONS.KNOWLEDGE_WRITE])
  @OpenAPI({
    tags: ['Knowledge'],
    summary: 'Update knowledge category',
    description: 'Updates an existing knowledge category with optimistic locking',
    request: {
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
  })
  @Put('/categories/:id')
  async updateKnowledgeCategory(@Param('id') id: string, @Validated(updateKnowledgeCategoryBodySchema) @Body() body: UpdateKnowledgeCategoryRequest, @Req() req: Request) {
    const { version, ...updateData } = body;
    return await this.knowledgeService.updateKnowledgeCategory(id, updateData, version, req.context);
  }

  /**
   * DELETE /api/knowledge/categories/:id
   * Delete a knowledge category
   */
  @RequirePermissions([PERMISSIONS.KNOWLEDGE_DELETE])
  @OpenAPI({
    tags: ['Knowledge'],
    summary: 'Delete knowledge category',
    description: 'Deletes a knowledge category with optimistic locking. This will also delete all items in the category',
    request: {
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
  })
  @Delete('/categories/:id')
  @HttpCode(204)
  async deleteKnowledgeCategory(@Param('id') id: string, @Validated(deleteKnowledgeCategoryBodySchema) @Body() body: DeleteKnowledgeCategoryRequest, @Req() req: Request) {
    await this.knowledgeService.deleteKnowledgeCategory(id, body.version, req.context);
  }

  // ============================================================
  // KNOWLEDGE ITEM ENDPOINTS
  // ============================================================

  /**
   * POST /api/knowledge/items
   * Create a new knowledge item
   */
  @RequirePermissions([PERMISSIONS.KNOWLEDGE_WRITE])
  @OpenAPI({
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
  })
  @Post('/items')
  @HttpCode(201)
  async createKnowledgeItem(@Validated(createKnowledgeItemSchema) @Body() body: CreateKnowledgeItemRequest, @Req() req: Request) {
    return await this.knowledgeService.createKnowledgeItem(body, req.context);
  }

  /**
   * GET /api/knowledge/items/:id
   * Get a knowledge item by ID
   */
  @RequirePermissions([PERMISSIONS.KNOWLEDGE_READ])
  @OpenAPI({
    tags: ['Knowledge'],
    summary: 'Get knowledge item by ID',
    description: 'Retrieves a single knowledge item by its unique identifier',
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
  })
  @Get('/items/:id')
  async getKnowledgeItemById(@Param('id') id: string) {
    return await this.knowledgeService.getKnowledgeItemById(id);
  }

  /**
   * GET /api/knowledge/items
   * List knowledge items with optional filters
   */
  @RequirePermissions([PERMISSIONS.KNOWLEDGE_READ])
  @OpenAPI({
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
  })
  @Get('/items')
  async listKnowledgeItems(@Validated(listParamsSchema, 'query') @QueryParams() query: ListParams) {
    return await this.knowledgeService.listKnowledgeItems(query);
  }

  /**
   * PUT /api/knowledge/items/:id
   * Update a knowledge item
   */
  @RequirePermissions([PERMISSIONS.KNOWLEDGE_WRITE])
  @OpenAPI({
    tags: ['Knowledge'],
    summary: 'Update knowledge item',
    description: 'Updates an existing knowledge item with optimistic locking',
    request: {
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
  })
  @Put('/items/:id')
  async updateKnowledgeItem(@Param('id') id: string, @Validated(updateKnowledgeItemBodySchema) @Body() body: UpdateKnowledgeItemRequest, @Req() req: Request) {
    const { version, ...updateData } = body;
    return await this.knowledgeService.updateKnowledgeItem(id, updateData, version, req.context);
  }

  /**
   * DELETE /api/knowledge/items/:id
   * Delete a knowledge item
   */
  @RequirePermissions([PERMISSIONS.KNOWLEDGE_DELETE])
  @OpenAPI({
    tags: ['Knowledge'],
    summary: 'Delete knowledge item',
    description: 'Deletes a knowledge item with optimistic locking',
    request: {
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
  })
  @Delete('/items/:id')
  @HttpCode(204)
  async deleteKnowledgeItem(@Param('id') id: string, @Validated(deleteKnowledgeItemBodySchema) @Body() body: DeleteKnowledgeItemRequest, @Req() req: Request) {
    await this.knowledgeService.deleteKnowledgeItem(id, body.version, req.context);
  }

  /**
   * GET /api/knowledge/categories/:categoryId/items
   * Get all items for a specific category
   */
  @RequirePermissions([PERMISSIONS.KNOWLEDGE_READ])
  @OpenAPI({
    tags: ['Knowledge'],
    summary: 'Get items by category',
    description: 'Retrieves all knowledge items belonging to a specific category, ordered by their display order',
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
  })
  @Get('/categories/:categoryId/items')
  async getItemsByCategory(@Param('categoryId') categoryId: string) {
    return await this.knowledgeService.getItemsByCategory(categoryId);
  }
}
