import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

/**
 * Schema for checking system setup status
 * Returns whether the system has been initialized with an operator account
 */
export const setupStatusResponseSchema = z.object({
  isSetup: z.boolean().describe('Whether the system has been set up with at least one operator account'),
  message: z.string().describe('Descriptive message about the setup status'),
});

/**
 * Schema for creating the initial operator account during system setup
 * Required fields: id, name, password
 * The operator will automatically receive all permissions (super_operator role)
 */
export const initialOperatorSetupSchema = z.object({
  id: z.string().min(1).describe('Unique identifier for the operator user (typically an email address)'),
  name: z.string().min(1).describe('Display name for the operator user'),
  password: z.string().min(8).describe('Operator user password (minimum 8 characters, will be hashed)'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Optional metadata as key-value pairs'),
});

/**
 * Schema for the response after successful initial operator creation
 * Includes operator details and authentication tokens
 */
export const initialOperatorSetupResponseSchema = z.object({
  operator: z.object({
    id: z.string().describe('Unique identifier for the operator user'),
    name: z.string().describe('Display name of the operator user'),
    roles: z.array(z.string()).describe('Array of role identifiers assigned to the operator'),
    metadata: z.record(z.string(), z.unknown()).optional().describe('Metadata as key-value pairs'),
    createdAt: z.coerce.date().describe('Timestamp when the operator user was created'),
  }).describe('Created operator user details'),
  accessToken: z.string().describe('JWT access token for immediate authentication'),
  refreshToken: z.string().describe('JWT refresh token for obtaining new access tokens'),
  expiresIn: z.number().int().positive().describe('Access token expiry time in seconds'),
});

/** Response for system setup status check */
export type SetupStatusResponse = z.infer<typeof setupStatusResponseSchema>;

/** Request body for creating the initial operator account */
export type InitialOperatorSetupRequest = z.infer<typeof initialOperatorSetupSchema>;

/** Response after creating the initial operator account */
export type InitialOperatorSetupResponse = z.infer<typeof initialOperatorSetupResponseSchema>;
