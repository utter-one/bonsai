import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { ALL_API_KEY_CHANNELS, ALL_API_KEY_FEATURES } from '../../apiKeyFeatures';

extendZodWithOpenApi(z);

/**
 * API Key request and response schemas
 * API Keys are secret strings tied to a single project that allow clients
 * to authenticate via WebSocket and conduct conversations
 */

/**
 * Schema for API key security settings controlling permitted channels and features.
 * A null/absent array in either dimension means all values in that dimension are allowed.
 */
export const apiKeySettingsSchema = z.object({
  allowedChannels: z.array(z.enum(ALL_API_KEY_CHANNELS)).optional().describe('Permitted transport channels. If absent, all channels (websocket, webrtc) are allowed.'),
  allowedFeatures: z.array(z.enum(ALL_API_KEY_FEATURES)).optional().describe('Permitted feature capabilities. If absent, all features are allowed.'),
}).openapi('ApiKeySettings');

export type ApiKeySettings = z.infer<typeof apiKeySettingsSchema>;

/**
 * Schema for creating a new API key
 */
export const createApiKeySchema = z.object({
  name: z.string().min(1).max(255).describe('A descriptive name for the API key'),
  metadata: z.record(z.string(), z.any()).optional().describe('Additional metadata for the API key'),
  keySettings: apiKeySettingsSchema.optional().describe('Security settings controlling which channels and features this key permits. If absent, all channels and features are allowed.'),
});

export type CreateApiKeyRequest = z.infer<typeof createApiKeySchema>;

/**
 * Schema for updating an existing API key
 */
export const updateApiKeySchema = z.object({
  name: z.string().min(1).max(255).optional().describe('The updated name for the API key'),
  isActive: z.boolean().optional().describe('Whether the API key is active and can be used for authentication'),
  metadata: z.record(z.string(), z.any()).optional().describe('Updated metadata for the API key'),
  keySettings: apiKeySettingsSchema.optional().describe('Updated security settings. If absent, existing settings are preserved.'),
  version: z.number().describe('The current version number for optimistic locking'),
});

export type UpdateApiKeyRequest = z.infer<typeof updateApiKeySchema>;

/**
 * Schema for API key route parameters
 */
export const apiKeyRouteParamsSchema = z.object({
  projectId: z.string().min(1).describe('Project ID'),
  id: z.string().describe('The unique identifier of the API key'),
});

export type ApiKeyRouteParams = z.infer<typeof apiKeyRouteParamsSchema>;

/**
 * Schema for API key response
 * Contains full API key information including the secret key (only returned on creation)
 */
export const apiKeyResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the API key'),
  projectId: z.string().describe('The ID of the project this API key belongs to'),
  name: z.string().describe('Descriptive name for the API key'),
  key: z.string().optional().describe('The secret API key string (only included when creating a new key)'),
  keyPreview: z.string().optional().describe('First few characters of the key for identification'),
  lastUsedAt: z.string().nullable().describe('ISO timestamp of when the key was last used'),
  isActive: z.boolean().describe('Whether the API key is active'),
  metadata: z.record(z.string(), z.any()).optional().describe('Additional metadata'),
  keySettings: apiKeySettingsSchema.nullable().optional().describe('Security settings controlling which channels and features this key permits'),
  version: z.number().describe('Version number for optimistic locking'),
  createdAt: z.string().describe('ISO timestamp of creation'),
  updatedAt: z.string().describe('ISO timestamp of last update'),
  archived: z.boolean().optional().describe('Whether this entity belongs to an archived project'),
});

export type ApiKeyResponse = z.infer<typeof apiKeyResponseSchema>;

/**
 * Schema for API key list response
 */
export const apiKeyListResponseSchema = z.object({
  items: z.array(apiKeyResponseSchema).describe('Array of API keys'),
  total: z.number().describe('Total number of API keys matching the query'),
});

export type ApiKeyListResponse = z.infer<typeof apiKeyListResponseSchema>;

/**
 * Schema for deleting an API key
 */
export const deleteApiKeyBodySchema = z.object({
  version: z.number().describe('The current version number for optimistic locking'),
});

export type DeleteApiKeyRequest = z.infer<typeof deleteApiKeyBodySchema>;
