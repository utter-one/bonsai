import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

/**
 * Schema for checking system setup status
 * Returns whether the system has been initialized with an admin account
 */
export const setupStatusResponseSchema = z.object({
  isSetup: z.boolean().describe('Whether the system has been set up with at least one admin account'),
  message: z.string().describe('Descriptive message about the setup status'),
});

/**
 * Schema for creating the initial admin account during system setup
 * Required fields: id, name, password
 * The admin will automatically receive all permissions (super_admin role)
 */
export const initialAdminSetupSchema = z.object({
  id: z.string().min(1).describe('Unique identifier for the admin user (typically an email address)'),
  name: z.string().min(1).describe('Display name for the admin user'),
  password: z.string().min(8).describe('Admin user password (minimum 8 characters, will be hashed)'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Optional metadata as key-value pairs'),
});

/**
 * Schema for the response after successful initial admin creation
 * Includes admin details and authentication tokens
 */
export const initialAdminSetupResponseSchema = z.object({
  admin: z.object({
    id: z.string().describe('Unique identifier for the admin user'),
    name: z.string().describe('Display name of the admin user'),
    roles: z.array(z.string()).describe('Array of role identifiers assigned to the admin'),
    metadata: z.record(z.string(), z.unknown()).optional().describe('Metadata as key-value pairs'),
    createdAt: z.coerce.date().describe('Timestamp when the admin user was created'),
  }).describe('Created admin user details'),
  accessToken: z.string().describe('JWT access token for immediate authentication'),
  refreshToken: z.string().describe('JWT refresh token for obtaining new access tokens'),
  expiresIn: z.number().int().positive().describe('Access token expiry time in seconds'),
});

/** Response for system setup status check */
export type SetupStatusResponse = z.infer<typeof setupStatusResponseSchema>;

/** Request body for creating the initial admin account */
export type InitialAdminSetupRequest = z.infer<typeof initialAdminSetupSchema>;

/** Response after creating the initial admin account */
export type InitialAdminSetupResponse = z.infer<typeof initialAdminSetupResponseSchema>;
