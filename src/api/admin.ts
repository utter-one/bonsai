import { z } from 'zod';
import { listParamsSchema } from './common';
import type { ListParams } from './common';

export { listParamsSchema, type ListParams };

/**
 * Schema for creating a new admin user
 * Required fields: id, displayName, roles (at least one), password
 * Optional fields: metadata
 */
export const createAdminSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  roles: z.array(z.string().min(1)).min(1),
  password: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Schema for updating an admin user
 * Required fields: version (for optimistic locking)
 * Optional fields: displayName, roles, password, metadata
 */
export const updateAdminBodySchema = z.object({
  version: z.number().int().positive(),
  displayName: z.string().min(1).optional(),
  roles: z.array(z.string().min(1)).min(1).optional(),
  password: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Schema for deleting an admin user
 * Required fields: version (for optimistic locking to prevent concurrent deletions)
 */
export const deleteAdminBodySchema = z.object({
  version: z.number().int().positive(),
});

/**
 * Schema for admin user response
 * Excludes password field for security
 * Includes: id, displayName, roles, metadata, version, createdAt, updatedAt
 */
export const adminResponseSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  roles: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()).optional(),
  version: z.number().int(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

/**
 * Schema for paginated list of admin users
 * Includes pagination metadata: items, total count, offset, and limit
 */
export const adminListResponseSchema = z.object({
  items: z.array(adminResponseSchema),
  total: z.number().int().min(0),
  offset: z.number().int().min(0),
  limit: z.number().int().positive().nullable(),
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
