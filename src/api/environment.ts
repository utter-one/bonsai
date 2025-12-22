import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema } from './common';
import type { ListParams } from './common';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };

/**
 * Schema for creating a new environment
 * Required fields: id, description, url, login, password
 * Note: Environments are used for data migration between server instances
 */
export const createEnvironmentSchema = z.object({
  id: z.string().min(1).describe('Unique identifier for the environment'),
  description: z.string().min(1).describe('Human-readable description of the environment'),
  url: z.string().url().describe('Base URL of the target server instance'),
  login: z.string().min(1).describe('Authentication login/username for the environment'),
  password: z.string().min(1).describe('Authentication password for the environment'),
});

/**
 * Schema for updating an environment
 * All fields are optional except version for optimistic locking
 */
export const updateEnvironmentBodySchema = z.object({
  description: z.string().min(1).optional().describe('Updated environment description'),
  url: z.string().url().optional().describe('Updated base URL'),
  login: z.string().min(1).optional().describe('Updated authentication login'),
  password: z.string().min(1).optional().describe('Updated authentication password'),
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for deleting an environment
 * Required field: version for optimistic locking
 */
export const deleteEnvironmentBodySchema = z.object({
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for environment response
 * Includes all fields from the database schema except password (for security)
 */
export const environmentResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the environment'),
  description: z.string().describe('Human-readable description of the environment'),
  url: z.string().describe('Base URL of the target server instance'),
  login: z.string().describe('Authentication login/username'),
  version: z.number().int().describe('Version number for optimistic locking'),
  createdAt: z.coerce.date().describe('Timestamp when the environment was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the environment was last updated'),
});

/**
 * Schema for paginated list of environments
 * Includes pagination metadata: items, total count, offset, and limit
 */
export const environmentListResponseSchema = z.object({
  items: z.array(environmentResponseSchema).describe('Array of environments in the current page'),
  total: z.number().int().min(0).describe('Total number of environments matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: z.number().int().positive().nullable().describe('Maximum number of items per page (null if no limit)'),
});

/** Request body for creating a new environment */
export type CreateEnvironmentRequest = z.infer<typeof createEnvironmentSchema>;

/** Request body for updating an environment */
export type UpdateEnvironmentRequest = z.infer<typeof updateEnvironmentBodySchema>;

/** Request body for deleting an environment */
export type DeleteEnvironmentRequest = z.infer<typeof deleteEnvironmentBodySchema>;

/** Response for a single environment (without password) */
export type EnvironmentResponse = z.infer<typeof environmentResponseSchema>;

/** Response for paginated list of environments with metadata */
export type EnvironmentListResponse = z.infer<typeof environmentListResponseSchema>;
