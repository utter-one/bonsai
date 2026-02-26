import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema } from './common';
import type { ListParams } from './common';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };

/**
 * Schema for flow route parameters
 */
export const flowRouteParamsSchema = z.object({
  projectId: z.string().min(1).describe('Project ID'),
  id: z.string().min(1).describe('Flow ID'),
});

export type FlowRouteParams = z.infer<typeof flowRouteParamsSchema>;

/**
 * Schema for creating a new flow
 * Required fields: name
 * Optional fields: id, description, metadata
 */
export const createFlowSchema = z.object({
  id: z.string().min(1).optional().describe('Unique identifier for the flow (auto-generated if not provided)'),
  name: z.string().min(1).describe('Display name of the flow'),
  description: z.string().nullable().optional().describe('Optional description of the flow'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Additional flow-specific metadata'),
});

/**
 * Schema for updating a flow
 * All fields are optional except version for optimistic locking
 */
export const updateFlowBodySchema = z.object({
  name: z.string().min(1).optional().describe('Updated display name'),
  description: z.string().nullable().optional().describe('Updated description'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Updated metadata'),
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for deleting a flow
 * Required field: version for optimistic locking
 */
export const deleteFlowBodySchema = z.object({
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for flow response
 * Includes all fields from the database schema
 */
export const flowResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the flow'),
  projectId: z.string().describe('ID of the project this flow belongs to'),
  name: z.string().describe('Display name of the flow'),
  description: z.string().nullable().describe('Optional description of the flow'),
  metadata: z.record(z.string(), z.unknown()).nullable().describe('Additional metadata'),
  version: z.number().int().describe('Version number for optimistic locking'),
  createdAt: z.coerce.date().describe('Timestamp when the flow was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the flow was last updated'),
});

/**
 * Schema for paginated list of flows
 * Includes pagination metadata: items, total count, offset, and limit
 */
export const flowListResponseSchema = z.object({
  items: z.array(flowResponseSchema).describe('Array of flows in the current page'),
  total: z.number().int().min(0).describe('Total number of flows matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: z.number().int().positive().nullable().describe('Maximum number of items per page (null if no limit)'),
});

/**
 * Schema for cloning a flow
 * All fields are optional - id defaults to auto-generated, name defaults to "{original name} (Clone)"
 */
export const cloneFlowSchema = z.object({
  id: z.string().min(1).optional().describe('New ID for the cloned flow (auto-generated if not provided)'),
  name: z.string().min(1).optional().describe('Name for the cloned flow (defaults to "{original name} (Clone)")'),
});

/** Request body for creating a new flow */
export type CreateFlowRequest = z.infer<typeof createFlowSchema>;

/** Request body for updating a flow */
export type UpdateFlowRequest = z.infer<typeof updateFlowBodySchema>;

/** Request body for deleting a flow */
export type DeleteFlowRequest = z.infer<typeof deleteFlowBodySchema>;

/** Request body for cloning a flow */
export type CloneFlowRequest = z.infer<typeof cloneFlowSchema>;

/** Response for a single flow */
export type FlowResponse = z.infer<typeof flowResponseSchema>;

/** Response for paginated list of flows with metadata */
export type FlowListResponse = z.infer<typeof flowListResponseSchema>;
