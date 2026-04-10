import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema, listResponseLimitSchema, llmSettingsSchema } from './common';
import type { ListParams } from './common';
import { toolParameterSchema } from '../../types/actions';
import type { ToolParameter } from '../../types/actions';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };
export { toolParameterSchema, type ToolParameter };

/**
 * Schema for the tool type discriminator
 * Determines the execution behaviour: LLM call, HTTP webhook, or isolated JavaScript script
 */
export const toolTypeSchema = z.enum(['smart_function', 'webhook', 'script']).describe('Tool execution type: smart_function (LLM-based), webhook (HTTP call), script (JavaScript)');

/**
 * Schema for tool input types (smart_function tools only)
 * Defines the format of data the tool accepts
 */
export const toolInputTypeSchema = z.enum(['text', 'image', 'multi-modal']).describe('Type of input the tool accepts: text (plain text), image (image data), multi-modal (combination of text and images)');

/**
 * Schema for tool output types (smart_function tools only)
 * Defines the format of data the tool produces
 */
export const toolOutputTypeSchema = z.enum(['text', 'image', 'multi-modal']).describe('Type of output the tool produces: text (plain text), image (image data), multi-modal (combination of text and images)');

/**
 * Schema for tool route parameters
 */
export const toolRouteParamsSchema = z.object({
  projectId: z.string().min(1).describe('Project ID'),
  id: z.string().min(1).describe('Tool ID'),
});

export type ToolRouteParams = z.infer<typeof toolRouteParamsSchema>;

