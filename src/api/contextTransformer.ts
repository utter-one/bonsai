import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema } from './common';
import type { ListParams } from './common';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };

/**
 * Schema for LLM provider configuration
 * Provides settings for the language model provider
 */
export const llmProviderConfigSchema = z.record(z.string(), z.unknown()).optional().describe('LLM provider-specific configuration settings');

/**
 * Schema for creating a new context transformer
 * Required fields: id, name, prompt
 * Optional fields: description, contextFields, llmProvider, llmProviderConfig, metadata
 */
export const createContextTransformerSchema = z.object({
  id: z.string().min(1).describe('Unique identifier for the context transformer'),
  name: z.string().min(1).describe('Display name of the context transformer'),
  description: z.string().nullable().optional().describe('Detailed description of the transformer\'s purpose and behavior'),
  prompt: z.string().min(1).describe('Prompt that defines the transformation logic and instructions'),
  contextFields: z.array(z.string()).optional().describe('List of context field names to be transformed'),
  llmProvider: z.string().nullable().optional().describe('LLM provider identifier (e.g., "openai", "anthropic")'),
  llmProviderConfig: llmProviderConfigSchema.describe('LLM provider-specific configuration'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Additional transformer-specific metadata'),
});

/**
 * Schema for updating a context transformer
 * All fields are optional except version for optimistic locking
 */
export const updateContextTransformerBodySchema = z.object({
  name: z.string().min(1).optional().describe('Updated display name'),
  description: z.string().nullable().optional().describe('Updated description'),
  prompt: z.string().min(1).optional().describe('Updated transformation prompt'),
  contextFields: z.array(z.string()).optional().describe('Updated context field names'),
  llmProvider: z.string().nullable().optional().describe('Updated LLM provider identifier'),
  llmProviderConfig: llmProviderConfigSchema.describe('Updated LLM provider configuration'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Updated metadata'),
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for deleting a context transformer
 * Required field: version for optimistic locking
 */
export const deleteContextTransformerBodySchema = z.object({
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for context transformer response
 * Includes all fields from the database schema
 */
export const contextTransformerResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the context transformer'),
  name: z.string().describe('Display name of the context transformer'),
  description: z.string().nullable().describe('Detailed description of the transformer'),
  prompt: z.string().describe('Prompt defining the transformation logic'),
  contextFields: z.array(z.string()).nullable().describe('Context field names to be transformed'),
  llmProvider: z.string().nullable().describe('LLM provider identifier'),
  llmProviderConfig: llmProviderConfigSchema.describe('LLM provider configuration'),
  metadata: z.record(z.string(), z.unknown()).nullable().describe('Additional metadata'),
  version: z.number().int().describe('Version number for optimistic locking'),
  createdAt: z.coerce.date().describe('Timestamp when the transformer was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the transformer was last updated'),
});

/**
 * Schema for paginated list of context transformers
 * Includes pagination metadata: items, total count, offset, and limit
 */
export const contextTransformerListResponseSchema = z.object({
  items: z.array(contextTransformerResponseSchema).describe('Array of context transformers in the current page'),
  total: z.number().int().min(0).describe('Total number of context transformers matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: z.number().int().positive().nullable().describe('Maximum number of items per page (null if no limit)'),
});

/** Request body for creating a new context transformer */
export type CreateContextTransformerRequest = z.infer<typeof createContextTransformerSchema>;

/** Request body for updating a context transformer */
export type UpdateContextTransformerRequest = z.infer<typeof updateContextTransformerBodySchema>;

/** Request body for deleting a context transformer */
export type DeleteContextTransformerRequest = z.infer<typeof deleteContextTransformerBodySchema>;

/** Response for a single context transformer */
export type ContextTransformerResponse = z.infer<typeof contextTransformerResponseSchema>;

/** Response for paginated list of context transformers with metadata */
export type ContextTransformerListResponse = z.infer<typeof contextTransformerListResponseSchema>;
