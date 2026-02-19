import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema } from './common';
import type { ListParams } from './common';
import {
  effectSchema,
  endConversationEffectSchema,
  abortConversationEffectSchema,
  goToStageEffectSchema,
  runScriptEffectSchema,
  modifyUserInputEffectSchema,
  modifyVariablesEffectSchema,
  variableOperationSchema,
  callToolEffectSchema,
} from '../../types/actions';
import type {
  Effect,
  EndConversationEffect,
  AbortConversationEffect,
  GoToStageEffect,
  RunScriptEffect,
  ModifyUserInputEffect,
  ModifyVariablesEffect,
  VariableOperation,
  CallToolEffect,
} from '../../types/actions';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };

export const globalActionRouteParamsSchema = z.object({
  id: z.string().describe('Global Action ID'),
});

export {
  effectSchema,
  endConversationEffectSchema,
  abortConversationEffectSchema,
  goToStageEffectSchema,
  runScriptEffectSchema,
  modifyUserInputEffectSchema,
  modifyVariablesEffectSchema,
  variableOperationSchema,
  callToolEffectSchema,
};
export type {
  Effect,
  EndConversationEffect,
  AbortConversationEffect,
  GoToStageEffect,
  RunScriptEffect,
  ModifyUserInputEffect,
  ModifyVariablesEffect,
  VariableOperation,
  CallToolEffect,
};

/**
 * Schema for creating a new global action
 * Required fields: id, name, triggerOnUserInput, triggerOnClientCommand
 * Optional fields: condition, classificationTrigger, overrideClassifierId, effects, examples, metadata
 */
export const createGlobalActionSchema = z.object({
  id: z.string().min(1).optional().describe('Unique identifier for the global action (auto-generated if not provided)'),
  projectId: z.string().min(1).describe('ID of the project this global action belongs to'),
  name: z.string().min(1).describe('Display name of the global action'),
  condition: z.string().nullable().optional().describe('Optional condition expression for action activation'),
  triggerOnUserInput: z.boolean().optional().default(true).describe('Whether this action should be triggered on user input'),
  triggerOnClientCommand: z.boolean().optional().default(false).describe('Whether this action should be triggered on client commands'),
  classificationTrigger: z.string().nullable().optional().describe('Optional classification label that triggers this action'),
  overrideClassifierId: z.string().nullable().optional().describe('Optional classifier ID - if set, this action is only enumerated for that specific classifier'),
  effects: z.array(effectSchema).optional().describe('Array of effects to execute when action is triggered'),
  examples: z.array(z.string()).optional().describe('Example phrases that trigger this action'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Additional action-specific metadata'),
});

/**
 * Schema for updating a global action
 * All fields are optional except version for optimistic locking
 */
export const updateGlobalActionBodySchema = z.object({
  name: z.string().min(1).optional().describe('Updated display name'),
  condition: z.string().nullable().optional().describe('Updated condition expression'),
  triggerOnUserInput: z.boolean().optional().describe('Updated trigger on user input flag'),
  triggerOnClientCommand: z.boolean().optional().describe('Updated trigger on client command flag'),
  classificationTrigger: z.string().nullable().optional().describe('Updated classification trigger label'),
  overrideClassifierId: z.string().nullable().optional().describe('Updated override classifier ID'),
  effects: z.array(effectSchema).optional().describe('Updated effects array'),
  examples: z.array(z.string()).optional().describe('Updated example phrases'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Updated metadata'),
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for deleting a global action
 * Required field: version for optimistic locking
 */
export const deleteGlobalActionBodySchema = z.object({
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for global action response
 * Includes all fields from the database schema
 */
export const globalActionResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the global action'),
  projectId: z.string().describe('ID of the project this global action belongs to'),
  name: z.string().describe('Display name of the global action'),
  condition: z.string().nullable().describe('Condition expression for action activation'),
  triggerOnUserInput: z.boolean().describe('Whether this action should be triggered on user input'),
  triggerOnClientCommand: z.boolean().describe('Whether this action should be triggered on client commands'),
  classificationTrigger: z.string().nullable().describe('Optional classification label that triggers this action'),
  overrideClassifierId: z.string().nullable().describe('Optional classifier ID - if set, this action is only enumerated for that specific classifier'),
  effects: z.array(effectSchema).describe('Array of effects to execute'),
  examples: z.array(z.string()).nullable().describe('Example phrases that trigger this action'),
  metadata: z.record(z.string(), z.unknown()).nullable().describe('Additional metadata'),
  version: z.number().int().describe('Version number for optimistic locking'),
  createdAt: z.coerce.date().describe('Timestamp when the global action was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the global action was last updated'),
});

/**
 * Schema for paginated list of global actions
 * Includes pagination metadata: items, total count, offset, and limit
 */
export const globalActionListResponseSchema = z.object({
  items: z.array(globalActionResponseSchema).describe('Array of global actions in the current page'),
  total: z.number().int().min(0).describe('Total number of global actions matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: z.number().int().positive().nullable().describe('Maximum number of items per page (null if no limit)'),
});

/** Request body for creating a new global action */
export type CreateGlobalActionRequest = z.infer<typeof createGlobalActionSchema>;

/** Request body for updating a global action */
export type UpdateGlobalActionRequest = z.infer<typeof updateGlobalActionBodySchema>;

/** Request body for deleting a global action */
export type DeleteGlobalActionRequest = z.infer<typeof deleteGlobalActionBodySchema>;

/**
 * Schema for cloning a global action
 * All fields are optional - id defaults to auto-generated, name defaults to "{original name} (Clone)"
 */
export const cloneGlobalActionSchema = z.object({
  id: z.string().min(1).optional().describe('New ID for the cloned global action (auto-generated if not provided)'),
  name: z.string().min(1).optional().describe('Name for the cloned global action (defaults to "{original name} (Clone)")'),
});

/** Request body for cloning a global action */
export type CloneGlobalActionRequest = z.infer<typeof cloneGlobalActionSchema>;

/** Response for a single global action */
export type GlobalActionResponse = z.infer<typeof globalActionResponseSchema>;

/** Response for paginated list of global actions with metadata */
export type GlobalActionListResponse = z.infer<typeof globalActionListResponseSchema>;