/** Shared create fields present on every tool type */
const createToolBaseSchema = z.object({
  id: z.string().min(1).optional().describe('Unique identifier for the tool (auto-generated if not provided)'),
  name: z.string().min(1).describe('Display name of the tool'),
  description: z.string().nullable().optional().describe('Detailed description of the tool\'s purpose and behavior'),
  parameters: z.array(toolParameterSchema).optional().default([]).describe('Parameters that this tool expects to receive'),
  tags: z.array(z.string()).optional().default([]).describe('Tags for categorizing and filtering this tool'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Additional tool-specific metadata'),
});

/**
 * Schema for creating a smart_function tool
 * Executes an LLM call using the rendered prompt and returns the model output
 */
export const createSmartFunctionToolSchema = createToolBaseSchema.extend({
  type: z.literal('smart_function').describe('Tool executes an LLM call'),
  prompt: z.string().min(1).describe('Handlebars template rendered before being sent to the LLM'),
  llmProviderId: z.string().describe('ID of the LLM provider to use for this tool'),
  llmSettings: llmSettingsSchema.describe('LLM provider-specific settings for this tool'),
  inputType: toolInputTypeSchema.describe('Expected input format for the tool'),
  outputType: toolOutputTypeSchema.describe('Expected output format from the tool'),
}).openapi('CreateSmartFunctionTool');

/**
 * Schema for creating a webhook tool
 * Makes an HTTP request and stores the response in context.results.webhooks
 */
export const createWebhookToolSchema = createToolBaseSchema.extend({
  type: z.literal('webhook').describe('Tool makes an HTTP request'),
  url: z.string().url().describe('Target URL — supports Handlebars templating'),
  webhookMethod: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional().default('GET').describe('HTTP method to use'),
  webhookHeaders: z.record(z.string(), z.string()).optional().describe('HTTP headers to send; values support Handlebars templating'),
  webhookBody: z.string().optional().describe('Request body template (Handlebars); used for POST/PUT/PATCH'),
}).openapi('CreateWebhookTool');

/**
 * Schema for creating a script tool
 * Executes isolated JavaScript code with full flow-control capabilities
 */
export const createScriptToolSchema = createToolBaseSchema.extend({
  type: z.literal('script').describe('Tool executes isolated JavaScript code'),
  code: z.string().min(1).describe('JavaScript code to execute in an isolated VM context'),
}).openapi('CreateScriptTool');

/**
 * Discriminated union schema for creating any tool type
 * The 'type' field determines which variant is validated
 */
export const createToolSchema = z.discriminatedUnion('type', [
  createSmartFunctionToolSchema,
  createWebhookToolSchema,
  createScriptToolSchema,
]);

/** Shared update fields present on every tool type */
const updateToolBaseSchema = z.object({
  name: z.string().min(1).optional().describe('Updated display name'),
  description: z.string().nullable().optional().describe('Updated description'),
  parameters: z.array(toolParameterSchema).optional().describe('Updated parameters for the tool (smart_function)'),
  tags: z.array(z.string()).optional().describe('Updated tags (smart_function)'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Updated metadata (smart_function)'),
  version: z.number().int().min(1).describe('Current version number for optimistic locking (smart_function)'),
});

/**
 * Schema for updating a smart_function tool
 * llmProviderId and llmSettings are required
 */
export const updateSmartFunctionToolSchema = updateToolBaseSchema.extend({
  type: z.literal('smart_function').describe('Tool executes an LLM call'),
  prompt: z.string().min(1).optional().describe('Updated Handlebars prompt template'),
  llmProviderId: z.string().describe('Updated LLM provider ID'),
  llmSettings: llmSettingsSchema.describe('Updated LLM provider-specific settings'),
  inputType: toolInputTypeSchema.describe('Updated input format (smart_function)'),
  outputType: toolOutputTypeSchema.describe('Updated output format (smart_function)'),
}).openapi('UpdateSmartFunctionTool');

/**
 * Schema for updating a webhook tool
 */
export const updateWebhookToolSchema = updateToolBaseSchema.extend({
  type: z.literal('webhook').describe('Tool makes an HTTP request'),
  url: z.url().describe('Updated target URL (webhook)'),
  webhookMethod: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional().describe('Updated HTTP method (webhook)'),
  webhookHeaders: z.record(z.string(), z.string()).nullable().optional().describe('Updated HTTP headers (webhook)'),
  webhookBody: z.string().nullable().optional().describe('Updated request body template (webhook)'),
}).openapi('UpdateWebhookTool');

/**
 * Schema for updating a script tool
 */
export const updateScriptToolSchema = updateToolBaseSchema.extend({
  type: z.literal('script').describe('Tool executes isolated JavaScript code'),
  code: z.string().min(1).describe('Updated JavaScript code (script)'),
}).openapi('UpdateScriptTool');

/**
 * Discriminated union schema for updating any tool type
 * The 'type' field determines which variant is validated
 * For smart_function tools, llmProviderId and llmSettings are required
 */
export const updateToolBodySchema = z.discriminatedUnion('type', [
  updateSmartFunctionToolSchema,
  updateWebhookToolSchema,
  updateScriptToolSchema,
]);

/**
 * Schema for deleting a tool
 * Required field: version for optimistic locking
 */
export const deleteToolBodySchema = z.object({
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Wide response schema for all tool types
 * Type-specific fields are nullable when not applicable to a given tool type
 */
export const toolResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the tool'),
  projectId: z.string().describe('ID of the project this tool belongs to'),
  name: z.string().describe('Display name of the tool'),
  description: z.string().nullable().describe('Detailed description of the tool'),
  type: toolTypeSchema.describe('Tool execution type'),
  // smart_function fields
  prompt: z.string().nullable().describe('Handlebars prompt template (smart_function only)'),
  llmProviderId: z.string().nullable().describe('ID of the LLM provider (smart_function only)'),
  llmSettings: llmSettingsSchema.nullable().describe('LLM provider-specific settings (smart_function only)'),
  inputType: toolInputTypeSchema.nullable().describe('Expected input format (smart_function only)'),
  outputType: toolOutputTypeSchema.nullable().describe('Expected output format (smart_function only)'),
  // webhook fields
  url: z.string().nullable().describe('Target URL (webhook only)'),
  webhookMethod: z.string().nullable().describe('HTTP method (webhook only)'),
  webhookHeaders: z.record(z.string(), z.string()).nullable().describe('HTTP headers (webhook only)'),
  webhookBody: z.string().nullable().describe('Request body template (webhook only)'),
  // script fields
  code: z.string().nullable().describe('JavaScript code (script only)'),
  // shared fields
  parameters: z.array(toolParameterSchema).describe('Parameters that this tool expects to receive'),
  tags: z.array(z.string()).describe('Tags for categorizing and filtering this tool'),
  metadata: z.record(z.string(), z.unknown()).nullable().describe('Additional metadata'),
  version: z.number().int().describe('Version number for optimistic locking'),
  createdAt: z.coerce.date().describe('Timestamp when the tool was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the tool was last updated'),
  archived: z.boolean().optional().describe('Whether this entity belongs to an archived project'),
});

/**
 * Schema for paginated list of tools
 * Includes pagination metadata: items, total count, offset, and limit
 */
export const toolListResponseSchema = z.object({
  items: z.array(toolResponseSchema).describe('Array of tools in the current page'),
  total: z.number().int().min(0).describe('Total number of tools matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: listResponseLimitSchema,
});

/** Request body for creating a new tool */
export type CreateToolRequest = z.infer<typeof createToolSchema>;

/** Request body for creating a smart_function tool */
export type CreateSmartFunctionToolRequest = z.infer<typeof createSmartFunctionToolSchema>;

/** Request body for creating a webhook tool */
export type CreateWebhookToolRequest = z.infer<typeof createWebhookToolSchema>;

/** Request body for creating a script tool */
export type CreateScriptToolRequest = z.infer<typeof createScriptToolSchema>;

/** Request body for updating a smart_function tool */
export type UpdateSmartFunctionToolRequest = z.infer<typeof updateSmartFunctionToolSchema>;

/** Request body for updating a webhook tool */
export type UpdateWebhookToolRequest = z.infer<typeof updateWebhookToolSchema>;

/** Request body for updating a script tool */
export type UpdateScriptToolRequest = z.infer<typeof updateScriptToolSchema>;

/** Request body for updating a tool */
export type UpdateToolRequest = z.infer<typeof updateToolBodySchema>;

/** Request body for deleting a tool */
export type DeleteToolRequest = z.infer<typeof deleteToolBodySchema>;

/**
 * Schema for cloning a tool
 * All fields are optional - id defaults to auto-generated, name defaults to "{original name} (Clone)"
 */
export const cloneToolSchema = z.object({
  id: z.string().min(1).optional().describe('New ID for the cloned tool (auto-generated if not provided)'),
  name: z.string().min(1).optional().describe('Name for the cloned tool (defaults to "{original name} (Clone)")'),
});

/** Request body for cloning a tool */
export type CloneToolRequest = z.infer<typeof cloneToolSchema>;

/** Response for a single tool */
export type ToolResponse = z.infer<typeof toolResponseSchema>;

/** Response for paginated list of tools with metadata */
export type ToolListResponse = z.infer<typeof toolListResponseSchema>;
