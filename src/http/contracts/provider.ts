import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema } from './common';
import type { ListParams } from './common';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };

/**
 * Enum for provider types
 */
export const providerTypeSchema = z.enum(['asr', 'tts', 'llm', 'embeddings']).describe('Type of provider service');

/**
 * Provider name (openai, anthropic, azure, elevenlabs, etc.)
 */
export const providerNameSchema = z.string().describe('Specific provider implementation');

/**
 * Schema for creating a new provider
 * Required fields: id, displayName, type, providerName, config
 * Optional fields: description, createdBy, tags
 */
export const createProviderSchema = z.object({
  id: z.string().min(1).describe('Unique identifier for the provider'),
  displayName: z.string().min(1).describe('Human-readable name for the provider'),
  description: z.string().optional().describe('Detailed description of provider purpose and use case'),
  providerType: providerTypeSchema.describe('Provider category: asr, tts, llm, or embeddings'),
  apiType: providerNameSchema.describe('Specific provider implementation (e.g., openai, anthropic, azure, elevenlabs)'),
  config: z.record(z.string(), z.unknown()).describe('Provider-specific configuration object (varies by providerType and apiType)'),
  createdBy: z.string().optional().describe('Admin user ID who created the provider'),
  tags: z.array(z.string()).optional().describe('Searchable tags for organization (e.g., ["production", "low-latency"])'),
});

/**
 * Schema for updating a provider
 * Required fields: version (for optimistic locking)
 * Optional fields: displayName, description, type, providerName, config, tags
 */
export const updateProviderBodySchema = z.object({
  version: z.number().int().positive().describe('Current version number for optimistic locking (prevents concurrent updates)'),
  displayName: z.string().min(1).optional().describe('Updated human-readable name for the provider'),
  description: z.string().optional().describe('Updated description of provider purpose'),
  providerType: providerTypeSchema.optional().describe('Updated provider category'),
  apiType: providerNameSchema.optional().describe('Updated specific provider implementation'),
  config: z.record(z.string(), z.unknown()).optional().describe('Updated provider-specific configuration'),
  tags: z.array(z.string()).optional().describe('Updated searchable tags'),
});

/**
 * Schema for deleting a provider
 * Required fields: version (for optimistic locking to prevent concurrent deletions)
 */
export const deleteProviderBodySchema = z.object({
  version: z.number().int().positive().describe('Current version number for optimistic locking (prevents concurrent deletions)'),
});

/**
 * Schema for provider response
 * Includes: id, displayName, description, type, providerName, config, createdBy, tags, version, createdAt, updatedAt
 */
export const providerResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the provider'),
  displayName: z.string().describe('Human-readable name of the provider'),
  description: z.string().optional().describe('Description of provider purpose and use case'),
  providerType: providerTypeSchema.describe('Provider category (asr, tts, llm, embeddings)'),
  apiType: providerNameSchema.describe('Specific provider implementation'),
  config: z.record(z.string(), z.unknown()).describe('Provider-specific configuration object'),
  createdBy: z.string().optional().describe('Admin user ID who created the provider'),
  tags: z.array(z.string()).optional().describe('Tags for organization and search'),
  version: z.number().int().describe('Current version number for optimistic locking'),
  createdAt: z.coerce.date().describe('Timestamp when the provider was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the provider was last updated'),
});

/**
 * Schema for paginated list of providers
 * Includes pagination metadata: items, total count, offset, and limit
 */
export const providerListResponseSchema = z.object({
  items: z.array(providerResponseSchema).describe('Array of providers in the current page'),
  total: z.number().int().min(0).describe('Total number of providers matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: z.number().int().positive().nullable().describe('Maximum number of items per page (null if no limit)'),
});

/** Request body for creating a new provider */
export type CreateProviderRequest = z.infer<typeof createProviderSchema>;

/** Request body for updating a provider (includes version for optimistic locking) */
export type UpdateProviderRequest = z.infer<typeof updateProviderBodySchema>;

/** Request body for deleting a provider (includes version for optimistic locking) */
export type DeleteProviderRequest = z.infer<typeof deleteProviderBodySchema>;

/** Response for a single provider */
export type ProviderResponse = z.infer<typeof providerResponseSchema>;

/** Response for paginated list of providers with metadata */
export type ProviderListResponse = z.infer<typeof providerListResponseSchema>;

/** Type for provider types */
export type ProviderType = z.infer<typeof providerTypeSchema>;

/** Type for provider names */
export type ProviderName = z.infer<typeof providerNameSchema>;
