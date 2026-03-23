import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema, listResponseLimitSchema, ttsSettingsSchema, llmSettingsSchema } from './common';
import { audioFormatValues } from '../../types/audio';
import type { ListParams } from './common';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };

/**
 * Schema for agent filler response settings.
 * When configured, a randomly or sequentially picked sentence is fed into the TTS pipeline
 * at the very start of the response turn, while classification is still running in parallel.
 */
/**
 * Schema for agent filler response settings.
 * When configured, an LLM generates a short neutral sentence that is fed into the TTS pipeline
 * at the very start of the response turn, while classification runs in parallel.
 */
export const fillerSettingsSchema = z.object({
  llmProviderId: z.string().describe('ID of the LLM provider used to generate the filler sentence'),
  llmSettings: llmSettingsSchema.describe('LLM provider-specific settings for filler generation'),
  prompt: z.string().min(1).describe('Prompt instructing the LLM to produce a short neutral filler sentence (e.g. "Generate a single short neutral sentence to fill silence while processing, like \"Hmm, let me think about that.\"")'),
}).openapi('FillerSettings');

/** Settings controlling LLM-generated filler sentence playback at the start of each response turn */
export type FillerSettings = z.infer<typeof fillerSettingsSchema>;

// Route param schema
export const agentRouteParamsSchema = z.object({
  projectId: z.string().min(1).describe('Project ID'),
  id: z.string().describe('Agent ID'),
});

/**
 * Schema for creating a new agent
 * Required fields: id, name, prompt
 * Optional fields: description, ttsSettings, metadata
 */
export const createAgentSchema = z.object({
  id: z.string().min(1).optional().describe('Unique identifier for the agent (auto-generated if not provided)'),
  name: z.string().min(1).describe('Display name of the agent'),
  description: z.string().optional().describe('Detailed description of the agent purpose'),
  prompt: z.string().min(1).describe('Detailed prompt defining the agent\'s characteristics and behavior'),
  ttsProviderId: z.string().optional().describe('ID of the TTS provider (e.g., "eleven-labs")'),
  ttsSettings: ttsSettingsSchema.describe('TTS provider-specific settings'),
  tags: z.array(z.string()).optional().default([]).describe('Tags for categorizing and filtering this agent'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Additional agent-specific metadata'),
  fillerSettings: fillerSettingsSchema.optional().describe('Filler response settings: a short sentence spoken through TTS at the very start of each turn while classification runs in parallel'),
});

/**
 * Schema for updating an agent
 * Optional fields: name, description, prompt, ttsSettings, metadata, version
 * Version is required for optimistic locking
 */
export const updateAgentBodySchema = z.object({
  name: z.string().min(1).optional().describe('Updated display name'),
  description: z.string().optional().nullable().describe('Updated detailed description of the agent'),
  prompt: z.string().min(1).optional().describe('Updated prompt defining behavior'),
  ttsProviderId: z.string().optional().nullable().describe('Updated TTS provider ID'),
  ttsSettings: ttsSettingsSchema.nullable().describe('Updated TTS provider-specific settings'),
  tags: z.array(z.string()).optional().describe('Updated tags'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Updated metadata'),
  fillerSettings: fillerSettingsSchema.optional().nullable().describe('Updated filler response settings'),
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for deleting an agent
 * Required field: version for optimistic locking
 */
export const deleteAgentBodySchema = z.object({
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for agent response
 * Includes: id, name, description, prompt, ttsSettings, metadata, version, createdAt, updatedAt
 */
export const agentResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the agent'),
  projectId: z.string().describe('ID of the project this agent belongs to'),
  name: z.string().describe('Display name of the agent'),
  description: z.string().nullable().describe('Detailed description of the agent purpose'),
  prompt: z.string().describe('Prompt defining the agent\'s characteristics and behavior'),
  ttsProviderId: z.string().nullable().describe('ID of the TTS provider'),
  ttsSettings: ttsSettingsSchema.nullable().describe('TTS provider-specific settings'),
  tags: z.array(z.string()).describe('Tags for categorizing and filtering this agent'),
  metadata: z.record(z.string(), z.unknown()).nullable().describe('Additional agent-specific metadata'),
  fillerSettings: fillerSettingsSchema.nullable().describe('Filler response settings'),
  version: z.number().int().describe('Version number for optimistic locking'),
  createdAt: z.coerce.date().describe('Timestamp when the agent was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the agent was last updated'),
  archived: z.boolean().optional().describe('Whether this entity belongs to an archived project'),
});

/**
 * Schema for paginated list of agents
 * Includes pagination metadata: items, total count, offset, and limit
 */
export const agentListResponseSchema = z.object({
  items: z.array(agentResponseSchema).describe('Array of agents in the current page'),
  total: z.number().int().min(0).describe('Total number of agents matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: listResponseLimitSchema,
});

/**
 * Schema for cloning an agent
 * All fields are optional - id defaults to auto-generated, name defaults to "{original name} (Clone)"
 */
export const cloneAgentSchema = z.object({
  id: z.string().min(1).optional().describe('New ID for the cloned agent (auto-generated if not provided)'),
  name: z.string().min(1).optional().describe('Name for the cloned agent (defaults to "{original name} (Clone)")'),
});

/** Request body for creating a new agent */
export type CreateAgentRequest = z.infer<typeof createAgentSchema>;

/** Request body for updating an agent */
export type UpdateAgentRequest = z.infer<typeof updateAgentBodySchema>;

/** Request body for deleting an agent */
export type DeleteAgentRequest = z.infer<typeof deleteAgentBodySchema>;

/** Request body for cloning an agent */
export type CloneAgentRequest = z.infer<typeof cloneAgentSchema>;

/** Response for a single agent */
export type AgentResponse = z.infer<typeof agentResponseSchema>;

/** Response for paginated list of agents with metadata */
export type AgentListResponse = z.infer<typeof agentListResponseSchema>;
