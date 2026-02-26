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
 * Schema for flow tool route parameters
 */
export const flowToolRouteParamsSchema = z.object({
  projectId: z.string().min(1).describe('Project ID'),
  flowId: z.string().min(1).describe('Flow ID'),
  id: z.string().min(1).describe('Flow Tool ID'),
});

export type FlowToolRouteParams = z.infer<typeof flowToolRouteParamsSchema>;

/**
 * Schema for creating a new flow tool
 * Required fields: name, prompt, inputType, outputType
 * Optional fields: id, description, llmProviderId, llmSettings, parameters, metadata
 */
export const createFlowToolSchema = z.object({
  id: z.string().min(1).optional().describe('Unique identifier for the flow tool (auto-generated if not provided)'),
  name: z.string().min(1).describe('Display name of the flow tool'),
  description: z.string().nullable().optional().describe('Detailed description of the flow tool\'s purpose and behavior'),
  prompt: z.string().min(1).describe('Handlebars template for tool invocation'),
  llmProviderId: z.string().nullable().optional().describe('ID of the LLM provider to use for this tool'),
  llmSettings: llmSettingsSchema.describe('LLM provider-specific settings for this tool'),
  inputType: z.enum(['text', 'image', 'multi-modal']).describe('Expected input format for the tool'),
  outputType: z.enum(['text', 'image', 'multi-modal']).describe('Expected output format from the tool'),
  parameters: z.array(toolParameterSchema).optional().default([]).describe('Parameters that this tool expects to receive'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Additional tool-specific metadata'),
});

/**
 * Schema for updating a flow tool
 * All fields are optional except version for optimistic locking
 */
export const updateFlowToolBodySchema = z.object({
  name: z.string().min(1).optional().describe('Updated display name'),
  description: z.string().nullable().optional().describe('Updated description'),
  prompt: z.string().min(1).optional().describe('Updated tool prompt template'),
  llmProviderId: z.string().nullable().optional().describe('Updated LLM provider ID'),
  llmSettings: llmSettingsSchema.describe('Updated LLM provider-specific settings'),
  inputType: z.enum(['text', 'image', 'multi-modal']).optional().describe('Updated input format'),
  outputType: z.enum(['text', 'image', 'multi-modal']).optional().describe('Updated output format'),
  parameters: z.array(toolParameterSchema).optional().describe('Updated parameters for the tool'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Updated metadata'),
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for deleting a flow tool
 * Required field: version for optimistic locking
 */
export const deleteFlowToolBodySchema = z.object({
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for flow tool response
 * Includes all fields from the database schema
 */
export const flowToolResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the flow tool'),
  projectId: z.string().describe('ID of the project this flow tool belongs to'),
  flowId: z.string().describe('ID of the flow this tool belongs to'),
  name: z.string().describe('Display name of the flow tool'),
  description: z.string().nullable().describe('Detailed description of the tool'),
  prompt: z.string().describe('Handlebars template for tool invocation'),
  llmProviderId: z.string().nullable().describe('ID of the LLM provider'),
  llmSettings: llmSettingsSchema.describe('LLM provider-specific settings'),
  inputType: z.enum(['text', 'image', 'multi-modal']).describe('Expected input format'),
  outputType: z.enum(['text', 'image', 'multi-modal']).describe('Expected output format'),
  parameters: z.array(toolParameterSchema).describe('Parameters that this tool expects to receive'),
  metadata: z.record(z.string(), z.unknown()).nullable().describe('Additional metadata'),
  version: z.number().int().describe('Version number for optimistic locking'),
  createdAt: z.coerce.date().describe('Timestamp when the flow tool was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the flow tool was last updated'),
});

/**
 * Schema for paginated list of flow tools
 * Includes pagination metadata: items, total count, offset, and limit
 */
export const flowToolListResponseSchema = z.object({
  items: z.array(flowToolResponseSchema).describe('Array of flow tools in the current page'),
  total: z.number().int().min(0).describe('Total number of flow tools matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: z.number().int().positive().nullable().describe('Maximum number of items per page (null if no limit)'),
});

/**
 * Schema for cloning a flow tool
 * All fields are optional - id defaults to auto-generated, name defaults to "{original name} (Clone)"
 */
export const cloneFlowToolSchema = z.object({
  id: z.string().min(1).optional().describe('New ID for the cloned flow tool (auto-generated if not provided)'),
  name: z.string().min(1).optional().describe('Name for the cloned flow tool (defaults to "{original name} (Clone)")'),
});

/** Request body for creating a new flow tool */
export type CreateFlowToolRequest = z.infer<typeof createFlowToolSchema>;

/** Request body for updating a flow tool */
export type UpdateFlowToolRequest = z.infer<typeof updateFlowToolBodySchema>;

/** Request body for deleting a flow tool */
export type DeleteFlowToolRequest = z.infer<typeof deleteFlowToolBodySchema>;

/** Request body for cloning a flow tool */
export type CloneFlowToolRequest = z.infer<typeof cloneFlowToolSchema>;

/** Response for a single flow tool */
export type FlowToolResponse = z.infer<typeof flowToolResponseSchema>;

/** Response for paginated list of flow tools with metadata */
export type FlowToolListResponse = z.infer<typeof flowToolListResponseSchema>;
