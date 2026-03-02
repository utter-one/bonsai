import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema } from './common';
import type { ListParams } from './common';
import { ROLES } from '../../permissions';

extendZodWithOpenApi(z);

/**
 * Valid role names that can be assigned to operator users
 */
export const VALID_ROLES = Object.keys(ROLES) as [string, ...string[]];

export { listParamsSchema, type ListParams };

/**
 * Schema for operator route parameters (ID param)
 */
export const operatorRouteParamsSchema = z.object({
  id: z.string().min(1).describe('Operator user ID'),
});

/**
 * Schema for creating a new operator user
 * Required fields: id, name, roles (at least one), password
 * Optional fields: metadata
 */
export const createOperatorSchema = z.object({
  id: z.string().min(1).describe('Unique identifier for the operator user (auto-generated if not provided)'),
  name: z.string().min(1).describe('Display name for the operator user'),
  roles: z.array(z.enum(VALID_ROLES)).min(1).describe(`Array of role identifiers assigned to the operator (at least one required). Valid roles: ${VALID_ROLES.join(', ')}`),
  password: z.string().min(1).describe('Operator user password (will be hashed)'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Optional metadata as key-value pairs'),
});

/**
 * Schema for updating an operator user
 * Required fields: version (for optimistic locking)
 * Optional fields: name, roles, password, metadata
 */
export const updateOperatorBodySchema = z.object({
  version: z.number().int().positive().describe('Current version number for optimistic locking (prevents concurrent updates)'),
  name: z.string().min(1).optional().describe('Updated display name for the operator user'),
  roles: z.array(z.enum(VALID_ROLES)).min(1).optional().describe(`Updated array of role identifiers. Valid roles: ${VALID_ROLES.join(', ')}`),
  password: z.string().min(1).optional().describe('New password (will be hashed)'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Updated metadata (merges with existing)'),
});

/**
 * Schema for deleting an operator user
 * Required fields: version (for optimistic locking to prevent concurrent deletions)
 */
export const deleteOperatorBodySchema = z.object({
  version: z.number().int().positive().describe('Current version number for optimistic locking (prevents concurrent deletions)'),
});

/**
 * Schema for updating the logged-in operator's own profile
 * Allows changing display name and/or password
 * If changing password, old password is required for verification
 */
export const updateProfileSchema = z.object({
  name: z.string().min(1).optional().describe('Updated display name for the operator user'),
  oldPassword: z.string().min(1).optional().describe('Current password (required when changing password)'),
  newPassword: z.string().min(1).optional().describe('New password to set (requires oldPassword)'),
});

/**
 * Schema for profile response (subset of operator response)
 * Includes: id, name, roles, metadata, version, createdAt, updatedAt
 */
export const profileResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the operator user'),
  name: z.string().describe('Display name of the operator user'),
  roles: z.array(z.string()).describe('Array of role identifiers assigned to the operator'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Metadata as key-value pairs'),
  version: z.number().int().describe('Current version number for optimistic locking'),
  createdAt: z.coerce.date().describe('Timestamp when the operator user was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the operator user was last updated'),
});

/**
 * Schema for operator user response
 * Excludes password field for security
 * Includes: id, name, roles, metadata, version, createdAt, updatedAt
 */
export const operatorResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the operator user'),
  name: z.string().describe('Display name of the operator user'),
  roles: z.array(z.string()).describe('Array of role identifiers assigned to the operator'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Metadata as key-value pairs'),
  version: z.number().int().describe('Current version number for optimistic locking'),
  createdAt: z.coerce.date().describe('Timestamp when the operator user was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the operator user was last updated'),
});

/**
 * Schema for paginated list of operator users
 * Includes pagination metadata: items, total count, offset, and limit
 */
export const operatorListResponseSchema = z.object({
  items: z.array(operatorResponseSchema).describe('Array of operator users in the current page'),
  total: z.number().int().min(0).describe('Total number of operator users matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: z.number().int().positive().nullable().describe('Maximum number of items per page (null if no limit)'),
});

/** Request body for creating a new operator user */
export type CreateOperatorRequest = z.infer<typeof createOperatorSchema>;

/** Request body for updating an operator user (includes version for optimistic locking) */
export type UpdateOperatorRequest = z.infer<typeof updateOperatorBodySchema>;

/** Request body for deleting an operator user (includes version for optimistic locking) */
export type DeleteOperatorRequest = z.infer<typeof deleteOperatorBodySchema>;

/** Response for a single operator user (excludes password) */
export type OperatorResponse = z.infer<typeof operatorResponseSchema>;

/** Response for paginated list of operator users with metadata */
export type OperatorListResponse = z.infer<typeof operatorListResponseSchema>;

/** Route parameters for operator endpoints */
export type OperatorRouteParams = z.infer<typeof operatorRouteParamsSchema>;

/** Request body for updating the logged-in operator's profile */
export type UpdateProfileRequest = z.infer<typeof updateProfileSchema>;

/** Response for profile information */
export type ProfileResponse = z.infer<typeof profileResponseSchema>;
