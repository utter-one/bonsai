import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema } from './common';
import type { ListParams } from './common';
import { ROLES } from '../../permissions';

extendZodWithOpenApi(z);

/**
 * Valid role names that can be assigned to admin users
 */
export const VALID_ROLES = Object.keys(ROLES) as [string, ...string[]];

export { listParamsSchema, type ListParams };

/**
 * Schema for admin route parameters (ID param)
 */
export const adminRouteParamsSchema = z.object({
  id: z.string().min(1).describe('Admin user ID'),
});

/**
 * Schema for creating a new admin user
 * Required fields: id, name, roles (at least one), password
 * Optional fields: metadata
 */
export const createAdminSchema = z.object({
  id: z.string().min(1).describe('Unique identifier for the admin user (auto-generated if not provided)'),
  name: z.string().min(1).describe('Display name for the admin user'),
  roles: z.array(z.enum(VALID_ROLES)).min(1).describe(`Array of role identifiers assigned to the admin (at least one required). Valid roles: ${VALID_ROLES.join(', ')}`),
  password: z.string().min(1).describe('Admin user password (will be hashed)'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Optional metadata as key-value pairs'),
});

/**
 * Schema for updating an admin user
 * Required fields: version (for optimistic locking)
 * Optional fields: name, roles, password, metadata
 */
export const updateAdminBodySchema = z.object({
  version: z.number().int().positive().describe('Current version number for optimistic locking (prevents concurrent updates)'),
  name: z.string().min(1).optional().describe('Updated display name for the admin user'),
  roles: z.array(z.enum(VALID_ROLES)).min(1).optional().describe(`Updated array of role identifiers. Valid roles: ${VALID_ROLES.join(', ')}`),
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
 * Schema for updating the logged-in admin's own profile
 * Allows changing display name and/or password
 * If changing password, old password is required for verification
 */
export const updateProfileSchema = z.object({
  name: z.string().min(1).optional().describe('Updated display name for the admin user'),
  oldPassword: z.string().min(1).optional().describe('Current password (required when changing password)'),
  newPassword: z.string().min(1).optional().describe('New password to set (requires oldPassword)'),
});

/**
 * Schema for profile response (subset of admin response)
 * Includes: id, name, roles, metadata, version, createdAt, updatedAt
 */
export const profileResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the admin user'),
  name: z.string().describe('Display name of the admin user'),
  roles: z.array(z.string()).describe('Array of role identifiers assigned to the admin'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Metadata as key-value pairs'),
  version: z.number().int().describe('Current version number for optimistic locking'),
  createdAt: z.coerce.date().describe('Timestamp when the admin user was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the admin user was last updated'),
});

/**
 * Schema for admin user response
 * Excludes password field for security
 * Includes: id, name, roles, metadata, version, createdAt, updatedAt
 */
export const adminResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the admin user'),
  name: z.string().describe('Display name of the admin user'),
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

/** Route parameters for admin endpoints */
export type AdminRouteParams = z.infer<typeof adminRouteParamsSchema>;

/** Request body for updating the logged-in admin's profile */
export type UpdateProfileRequest = z.infer<typeof updateProfileSchema>;

/** Response for profile information */
export type ProfileResponse = z.infer<typeof profileResponseSchema>;
