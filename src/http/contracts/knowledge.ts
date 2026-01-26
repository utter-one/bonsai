import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema } from './common';
import type { ListParams } from './common';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };

// Route param schemas
export const knowledgeSectionRouteParamsSchema = z.object({
  id: z.string().describe('Knowledge section ID'),
});

export const knowledgeCategoryRouteParamsSchema = z.object({
  id: z.string().describe('Knowledge category ID'),
});

export const knowledgeItemRouteParamsSchema = z.object({
  id: z.string().describe('Knowledge item ID'),
});

export const knowledgeCategoryItemsRouteParamsSchema = z.object({
  categoryId: z.string().describe('Knowledge category ID'),
});

// ============================================================
// KNOWLEDGE SECTION SCHEMAS
// ============================================================

/**
 * Schema for creating a new knowledge section
 * Required fields: id, name
 */
export const createKnowledgeSectionSchema = z.object({
  id: z.string().min(1).describe('Unique identifier for the knowledge section'),
  name: z.string().min(1).describe('Name of the knowledge section'),
});

/**
 * Schema for updating a knowledge section
 * Required fields: name
 */
export const updateKnowledgeSectionSchema = z.object({
  name: z.string().min(1).describe('Updated name of the knowledge section'),
});

/**
 * Schema for knowledge section response
 * Includes: id, name, createdAt, updatedAt
 */
export const knowledgeSectionResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the knowledge section'),
  name: z.string().describe('Name of the knowledge section'),
  createdAt: z.coerce.date().describe('Timestamp when the section was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the section was last updated'),
});

/**
 * Schema for paginated list of knowledge sections
 */
