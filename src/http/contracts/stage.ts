import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema, llmSettingsSchema } from './common';
import type { ListParams } from './common';
import { fieldDescriptorSchema } from '../../types/parameters';
import type { FieldDescriptor } from '../../types/parameters';
import {
  effectSchema,
  endConversationEffectSchema,
  abortConversationEffectSchema,
  goToStageEffectSchema,
  runScriptEffectSchema,
  modifyUserInputEffectSchema,
  modifyVariablesEffectSchema,
  modifyUserProfileEffectSchema,
  variableOperationSchema,
  userProfileOperationSchema,
  callToolEffectSchema,
  callWebhookEffectSchema,
  stageActionSchema,
} from '../../types/actions';
import type {
  Effect,
  EndConversationEffect,
  AbortConversationEffect,
  GoToStageEffect,
  RunScriptEffect,
  ModifyUserInputEffect,
  ModifyVariablesEffect,
  ModifyUserProfileEffect,
  VariableOperation,
  UserProfileOperation,
  CallToolEffect,
  CallWebhookEffect,
  StageAction,
} from '../../types/actions';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };

// Re-export effect schemas and types
export {
  effectSchema,
  endConversationEffectSchema,
  abortConversationEffectSchema,
  goToStageEffectSchema,
  runScriptEffectSchema,
  modifyUserInputEffectSchema,
  modifyVariablesEffectSchema,
  modifyUserProfileEffectSchema,
  variableOperationSchema,
  userProfileOperationSchema,
  callToolEffectSchema,
  callWebhookEffectSchema,
  stageActionSchema,
};

export type {
  Effect,
  EndConversationEffect,
  AbortConversationEffect,
  GoToStageEffect,
  RunScriptEffect,
  ModifyUserInputEffect,
  ModifyVariablesEffect,
  ModifyUserProfileEffect,
  VariableOperation,
  UserProfileOperation,
  CallToolEffect,
  CallWebhookEffect,
  StageAction,
};

/**
 * Schema for stage route parameters
 */
export const stageRouteParamsSchema = z.object({
  projectId: z.string().min(1).describe('Project ID'),
  id: z.string().min(1).describe('Stage ID'),
});

export type StageRouteParams = z.infer<typeof stageRouteParamsSchema>;

/**
 * Schema for enter behavior configuration
 * Defines what happens when a conversation enters this stage
 */
export const enterBehaviorSchema = z.enum(['generate_response', 'await_user_input']).describe('What should happen when entering the stage');

/**
 * Schema for variable descriptor definitions
 * Defines the schema of variables available in this conversation stage
 */
export const variableDescriptorsSchema = z.array(fieldDescriptorSchema).describe('Variable descriptor definitions for this stage');

/**
 * Schema for action definitions
 * Defines a map of actions available in this conversation stage
 * 
 * **Reserved Lifecycle Action Keys:**
 * Actions with double-underscore prefixes are reserved for lifecycle hooks:
 * 
 * - `__on_enter`: Executed when entering the stage (after providers are initialized, before enterBehavior).
 *   Effects ignored: end_conversation, abort_conversation, go_to_stage.
 *   Use cases: Initialize variables, fetch data, set up context.
 * 
 * - `__on_leave`: Executed when leaving the stage (before loading new stage).
 *   Effects ignored: go_to_stage, generate_response.
 *   Use cases: Cleanup, validation, persist data before transition.
 * 
 * - `__on_fallback`: Executed when no user action matches after classification.
 *   No effect restrictions - can do anything.
 *   Use cases: Help messages, clarification requests, error handling.
 * 
 * Lifecycle actions are optional and provide hooks for stage-specific behavior.
 * Regular actions (without __ prefix) are matched via classification from user input.
 */
export const actionsSchema = z.record(z.string(), stageActionSchema).describe('Action definitions for this stage (map of action ID to action definition)');

/**
 * Schema for creating a new stage
 * Required fields: id, prompt, personaId
 * Optional fields: llmProviderId, enterBehavior, useKnowledge, useGlobalActions, globalActions, variableDescriptors, actions, defaultClassifierId, transformerIds, metadata
 */
