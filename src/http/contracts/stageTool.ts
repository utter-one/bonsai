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
 * Schema for stage tool route parameters
 */
export const stageToolRouteParamsSchema = z.object({
  projectId: z.string().min(1).describe('Project ID'),
  flowId: z.string().min(1).describe('Flow ID'),
  stageId: z.string().min(1).describe('Stage ID'),
  id: z.string().min(1).describe('Stage Tool ID'),
});

export type StageToolRouteParams = z.infer<typeof stageToolRouteParamsSchema>;

/**
 * Schema for creating a new stage tool
 * Required fields: name, prompt, inputType, outputType
 * Optional fields: id, description, llmProviderId, llmSettings, parameters, metadata
 */
export const createStageToolSchema = z.object({
  id: z.string().min(1).optional().describe('Unique identifier for the stage tool (auto-generated if not provided)'),
  name: z.string().min(1).describe('Display name of the stage tool'),
  description: z.string().nullable().optional().describe('Detailed description of the stage tool\'s purpose and behavior'),
  prompt: z.string().min(1).describe('Handlebars template for tool invocation'),
  llmProviderId: z.string().nullable().optional().describe('ID of the LLM provider to use for this tool'),
  llmSettings: llmSettingsSchema.describe('LLM provider-specific settings for this tool'),
  inputType: z.enum(['text', 'image', 'multi-modal']).describe('Expected input format for the tool'),
  outputType: z.enum(['text', 'image', 'multi-modal']).describe('Expected output format from the tool'),
  parameters: z.array(toolParameterSchema).optional().default([]).describe('Parameters that this tool expects to receive'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Additional tool-specific metadata'),
});

/**
 * Schema for updating a stage tool
 * All fields are optional except version for optimistic locking
 */
export const updateStageToolBodySchema = z.object({
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
 * Schema for deleting a stage tool
 * Required field: version for optimistic locking
 */
export const deleteStageToolBodySchema = z.object({
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for stage tool response
 * Includes all fields from the database schema
 */
export const stageToolResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the stage tool'),
  projectId: z.string().describe('ID of the project this stage tool belongs to'),
  flowId: z.string().describe('ID of the flow this stage tool belongs to'),
  stageId: z.string().describe('ID of the stage this tool belongs to'),
  name: z.string().describe('Display name of the stage tool'),
  description: z.string().nullable().describe('Detailed description of the tool'),
  prompt: z.string().describe('Handlebars template for tool invocation'),
  llmProviderId: z.string().nullable().describe('ID of the LLM provider'),
  llmSettings: llmSettingsSchema.describe('LLM provider-specific settings'),
  inputType: z.enum(['text', 'image', 'multi-modal']).describe('Expected input format'),
  outputType: z.enum(['text', 'image', 'multi-modal']).describe('Expected output format'),
  parameters: z.array(toolParameterSchema).describe('Parameters that this tool expects to receive'),
  metadata: z.record(z.string(), z.unknown()).nullable().describe('Additional metadata'),
  version: z.number().int().describe('Version number for optimistic locking'),
  createdAt: z.coerce.date().describe('Timestamp when the stage tool was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the stage tool was last updated'),
});

/**
 * Schema for paginated list of stage tools
 * Includes pagination metadata: items, total count, offset, and limit
 */
export const stageToolListResponseSchema = z.object({
  items: z.array(stageToolResponseSchema).describe('Array of stage tools in the current page'),
  total: z.number().int().min(0).describe('Total number of stage tools matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: z.number().int().positive().nullable().describe('Maximum number of items per page (null if no limit)'),
});

/**
 * Schema for cloning a stage tool
 * All fields are optional - id defaults to auto-generated, name defaults to "{original name} (Clone)"
 */
export const cloneStageToolSchema = z.object({
  id: z.string().min(1).optional().describe('New ID for the cloned stage tool (auto-generated if not provided)'),
  name: z.string().min(1).optional().describe('Name for the cloned stage tool (defaults to "{original name} (Clone)")'),
});

/** Request body for creating a new stage tool */
export type CreateStageToolRequest = z.infer<typeof createStageToolSchema>;

/** Request body for updating a stage tool */
export type UpdateStageToolRequest = z.infer<typeof updateStageToolBodySchema>;

/** Request body for deleting a stage tool */
export type DeleteStageToolRequest = z.infer<typeof deleteStageToolBodySchema>;

/** Request body for cloning a stage tool */
export type CloneStageToolRequest = z.infer<typeof cloneStageToolSchema>;

/** Response for a single stage tool */
export type StageToolResponse = z.infer<typeof stageToolResponseSchema>;

/** Response for paginated list of stage tools with metadata */
export type StageToolListResponse = z.infer<typeof stageToolListResponseSchema>;
