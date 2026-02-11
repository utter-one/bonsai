import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema, llmSettingsSchema } from './common';
import type { ListParams } from './common';
import { toolParameterSchema } from '../../types/actions';
import type { ToolParameter } from '../../types/actions';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };
export { toolParameterSchema, type ToolParameter };

/**
 * Schema for tool input types
 * Defines the format of data the tool accepts
 */
export const toolInputTypeSchema = z.enum(['text', 'image', 'multi-modal']).describe('Type of input the tool accepts: text (plain text), image (image data), multi-modal (combination of text and images)');

/**
 * Schema for tool output types
 * Defines the format of data the tool produces
 */
export const toolOutputTypeSchema = z.enum(['text', 'image', 'multi-modal']).describe('Type of output the tool produces: text (plain text), image (image data), multi-modal (combination of text and images)');

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
  inputType: toolInputTypeSchema.describe('Expected input format for the tool'),
  outputType: toolOutputTypeSchema.describe('Expected output format from the tool'),
  parameters: z.array(toolParameterSchema).optional().default([]).describe('Parameters that this tool expects to receive'),
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
  inputType: toolInputTypeSchema.optional().describe('Updated input format'),
  outputType: toolOutputTypeSchema.optional().describe('Updated output format'),
  parameters: z.array(toolParameterSchema).optional().describe('Updated parameters for the tool'),
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
  inputType: toolInputTypeSchema.describe('Expected input format'),
  outputType: toolOutputTypeSchema.describe('Expected output format'),
  parameters: z.array(toolParameterSchema).describe('Parameters that this tool expects to receive'),
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
