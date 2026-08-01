import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema, listResponseLimitSchema } from './common';
import type { ListParams } from './common';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };

/** Fixed set of prompt categories */
export type QuickPromptCategory = 'agent' | 'stage' | 'filler' | 'transformer' | 'classifier' | 'tool' | 'tester' | 'summarization';

export const quickPromptRouteParamsSchema = z.object({
  id: z.string().describe('Quick Prompt ID'),
});

export const quickPromptProjectRouteParamsSchema = z.object({
  projectId: z.string().min(1).describe('Project ID'),
  id: z.string().describe('Quick Prompt ID'),
});

/**
 * Schema for creating a new quick prompt
 */
export const createQuickPromptSchema = z.object({
  id: z.string().min(1).optional().describe('Unique identifier (auto-generated if not provided)'),
  categoryId: z.enum(['agent', 'stage', 'filler', 'transformer', 'classifier', 'tool', 'tester', 'summarization']).describe('Prompt category'),
  name: z.string().min(1).describe('Display name of the prompt'),
  description: z.string().nullable().optional().describe('Optional description'),
  content: z.string().min(1).describe('Prompt template text'),
  tags: z.array(z.string()).optional().default([]).describe('Tags for organization and filtering'),
  isPublic: z.boolean().optional().default(true).describe('Whether the prompt is visible to all operators'),
});

/**
 * Schema for creating a project-scoped quick prompt
 */
export const createProjectQuickPromptSchema = z.object({
  id: z.string().min(1).optional().describe('Unique identifier (auto-generated if not provided)'),
  categoryId: z.enum(['agent', 'stage', 'filler', 'transformer', 'classifier', 'tool', 'tester', 'summarization']).describe('Prompt category'),
  name: z.string().min(1).describe('Display name of the prompt'),
  description: z.string().nullable().optional().describe('Optional description'),
  content: z.string().min(1).describe('Prompt template text'),
  tags: z.array(z.string()).optional().default([]).describe('Tags for organization and filtering'),
  isPublic: z.boolean().optional().default(true).describe('Whether the prompt is visible to project members'),
});

/**
 * Schema for updating a quick prompt
 */
export const updateQuickPromptBodySchema = z.object({
  categoryId: z.enum(['agent', 'stage', 'filler', 'transformer', 'classifier', 'tool', 'tester', 'summarization']).optional().describe('Updated category'),
  name: z.string().min(1).optional().describe('Updated display name'),
  description: z.string().nullable().optional().describe('Updated description'),
  content: z.string().min(1).optional().describe('Updated prompt template text'),
  tags: z.array(z.string()).optional().describe('Updated tags'),
  isPublic: z.boolean().optional().describe('Updated visibility'),
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for deleting a quick prompt
 */
export const deleteQuickPromptBodySchema = z.object({
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for cloning a quick prompt
 */
export const cloneQuickPromptSchema = z.object({
  id: z.string().min(1).optional().describe('New ID for the cloned prompt (auto-generated if not provided)'),
  name: z.string().min(1).optional().describe('Name for the cloned prompt (defaults to "{original name} (Clone)")'),
});

/**
 * Schema for quick prompt response
 */
export const quickPromptResponseSchema = z.object({
  id: z.string().describe('Unique identifier'),
  projectId: z.string().nullable().describe('Project ID (null for global prompts)'),
  categoryId: z.enum(['agent', 'stage', 'filler', 'transformer', 'classifier', 'tool', 'tester', 'summarization']).describe('Prompt category'),
  ownerId: z.string().nullable().describe('Owner operator ID'),
  name: z.string().describe('Display name'),
  description: z.string().nullable().describe('Description'),
  content: z.string().describe('Prompt template text'),
  tags: z.array(z.string()).describe('Tags'),
  isPublic: z.boolean().describe('Visibility flag'),
  isSystem: z.boolean().describe('Whether this is a system-seeded prompt'),
  version: z.number().int().describe('Version number for optimistic locking'),
  createdAt: z.coerce.date().describe('Creation timestamp'),
  updatedAt: z.coerce.date().describe('Last update timestamp'),
});

/**
 * Schema for paginated list of quick prompts
 */
export const quickPromptListResponseSchema = z.object({
  items: z.array(quickPromptResponseSchema).describe('Array of quick prompts'),
  total: z.number().int().min(0).describe('Total number of prompts matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: listResponseLimitSchema,
});

/** Request body for creating a global quick prompt */
export type CreateQuickPromptRequest = z.infer<typeof createQuickPromptSchema>;

/** Request body for creating a project-scoped quick prompt */
export type CreateProjectQuickPromptRequest = z.infer<typeof createProjectQuickPromptSchema>;

/** Request body for updating a quick prompt */
export type UpdateQuickPromptRequest = z.infer<typeof updateQuickPromptBodySchema>;

/** Request body for deleting a quick prompt */
export type DeleteQuickPromptRequest = z.infer<typeof deleteQuickPromptBodySchema>;

/** Request body for cloning a quick prompt */
export type CloneQuickPromptRequest = z.infer<typeof cloneQuickPromptSchema>;

/** Response for a single quick prompt */
export type QuickPromptResponse = z.infer<typeof quickPromptResponseSchema>;

/** Response for paginated list of quick prompts */
export type QuickPromptListResponse = z.infer<typeof quickPromptListResponseSchema>;
