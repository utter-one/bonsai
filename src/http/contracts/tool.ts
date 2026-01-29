import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema, llmSettingsSchema } from './common';
import type { ListParams } from './common';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };

/**
 * Schema for tool route parameters
 */
export const toolRouteParamsSchema = z.object({
  id: z.string().min(1).describe('Tool ID'),
});

export type ToolRouteParams = z.infer<typeof toolRouteParamsSchema>;

/**
 * Schema for creating a new tool
 * Required fields: id, name, prompt, inputType, outputType
 * Optional fields: description, llmProviderId, metadata
 */
export const createToolSchema = z.object({
  id: z.string().min(1).optional().describe('Unique identifier for the tool (auto-generated if not provided)'),
  projectId: z.string().min(1).describe('ID of the project this tool belongs to'),
  name: z.string().min(1).describe('Display name of the tool'),
  description: z.string().nullable().optional().describe('Detailed description of the tool\'s purpose and behavior'),
  prompt: z.string().min(1).describe('Handlebars template for tool invocation'),
  llmProviderId: z.string().nullable().optional().describe('ID of the LLM provider to use for this tool'),
  llmSettings: llmSettingsSchema.describe('LLM provider-specific settings for this tool'),
  inputType: z.string().min(1).describe('Expected input format ("text", "json", "image")'),
  outputType: z.string().min(1).describe('Expected output format ("text", "json", "image")'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Additional tool-specific metadata'),
});

/**
 * Schema for updating a tool
 * All fields are optional except version for optimistic locking
 */
export const updateToolBodySchema = z.object({
  name: z.string().min(1).optional().describe('Updated display name'),
  description: z.string().nullable().optional().describe('Updated description'),
  prompt: z.string().min(1).optional().describe('Updated tool prompt template'),
  llmProviderId: z.string().nullable().optional().describe('Updated LLM provider ID'),
  llmSettings: llmSettingsSchema.describe('Updated LLM provider-specific settings'),
  inputType: z.string().min(1).optional().describe('Updated input format'),
  outputType: z.string().min(1).optional().describe('Updated output format'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Updated metadata'),
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for deleting a tool
 * Required field: version for optimistic locking
 */
export const deleteToolBodySchema = z.object({
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for tool response
 * Includes all fields from the database schema
 */
export const toolResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the tool'),
  projectId: z.string().describe('ID of the project this tool belongs to'),
  name: z.string().describe('Display name of the tool'),
  description: z.string().nullable().describe('Detailed description of the tool'),
  prompt: z.string().describe('Handlebars template for tool invocation'),
  llmProviderId: z.string().nullable().describe('ID of the LLM provider'),
  llmSettings: llmSettingsSchema.describe('LLM provider-specific settings'),
  inputType: z.string().describe('Expected input format'),
  outputType: z.string().describe('Expected output format'),
  metadata: z.record(z.string(), z.unknown()).nullable().describe('Additional metadata'),
  version: z.number().int().describe('Version number for optimistic locking'),
  createdAt: z.coerce.date().describe('Timestamp when the tool was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the tool was last updated'),
});

/**
 * Schema for paginated list of tools
 * Includes pagination metadata: items, total count, offset, and limit
 */
export const toolListResponseSchema = z.object({
  items: z.array(toolResponseSchema).describe('Array of tools in the current page'),
  total: z.number().int().min(0).describe('Total number of tools matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: z.number().int().positive().nullable().describe('Maximum number of items per page (null if no limit)'),
});

/** Request body for creating a new tool */
export type CreateToolRequest = z.infer<typeof createToolSchema>;

/** Request body for updating a tool */
export type UpdateToolRequest = z.infer<typeof updateToolBodySchema>;

/** Request body for deleting a tool */
export type DeleteToolRequest = z.infer<typeof deleteToolBodySchema>;

/** Response for a single tool */
export type ToolResponse = z.infer<typeof toolResponseSchema>;

/** Response for paginated list of tools with metadata */
export type ToolListResponse = z.infer<typeof toolListResponseSchema>;
