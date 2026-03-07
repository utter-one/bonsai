import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema, listResponseLimitSchema } from './common';
import type { ListParams } from './common';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };

/**
 * Schema for project-level route parameters (e.g. /api/projects/:projectId/users)
 */
export const userProjectRouteParamsSchema = z.object({
  projectId: z.string().min(1).describe('Project ID'),
});

export type UserProjectRouteParams = z.infer<typeof userProjectRouteParamsSchema>;

/**
 * Schema for user route parameters (e.g. /api/projects/:projectId/users/:id)
 */
export const userRouteParamsSchema = z.object({
  projectId: z.string().min(1).describe('Project ID'),
  id: z.string().min(1).describe('User ID'),
});

export type UserRouteParams = z.infer<typeof userRouteParamsSchema>;

/**
 * Schema for creating a new user
 * Required fields: profile
 * Profile is a flexible JSON object containing user-specific data
 */
export const createUserSchema = z.object({
  id: z.string().min(1).optional().describe('Unique identifier for the user (auto-generated if not provided)'),
  profile: z.record(z.string(), z.unknown()).describe('User profile data as flexible key-value pairs'),
});

/**
 * Schema for updating a user
 * Optional fields: profile
 * Profile updates are merged with existing profile data
 */
export const updateUserBodySchema = z.object({
  profile: z.record(z.string(), z.unknown()).optional().describe('Updated profile data (merges with existing profile)'),
});

/**
 * Schema for user response
 * Includes: id, projectId, profile, createdAt, updatedAt
 */
export const userResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the user'),
  projectId: z.string().describe('Project this user belongs to'),
  profile: z.record(z.string(), z.unknown()).describe('User profile data as key-value pairs'),
  createdAt: z.coerce.date().describe('Timestamp when the user was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the user was last updated'),
  archived: z.boolean().optional().describe('Whether this entity belongs to an archived project'),
});

/**
 * Schema for paginated list of users
 * Includes pagination metadata: items, total count, offset, and limit
 */
export const userListResponseSchema = z.object({
  items: z.array(userResponseSchema).describe('Array of users in the current page'),
  total: z.number().int().min(0).describe('Total number of users matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: listResponseLimitSchema,
});

/** Request body for creating a new user */
export type CreateUserRequest = z.infer<typeof createUserSchema>;

/** Request body for updating a user */
export type UpdateUserRequest = z.infer<typeof updateUserBodySchema>;

/** Response for a single user */
export type UserResponse = z.infer<typeof userResponseSchema>;

/** Response for paginated list of users with metadata */
export type UserListResponse = z.infer<typeof userListResponseSchema>;
