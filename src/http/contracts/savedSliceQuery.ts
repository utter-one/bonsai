import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { sliceQuerySchema } from './sliceAnalytics';

extendZodWithOpenApi(z);

/**
 * Schema for creating a new saved slice query.
 * The query must have a name unique within the project.
 */
export const createSavedSliceQuerySchema = z.object({
  name: z.string().min(1).max(255).describe('Unique name for this saved query within the project'),
  query: sliceQuerySchema.describe('The full slice query configuration to save'),
  isShared: z.boolean().default(false).describe('Whether this query is visible to all operators in the project'),
  metadata: z.record(z.string(), z.unknown()).nullable().optional().describe('Arbitrary key-value metadata, e.g. chart display settings from the UI'),
});

/**
 * Schema for updating an existing saved slice query.
 * All content fields are optional; version is required for optimistic locking.
 */
export const updateSavedSliceQuerySchema = z.object({
  name: z.string().min(1).max(255).optional().describe('Updated name for this saved query'),
  query: sliceQuerySchema.optional().describe('Updated slice query configuration'),
  isShared: z.boolean().optional().describe('Updated sharing flag'),
  metadata: z.record(z.string(), z.unknown()).nullable().optional().describe('Arbitrary key-value metadata, e.g. chart display settings from the UI'),
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for the request body of a delete saved slice query operation.
 * Version is required for optimistic locking.
 */
export const deleteSavedSliceQueryBodySchema = z.object({
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for the saved slice query API response.
 */
export const savedSliceQueryResponseSchema = z.object({
  id: z.string().describe('Unique identifier of the saved query'),
  name: z.string().describe('Name of the saved query'),
  projectId: z.string().describe('Project this query belongs to'),
  operatorId: z.string().nullable().describe('Operator who created this query, or null if the operator has been deleted'),
  query: sliceQuerySchema.describe('The saved slice query configuration'),
  isShared: z.boolean().describe('Whether this query is visible to all operators in the project'),
  metadata: z.record(z.string(), z.unknown()).nullable().describe('Arbitrary key-value metadata, e.g. chart display settings from the UI'),
  version: z.number().int().describe('Version number for optimistic locking'),
  createdAt: z.coerce.date().describe('Timestamp when the query was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the query was last updated'),
}).openapi('SavedSliceQuery');

/**
 * Schema for route parameters that include both projectId and saved query id.
 */
export const savedSliceQueryRouteParamsSchema = z.object({
  projectId: z.string().describe('Project identifier'),
  id: z.string().describe('Saved query identifier'),
});

export type CreateSavedSliceQueryRequest = z.infer<typeof createSavedSliceQuerySchema>;
export type UpdateSavedSliceQueryRequest = z.infer<typeof updateSavedSliceQuerySchema>;
export type DeleteSavedSliceQueryRequest = z.infer<typeof deleteSavedSliceQueryBodySchema>;
export type SavedSliceQueryResponse = z.infer<typeof savedSliceQueryResponseSchema>;
