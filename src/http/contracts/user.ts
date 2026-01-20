import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema } from './common';
import type { ListParams } from './common';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };

/**
 * Schema for creating a new user
 * Required fields: id, profile
 * Profile is a flexible JSON object containing user-specific data
 */
export const createUserSchema = z.object({
  id: z.string().min(1).describe('Unique identifier for the user'),
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
 * Includes: id, profile, createdAt, updatedAt
 */
export const userResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the user'),
  profile: z.record(z.string(), z.unknown()).describe('User profile data as key-value pairs'),
  createdAt: z.coerce.date().describe('Timestamp when the user was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the user was last updated'),
});

/**
 * Schema for paginated list of users
 * Includes pagination metadata: items, total count, offset, and limit
 */
export const userListResponseSchema = z.object({
  items: z.array(userResponseSchema).describe('Array of users in the current page'),
  total: z.number().int().min(0).describe('Total number of users matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: z.number().int().positive().nullable().describe('Maximum number of items per page (null if no limit)'),
});

/** Request body for creating a new user */
export type CreateUserRequest = z.infer<typeof createUserSchema>;

/** Request body for updating a user */
export type UpdateUserRequest = z.infer<typeof updateUserBodySchema>;

/** Response for a single user */
export type UserResponse = z.infer<typeof userResponseSchema>;

/** Response for paginated list of users with metadata */
export type UserListResponse = z.infer<typeof userListResponseSchema>;
