import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

/**
 * Schema for login request
 * Required fields: id (email/username), password
 */
export const loginSchema = z.object({
  id: z.string().min(1).describe('Operator user ID or email'),
  password: z.string().min(1).describe('Operator user password'),
});

/**
 * Schema for refresh token request
 * Required fields: refreshToken
 */
export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1).describe('Valid refresh token'),
});

/**
 * Schema for login response
 * Includes access token, refresh token, expiry, and user info
 */
export const loginResponseSchema = z.object({
  accessToken: z.string().describe('JWT access token'),
  refreshToken: z.string().describe('JWT refresh token'),
  expiresIn: z.number().int().positive().describe('Access token expiry time in seconds'),
  operatorId: z.string().describe('Operator user ID'),
  displayName: z.string().describe('Operator display name'),
  roles: z.array(z.string()).describe('Array of role identifiers'),
  permissions: z.array(z.string()).describe('Effective permissions derived from assigned roles (deduplicated union)'),
});

/**
 * Schema for refresh token response
 * Includes new access token and expiry
 */
export const refreshTokenResponseSchema = z.object({
  accessToken: z.string().describe('New JWT access token (expires in 15 minutes)'),
  expiresIn: z.number().int().positive().describe('Access token expiry time in seconds'),
});

/** Request body for login */
export type LoginRequest = z.infer<typeof loginSchema>;

/** Request body for token refresh */
export type RefreshTokenRequest = z.infer<typeof refreshTokenSchema>;

/** Response for successful login */
export type LoginResponse = z.infer<typeof loginResponseSchema>;

/** Response for successful token refresh */
export type RefreshTokenResponse = z.infer<typeof refreshTokenResponseSchema>;
