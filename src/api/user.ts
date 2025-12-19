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
  id: z.string().min(1),
  profile: z.record(z.string(), z.unknown()),
});

/**
 * Schema for updating a user
 * Optional fields: profile
 * Profile updates are merged with existing profile data
 */
export const updateUserBodySchema = z.object({
  profile: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Schema for user response
 * Includes: id, profile, createdAt, updatedAt
 */
export const userResponseSchema = z.object({
  id: z.string(),
  profile: z.record(z.string(), z.unknown()),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

/**
 * Schema for paginated list of users
 * Includes pagination metadata: items, total count, offset, and limit
 */
export const userListResponseSchema = z.object({
  items: z.array(userResponseSchema),
  total: z.number().int().min(0),
  offset: z.number().int().min(0),
  limit: z.number().int().positive().nullable(),
});

/** Request body for creating a new user */
export type CreateUserRequest = z.infer<typeof createUserSchema>;

/** Request body for updating a user */
export type UpdateUserRequest = z.infer<typeof updateUserBodySchema>;

/** Response for a single user */
export type UserResponse = z.infer<typeof userResponseSchema>;

/** Response for paginated list of users with metadata */
export type UserListResponse = z.infer<typeof userListResponseSchema>;
