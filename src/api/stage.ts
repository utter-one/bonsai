import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema } from './common';
import type { ListParams } from './common';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };

/**
 * Schema for enter behavior configuration
 * Defines what happens when a conversation enters this stage
 */
export const enterBehaviorSchema = z.record(z.string(), z.unknown()).describe('Configuration for stage entry behavior');

/**
 * Schema for variable definitions
 * Defines variables available in this conversation stage
 */
export const variablesSchema = z.record(z.string(), z.unknown()).describe('Variable definitions for this stage');

/**
 * Schema for action definitions
 * Defines actions available in this conversation stage
 */
export const actionsSchema = z.record(z.string(), z.unknown()).describe('Action definitions for this stage');

/**
 * Schema for creating a new stage
 * Required fields: id, prompt, personaId
 * Optional fields: llmProviderId, enterBehavior, useKnowledge, knowledgeSections, useGlobalActions, globalActions, variables, actions, classifierIds, transformerIds, metadata
 */
export const createStageSchema = z.object({
  id: z.string().min(1).describe('Unique identifier for the stage'),
  prompt: z.string().min(1).describe('System prompt that defines the stage behavior and instructions'),
  llmProviderId: z.string().nullable().optional().describe('ID of the LLM provider to use for this stage'),
  personaId: z.string().min(1).describe('ID of the persona associated with this stage'),
  enterBehavior: enterBehaviorSchema.optional().describe('Behavior configuration when entering this stage'),
  useKnowledge: z.boolean().optional().default(false).describe('Whether to use knowledge base in this stage'),
  knowledgeSections: z.array(z.string()).optional().default([]).describe('List of knowledge section IDs to include'),
  useGlobalActions: z.boolean().optional().default(true).describe('Whether to enable global actions in this stage'),
  globalActions: z.array(z.string()).optional().default([]).describe('List of global action IDs available in this stage'),
  variables: variablesSchema.optional().describe('Variable definitions for this stage'),
  actions: actionsSchema.optional().describe('Action definitions for this stage'),
  classifierIds: z.array(z.string()).optional().default([]).describe('List of classifier IDs to use in this stage'),
  transformerIds: z.array(z.string()).optional().default([]).describe('List of context transformer IDs to use in this stage'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Additional stage-specific metadata'),
});

/**
 * Schema for updating a stage
 * All fields are optional except version for optimistic locking
 */
export const updateStageBodySchema = z.object({
  prompt: z.string().min(1).optional().describe('Updated system prompt'),
  llmProviderId: z.string().nullable().optional().describe('Updated LLM provider ID'),
  personaId: z.string().min(1).optional().describe('Updated persona ID'),
  enterBehavior: enterBehaviorSchema.optional().describe('Updated enter behavior configuration'),
  useKnowledge: z.boolean().optional().describe('Updated knowledge usage flag'),
  knowledgeSections: z.array(z.string()).optional().describe('Updated knowledge section IDs'),
  useGlobalActions: z.boolean().optional().describe('Updated global actions flag'),
  globalActions: z.array(z.string()).optional().describe('Updated global action IDs'),
  variables: variablesSchema.optional().describe('Updated variable definitions'),
  actions: actionsSchema.optional().describe('Updated action definitions'),
  classifierIds: z.array(z.string()).optional().describe('Updated classifier IDs'),
  transformerIds: z.array(z.string()).optional().describe('Updated transformer IDs'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Updated metadata'),
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for deleting a stage
 * Required field: version for optimistic locking
 */
export const deleteStageBodySchema = z.object({
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for stage response
 * Includes all fields from the database schema
 */
export const stageResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the stage'),
  prompt: z.string().describe('System prompt defining the stage behavior'),
  llmProviderId: z.string().nullable().describe('ID of the LLM provider'),
  personaId: z.string().describe('ID of the associated persona'),
  enterBehavior: enterBehaviorSchema.describe('Stage entry behavior configuration'),
  useKnowledge: z.boolean().describe('Whether knowledge base is enabled'),
  knowledgeSections: z.array(z.string()).describe('Knowledge section IDs included in this stage'),
  useGlobalActions: z.boolean().describe('Whether global actions are enabled'),
  globalActions: z.array(z.string()).describe('Global action IDs available in this stage'),
  variables: variablesSchema.describe('Variable definitions'),
  actions: actionsSchema.describe('Action definitions'),
  classifierIds: z.array(z.string()).describe('Classifier IDs used in this stage'),
  transformerIds: z.array(z.string()).describe('Context transformer IDs used in this stage'),
  metadata: z.record(z.string(), z.unknown()).nullable().describe('Additional metadata'),
  version: z.number().int().describe('Version number for optimistic locking'),
  createdAt: z.coerce.date().describe('Timestamp when the stage was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the stage was last updated'),
});

/**
 * Schema for paginated list of stages
 * Includes pagination metadata: items, total count, offset, and limit
 */
export const stageListResponseSchema = z.object({
  items: z.array(stageResponseSchema).describe('Array of stages in the current page'),
  total: z.number().int().min(0).describe('Total number of stages matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: z.number().int().positive().nullable().describe('Maximum number of items per page (null if no limit)'),
});

/** Request body for creating a new stage */
export type CreateStageRequest = z.infer<typeof createStageSchema>;

/** Request body for updating a stage */
export type UpdateStageRequest = z.infer<typeof updateStageBodySchema>;

/** Request body for deleting a stage */
export type DeleteStageRequest = z.infer<typeof deleteStageBodySchema>;

/** Response for a single stage */
export type StageResponse = z.infer<typeof stageResponseSchema>;

/** Response for paginated list of stages with metadata */
export type StageListResponse = z.infer<typeof stageListResponseSchema>;
