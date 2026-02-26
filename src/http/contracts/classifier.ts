import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema, llmSettingsSchema } from './common';
import type { ListParams } from './common';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };

/**
 * Schema for classifier route params
 */
export const classifierRouteParamsSchema = z.object({
  projectId: z.string().min(1).describe('Project ID'),
  id: z.string().describe('Classifier ID'),
});

/**
 * Schema for creating a new classifier
 * Required fields: id, name, prompt
 * Optional fields: description, llmProviderId, metadata
 */
export const createClassifierSchema = z.object({
  id: z.string().min(1).optional().describe('Unique identifier for the classifier (auto-generated if not provided)'),
  name: z.string().min(1).describe('Display name of the classifier'),
  description: z.string().nullable().optional().describe('Detailed description of the classifier\'s purpose and behavior'),
  prompt: z.string().min(1).describe('Prompt that defines the classification logic and instructions'),
  llmProviderId: z.string().nullable().optional().describe('ID of the LLM provider to use for this classifier'),
  llmSettings: llmSettingsSchema.describe('LLM provider-specific settings for this classifier'),
  tags: z.array(z.string()).optional().default([]).describe('Tags for categorizing and filtering this classifier'),
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
  llmProviderId: z.string().nullable().optional().describe('Updated LLM provider ID'),
  llmSettings: llmSettingsSchema.describe('Updated LLM provider-specific settings'),
  tags: z.array(z.string()).optional().describe('Updated tags'),
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
  projectId: z.string().describe('ID of the project this classifier belongs to'),
  name: z.string().describe('Display name of the classifier'),
  description: z.string().nullable().describe('Detailed description of the classifier'),
  prompt: z.string().describe('Prompt defining the classification logic'),
  llmProviderId: z.string().nullable().describe('ID of the LLM provider'),
  llmSettings: llmSettingsSchema.describe('LLM provider-specific settings'),
  tags: z.array(z.string()).describe('Tags for categorizing and filtering this classifier'),
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

/**
 * Schema for cloning a classifier
 * All fields are optional - id defaults to auto-generated, name defaults to "{original name} (Clone)"
 */
export const cloneClassifierSchema = z.object({
  id: z.string().min(1).optional().describe('New ID for the cloned classifier (auto-generated if not provided)'),
  name: z.string().min(1).optional().describe('Name for the cloned classifier (defaults to "{original name} (Clone)")'),
});

/** Request body for cloning a classifier */
export type CloneClassifierRequest = z.infer<typeof cloneClassifierSchema>;

/** Response for a single classifier */
export type ClassifierResponse = z.infer<typeof classifierResponseSchema>;

/** Response for paginated list of classifiers with metadata */
export type ClassifierListResponse = z.infer<typeof classifierListResponseSchema>;