export const knowledgeSectionListResponseSchema = z.object({
  items: z.array(knowledgeSectionResponseSchema).describe('Array of knowledge sections in the current page'),
  total: z.number().int().min(0).describe('Total number of sections matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: z.number().int().positive().nullable().describe('Maximum number of items per page (null if no limit)'),
});

/** Request body for creating a new knowledge section */
export type CreateKnowledgeSectionRequest = z.infer<typeof createKnowledgeSectionSchema>;

/** Request body for updating a knowledge section */
export type UpdateKnowledgeSectionRequest = z.infer<typeof updateKnowledgeSectionSchema>;

/** Response for a single knowledge section */
export type KnowledgeSectionResponse = z.infer<typeof knowledgeSectionResponseSchema>;

/** Response for paginated list of knowledge sections */
export type KnowledgeSectionListResponse = z.infer<typeof knowledgeSectionListResponseSchema>;

// ============================================================
// KNOWLEDGE CATEGORY SCHEMAS
// ============================================================

/**
 * Schema for creating a new knowledge category
 * Required fields: id, name, promptTrigger
 * Optional fields: knowledgeSections, order
 */
export const createKnowledgeCategorySchema = z.object({
  id: z.string().min(1).describe('Unique identifier for the knowledge category'),
  projectId: z.string().min(1).describe('ID of the project this knowledge category belongs to'),
  name: z.string().min(1).describe('Name of the knowledge category'),
  promptTrigger: z.string().min(1).describe('Trigger phrase that activates this category in conversations'),
  knowledgeSections: z.array(z.string()).optional().describe('Array of knowledge section IDs this category belongs to'),
  order: z.number().int().min(0).optional().describe('Display order for the category (default: 0)'),
});

/**
 * Schema for updating a knowledge category
 * Optional fields: name, promptTrigger, knowledgeSections, order, version
 * Version is required for optimistic locking
 */
export const updateKnowledgeCategoryBodySchema = z.object({
  name: z.string().min(1).optional().describe('Updated name of the category'),
  promptTrigger: z.string().min(1).optional().describe('Updated trigger phrase'),
  knowledgeSections: z.array(z.string()).optional().describe('Updated array of knowledge section IDs'),
  order: z.number().int().min(0).optional().describe('Updated display order'),
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for deleting a knowledge category
 * Required field: version for optimistic locking
 */
export const deleteKnowledgeCategoryBodySchema = z.object({
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for knowledge item within a category (nested in category response)
 */
export const knowledgeItemInCategorySchema = z.object({
  id: z.string().describe('Unique identifier for the knowledge item'),
  categoryId: z.string().describe('ID of the category this item belongs to'),
  question: z.string().describe('Question text for this knowledge item'),
  answer: z.string().describe('Answer text for this knowledge item'),
  order: z.number().int().describe('Display order within the category'),
  version: z.number().int().describe('Version number for optimistic locking'),
  createdAt: z.coerce.date().describe('Timestamp when the item was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the item was last updated'),
});

/**
 * Schema for knowledge category response
 * Includes: id, name, promptTrigger, knowledgeSections, order, items, version, createdAt, updatedAt
 */
export const knowledgeCategoryResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the knowledge category'),
  projectId: z.string().describe('ID of the project this knowledge category belongs to'),
  name: z.string().describe('Name of the knowledge category'),
  promptTrigger: z.string().describe('Trigger phrase that activates this category'),
  knowledgeSections: z.array(z.string()).describe('Array of knowledge section IDs'),
  order: z.number().int().describe('Display order for the category'),
  items: z.array(knowledgeItemInCategorySchema).optional().describe('Knowledge items within this category'),
  version: z.number().int().describe('Version number for optimistic locking'),
  createdAt: z.coerce.date().describe('Timestamp when the category was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the category was last updated'),
});

/**
 * Schema for paginated list of knowledge categories
 */
export const knowledgeCategoryListResponseSchema = z.object({
  items: z.array(knowledgeCategoryResponseSchema).describe('Array of knowledge categories in the current page'),
  total: z.number().int().min(0).describe('Total number of categories matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: z.number().int().positive().nullable().describe('Maximum number of items per page (null if no limit)'),
});

/** Request body for creating a new knowledge category */
export type CreateKnowledgeCategoryRequest = z.infer<typeof createKnowledgeCategorySchema>;

/** Request body for updating a knowledge category */
export type UpdateKnowledgeCategoryRequest = z.infer<typeof updateKnowledgeCategoryBodySchema>;

/** Request body for deleting a knowledge category */
export type DeleteKnowledgeCategoryRequest = z.infer<typeof deleteKnowledgeCategoryBodySchema>;

/** Response for a single knowledge category */
export type KnowledgeCategoryResponse = z.infer<typeof knowledgeCategoryResponseSchema>;

/** Response for paginated list of knowledge categories */
export type KnowledgeCategoryListResponse = z.infer<typeof knowledgeCategoryListResponseSchema>;

// ============================================================
// KNOWLEDGE ITEM SCHEMAS
// ============================================================

/**
 * Schema for creating a new knowledge item
 * Required fields: id, categoryId, question, answer
 * Optional fields: order
 */
export const createKnowledgeItemSchema = z.object({
  id: z.string().min(1).describe('Unique identifier for the knowledge item'),
  categoryId: z.string().min(1).describe('ID of the category this item belongs to'),
  question: z.string().min(1).describe('Question text for this knowledge item'),
  answer: z.string().min(1).describe('Answer text for this knowledge item'),
  order: z.number().int().min(0).optional().describe('Display order within the category (default: 0)'),
});

/**
 * Schema for updating a knowledge item
 * Optional fields: categoryId, question, answer, order, version
 * Version is required for optimistic locking
 */
export const updateKnowledgeItemBodySchema = z.object({
  categoryId: z.string().min(1).optional().describe('Updated category ID'),
  question: z.string().min(1).optional().describe('Updated question text'),
  answer: z.string().min(1).optional().describe('Updated answer text'),
  order: z.number().int().min(0).optional().describe('Updated display order'),
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for deleting a knowledge item
 * Required field: version for optimistic locking
 */
export const deleteKnowledgeItemBodySchema = z.object({
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for knowledge item response
 * Includes: id, categoryId, question, answer, order, version, createdAt, updatedAt
 */
export const knowledgeItemResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the knowledge item'),
  categoryId: z.string().describe('ID of the category this item belongs to'),
  question: z.string().describe('Question text for this knowledge item'),
  answer: z.string().describe('Answer text for this knowledge item'),
  order: z.number().int().describe('Display order within the category'),
  version: z.number().int().describe('Version number for optimistic locking'),
  createdAt: z.coerce.date().describe('Timestamp when the item was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the item was last updated'),
});

/**
 * Schema for paginated list of knowledge items
 */
export const knowledgeItemListResponseSchema = z.object({
  items: z.array(knowledgeItemResponseSchema).describe('Array of knowledge items in the current page'),
  total: z.number().int().min(0).describe('Total number of items matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: z.number().int().positive().nullable().describe('Maximum number of items per page (null if no limit)'),
});

/** Request body for creating a new knowledge item */
export type CreateKnowledgeItemRequest = z.infer<typeof createKnowledgeItemSchema>;

/** Request body for updating a knowledge item */
export type UpdateKnowledgeItemRequest = z.infer<typeof updateKnowledgeItemBodySchema>;

/** Request body for deleting a knowledge item */
export type DeleteKnowledgeItemRequest = z.infer<typeof deleteKnowledgeItemBodySchema>;

/** Response for a single knowledge item */
export type KnowledgeItemResponse = z.infer<typeof knowledgeItemResponseSchema>;

/** Response for paginated list of knowledge items */
export type KnowledgeItemListResponse = z.infer<typeof knowledgeItemListResponseSchema>;
