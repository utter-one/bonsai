import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema, listResponseLimitSchema } from './common';
import type { ListParams } from './common';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };

export const copyDecoratorRouteParamsSchema = z.object({
  projectId: z.string().min(1).describe('Project ID'),
  id: z.string().describe('Copy Decorator ID'),
});

/**
 * Schema for creating a new copy decorator
 * Required fields: name, template
 * Optional fields: id
 */
export const createCopyDecoratorSchema = z.object({
  id: z.string().min(1).optional().describe('Unique identifier for the copy decorator (auto-generated if not provided)'),
  name: z.string().min(1).describe('Human-readable display name of the copy decorator'),
  template: z.string().min(1).describe('Template string used to decorate selected sample copy content'),
});

/**
 * Schema for updating a copy decorator
 * All fields are optional except version for optimistic locking
 */
export const updateCopyDecoratorBodySchema = z.object({
  name: z.string().min(1).optional().describe('Updated display name'),
  template: z.string().min(1).optional().describe('Updated template string'),
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for deleting a copy decorator
 * Required field: version for optimistic locking
 */
export const deleteCopyDecoratorBodySchema = z.object({
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for copy decorator response
 * Includes all fields from the database schema
 */
export const copyDecoratorResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the copy decorator'),
  projectId: z.string().describe('ID of the project this copy decorator belongs to'),
  name: z.string().describe('Human-readable display name of the copy decorator'),
  template: z.string().describe('Template string used to decorate sample copy content'),
  version: z.number().int().describe('Version number for optimistic locking'),
  createdAt: z.coerce.date().describe('Timestamp when the copy decorator was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the copy decorator was last updated'),
  archived: z.boolean().optional().describe('Whether this entity belongs to an archived project'),
});

/**
 * Schema for paginated list of copy decorators
 * Includes pagination metadata: items, total count, offset, and limit
 */
export const copyDecoratorListResponseSchema = z.object({
  items: z.array(copyDecoratorResponseSchema).describe('Array of copy decorators in the current page'),
  total: z.number().int().min(0).describe('Total number of copy decorators matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: listResponseLimitSchema,
});

/** Request body for creating a new copy decorator */
export type CreateCopyDecoratorRequest = z.infer<typeof createCopyDecoratorSchema>;

/** Request body for updating a copy decorator */
export type UpdateCopyDecoratorRequest = z.infer<typeof updateCopyDecoratorBodySchema>;

/** Request body for deleting a copy decorator */
export type DeleteCopyDecoratorRequest = z.infer<typeof deleteCopyDecoratorBodySchema>;

/** Response for a single copy decorator */
export type CopyDecoratorResponse = z.infer<typeof copyDecoratorResponseSchema>;

/** Response for paginated list of copy decorators with metadata */
export type CopyDecoratorListResponse = z.infer<typeof copyDecoratorListResponseSchema>;