export const createStageSchema = z.object({
  id: z.string().min(1).optional().describe('Unique identifier for the stage (auto-generated if not provided)'),
  name: z.string().min(1).describe('Display name for the stage'),
  description: z.string().optional().describe('Detailed description of the stage purpose'),
  prompt: z.string().min(1).describe('System prompt that defines the stage behavior and instructions'),
  llmProviderId: z.string().nullable().optional().describe('ID of the LLM provider to use for this stage'),
  llmSettings: llmSettingsSchema.describe('LLM provider-specific settings for this stage'),
  personaId: z.string().min(1).describe('ID of the persona associated with this stage'),
  enterBehavior: enterBehaviorSchema.optional().default('generate_response').describe('What should happen when entering the stage'),
  useKnowledge: z.boolean().optional().default(false).describe('Whether to use knowledge base in this stage'),
  knowledgeTags: z.array(z.string()).optional().default([]).describe('List of knowledge tags to include'),
  useGlobalActions: z.boolean().optional().default(true).describe('Whether to enable global actions in this stage'),
  globalActions: z.array(z.string()).optional().default([]).describe('List of global action IDs available in this stage'),
  variableDescriptors: variableDescriptorsSchema.optional().default([]).describe('Variable descriptor definitions for this stage'),
  actions: actionsSchema.optional().describe('Action definitions for this stage'),
  defaultClassifierId: z.string().nullable().optional().describe('ID of the default classifier to use for this stage (can be overridden per action)'),
  transformerIds: z.array(z.string()).optional().default([]).describe('List of context transformer IDs to use in this stage'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Additional stage-specific metadata'),
});

/**
 * Schema for updating a stage
 * All fields are optional except version for optimistic locking
 */
export const updateStageBodySchema = z.object({
  name: z.string().min(1).optional().describe('Updated display name for the stage'),
  description: z.string().optional().describe('Updated detailed description of the stage'),
  prompt: z.string().min(1).optional().describe('Updated system prompt'),
  llmProviderId: z.string().nullable().optional().describe('Updated LLM provider ID'),
  llmSettings: llmSettingsSchema.describe('Updated LLM provider-specific settings'),
  personaId: z.string().min(1).optional().describe('Updated persona ID'),
  enterBehavior: enterBehaviorSchema.optional().describe('Updated behavior when entering this stage'),
  useKnowledge: z.boolean().optional().describe('Updated knowledge usage flag'),
  knowledgeTags: z.array(z.string()).optional().describe('Updated knowledge tags'),
  useGlobalActions: z.boolean().optional().describe('Updated global actions flag'),
  globalActions: z.array(z.string()).optional().describe('Updated global action IDs'),
  variableDescriptors: variableDescriptorsSchema.optional().describe('Updated variable descriptor definitions'),
  actions: actionsSchema.optional().describe('Updated action definitions'),
  defaultClassifierId: z.string().nullable().optional().describe('Updated default classifier ID'),
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
  projectId: z.string().describe('ID of the project this stage belongs to'),
  name: z.string().describe('Display name for the stage'),
  description: z.string().nullable().describe('Detailed description of the stage purpose'),
  prompt: z.string().describe('System prompt defining the stage behavior'),
  llmProviderId: z.string().nullable().describe('ID of the LLM provider'),
  llmSettings: llmSettingsSchema.describe('LLM provider-specific settings'),
  personaId: z.string().describe('ID of the associated persona'),
  enterBehavior: enterBehaviorSchema.describe('What happens when entering the stage'),
  useKnowledge: z.boolean().describe('Whether knowledge base is enabled'),
  knowledgeTags: z.array(z.string()).describe('Knowledge tags included in this stage'),
  useGlobalActions: z.boolean().describe('Whether global actions are enabled'),
  globalActions: z.array(z.string()).describe('Global action IDs available in this stage'),
  variableDescriptors: variableDescriptorsSchema.describe('Variable descriptor definitions'),
  actions: actionsSchema.describe('Action definitions'),
  defaultClassifierId: z.string().nullable().describe('Default classifier ID used in this stage (actions can override with overrideClassifierId)'),
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

/**
 * Schema for cloning a stage
 * All fields are optional - id defaults to auto-generated, name defaults to "{original name} (Clone)"
 */
export const cloneStageSchema = z.object({
  id: z.string().min(1).optional().describe('New ID for the cloned stage (auto-generated if not provided)'),
  name: z.string().min(1).optional().describe('Name for the cloned stage (defaults to "{original name} (Clone)")'),
});

/** Request body for creating a new stage */
export type CreateStageRequest = z.infer<typeof createStageSchema>;

/** Request body for updating a stage */
export type UpdateStageRequest = z.infer<typeof updateStageBodySchema>;

/** Request body for deleting a stage */
export type DeleteStageRequest = z.infer<typeof deleteStageBodySchema>;

/** Request body for cloning a stage */
export type CloneStageRequest = z.infer<typeof cloneStageSchema>;

/** Response for a single stage */
export type StageResponse = z.infer<typeof stageResponseSchema>;

/** Response for paginated list of stages with metadata */
export type StageListResponse = z.infer<typeof stageListResponseSchema>;