import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema } from './common';
import type { ListParams } from './common';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };

/**
 * Schema for creating a new admin user
 * Required fields: id, displayName, roles (at least one), password
 * Optional fields: metadata
 */
export const createAdminSchema = z.object({
  id: z.string().min(1).describe('Unique identifier for the admin user'),
  displayName: z.string().min(1).describe('Display name for the admin user'),
  roles: z.array(z.string().min(1)).min(1).describe('Array of role identifiers assigned to the admin (at least one required)'),
  password: z.string().min(1).describe('Admin user password (will be hashed)'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Optional metadata as key-value pairs'),
});

/**
 * Schema for updating an admin user
 * Required fields: version (for optimistic locking)
 * Optional fields: displayName, roles, password, metadata
 */
export const updateAdminBodySchema = z.object({
  version: z.number().int().positive().describe('Current version number for optimistic locking (prevents concurrent updates)'),
  displayName: z.string().min(1).optional().describe('Updated display name for the admin user'),
  roles: z.array(z.string().min(1)).min(1).optional().describe('Updated array of role identifiers'),
  password: z.string().min(1).optional().describe('New password (will be hashed)'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Updated metadata (merges with existing)'),
});

/**
 * Schema for deleting an admin user
 * Required fields: version (for optimistic locking to prevent concurrent deletions)
 */
export const deleteAdminBodySchema = z.object({
  version: z.number().int().positive().describe('Current version number for optimistic locking (prevents concurrent deletions)'),
});

/**
 * Schema for admin user response
 * Excludes password field for security
 * Includes: id, displayName, roles, metadata, version, createdAt, updatedAt
 */
export const adminResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the admin user'),
  displayName: z.string().describe('Display name of the admin user'),
  roles: z.array(z.string()).describe('Array of role identifiers assigned to the admin'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Metadata as key-value pairs'),
  version: z.number().int().describe('Current version number for optimistic locking'),
  createdAt: z.coerce.date().describe('Timestamp when the admin user was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the admin user was last updated'),
});

/**
 * Schema for paginated list of admin users
 * Includes pagination metadata: items, total count, offset, and limit
 */
export const adminListResponseSchema = z.object({
  items: z.array(adminResponseSchema).describe('Array of admin users in the current page'),
  total: z.number().int().min(0).describe('Total number of admin users matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: z.number().int().positive().nullable().describe('Maximum number of items per page (null if no limit)'),
});

/** Request body for creating a new admin user */
export type CreateAdminRequest = z.infer<typeof createAdminSchema>;

/** Request body for updating an admin user (includes version for optimistic locking) */
export type UpdateAdminRequest = z.infer<typeof updateAdminBodySchema>;

/** Request body for deleting an admin user (includes version for optimistic locking) */
export type DeleteAdminRequest = z.infer<typeof deleteAdminBodySchema>;

/** Response for a single admin user (excludes password) */
export type AdminResponse = z.infer<typeof adminResponseSchema>;

/** Response for paginated list of admin users with metadata */
export type AdminListResponse = z.infer<typeof adminListResponseSchema>;
