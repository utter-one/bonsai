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
 * Schema for creating a new classifier
 * Required fields: id, name, prompt
 * Optional fields: description, llmProvider, llmProviderConfig, metadata
 */
export const createClassifierSchema = z.object({
  id: z.string().min(1).describe('Unique identifier for the classifier'),
  name: z.string().min(1).describe('Display name of the classifier'),
  description: z.string().nullable().optional().describe('Detailed description of the classifier\'s purpose and behavior'),
  prompt: z.string().min(1).describe('Prompt that defines the classification logic and instructions'),
  llmProvider: z.string().nullable().optional().describe('LLM provider identifier (e.g., "openai", "anthropic")'),
  llmProviderConfig: llmProviderConfigSchema.describe('LLM provider-specific configuration'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Additional classifier-specific metadata'),
});

/**
 * Schema for updating a classifier
 * All fields are optional except version for optimistic locking
 */
export const updateClassifierBodySchema = z.object({
  name: z.string().min(1).optional().describe('Updated display name'),
  description: z.string().nullable().optional().describe('Updated description'),
  prompt: z.string().min(1).optional().describe('Updated classification prompt'),
  llmProvider: z.string().nullable().optional().describe('Updated LLM provider identifier'),
  llmProviderConfig: llmProviderConfigSchema.describe('Updated LLM provider configuration'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Updated metadata'),
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for deleting a classifier
 * Required field: version for optimistic locking
 */
export const deleteClassifierBodySchema = z.object({
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for classifier response
 * Includes all fields from the database schema
 */
export const classifierResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the classifier'),
  name: z.string().describe('Display name of the classifier'),
  description: z.string().nullable().describe('Detailed description of the classifier'),
  prompt: z.string().describe('Prompt defining the classification logic'),
  llmProvider: z.string().nullable().describe('LLM provider identifier'),
  llmProviderConfig: llmProviderConfigSchema.describe('LLM provider configuration'),
  metadata: z.record(z.string(), z.unknown()).nullable().describe('Additional metadata'),
  version: z.number().int().describe('Version number for optimistic locking'),
  createdAt: z.coerce.date().describe('Timestamp when the classifier was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the classifier was last updated'),
});

/**
 * Schema for paginated list of classifiers
 * Includes pagination metadata: items, total count, offset, and limit
 */
export const classifierListResponseSchema = z.object({
  items: z.array(classifierResponseSchema).describe('Array of classifiers in the current page'),
  total: z.number().int().min(0).describe('Total number of classifiers matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: z.number().int().positive().nullable().describe('Maximum number of items per page (null if no limit)'),
});

/** Request body for creating a new classifier */
export type CreateClassifierRequest = z.infer<typeof createClassifierSchema>;

/** Request body for updating a classifier */
export type UpdateClassifierRequest = z.infer<typeof updateClassifierBodySchema>;

/** Request body for deleting a classifier */
export type DeleteClassifierRequest = z.infer<typeof deleteClassifierBodySchema>;

/** Response for a single classifier */
export type ClassifierResponse = z.infer<typeof classifierResponseSchema>;

/** Response for paginated list of classifiers with metadata */
export type ClassifierListResponse = z.infer<typeof classifierListResponseSchema>;
