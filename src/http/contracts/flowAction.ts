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
  stageActionParameterSchema,
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
  StageActionParameter,
} from '../../types/actions';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };

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
  stageActionParameterSchema,
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
  StageActionParameter,
};

/**
 * Schema for flow action route parameters
 */
export const flowActionRouteParamsSchema = z.object({
  projectId: z.string().min(1).describe('Project ID'),
  flowId: z.string().min(1).describe('Flow ID'),
  id: z.string().describe('Flow Action ID'),
});

export type FlowActionRouteParams = z.infer<typeof flowActionRouteParamsSchema>;

/**
 * Schema for creating a new flow action
 * Required fields: name, triggerOnUserInput, triggerOnClientCommand
 * Optional fields: id, condition, classificationTrigger, overrideClassifierId, effects, examples, metadata
 */
export const createFlowActionSchema = z.object({
  id: z.string().min(1).optional().describe('Unique identifier for the flow action (auto-generated if not provided)'),
  name: z.string().min(1).describe('Display name of the flow action'),
  condition: z.string().nullable().optional().describe('Optional condition expression for action activation'),
  triggerOnUserInput: z.boolean().optional().default(true).describe('Whether this action should be triggered on user input'),
  triggerOnClientCommand: z.boolean().optional().default(false).describe('Whether this action should be triggered on client commands'),
  classificationTrigger: z.string().nullable().optional().describe('Optional classification label that triggers this action'),
  overrideClassifierId: z.string().nullable().optional().describe('Optional classifier ID - if set, this action is only enumerated for that specific classifier'),
  parameters: z.array(stageActionParameterSchema).optional().describe('Optional array of parameters to extract from user input'),
  effects: z.array(effectSchema).optional().describe('Array of effects to execute when action is triggered'),
  examples: z.array(z.string()).optional().describe('Example phrases that trigger this action'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Additional action-specific metadata'),
});

/**
 * Schema for updating a flow action
 * All fields are optional except version for optimistic locking
 */
export const updateFlowActionBodySchema = z.object({
  name: z.string().min(1).optional().describe('Updated display name'),
  condition: z.string().nullable().optional().describe('Updated condition expression'),
  triggerOnUserInput: z.boolean().optional().describe('Updated trigger on user input flag'),
  triggerOnClientCommand: z.boolean().optional().describe('Updated trigger on client command flag'),
  classificationTrigger: z.string().nullable().optional().describe('Updated classification trigger label'),
  overrideClassifierId: z.string().nullable().optional().describe('Updated override classifier ID'),
  parameters: z.array(stageActionParameterSchema).optional().describe('Updated parameters array'),
  effects: z.array(effectSchema).optional().describe('Updated effects array'),
  examples: z.array(z.string()).optional().describe('Updated example phrases'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Updated metadata'),
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for deleting a flow action
 * Required field: version for optimistic locking
 */
export const deleteFlowActionBodySchema = z.object({
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for flow action response
 * Includes all fields from the database schema
 */
export const flowActionResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the flow action'),
  projectId: z.string().describe('ID of the project this flow action belongs to'),
  flowId: z.string().describe('ID of the flow this action belongs to'),
  name: z.string().describe('Display name of the flow action'),
  condition: z.string().nullable().describe('Condition expression for action activation'),
  triggerOnUserInput: z.boolean().describe('Whether this action should be triggered on user input'),
  triggerOnClientCommand: z.boolean().describe('Whether this action should be triggered on client commands'),
  classificationTrigger: z.string().nullable().describe('Optional classification label that triggers this action'),
  overrideClassifierId: z.string().nullable().describe('Optional classifier ID - if set, this action is only enumerated for that specific classifier'),
  parameters: z.array(stageActionParameterSchema).describe('Array of parameters to extract from user input'),
  effects: z.array(effectSchema).describe('Array of effects to execute'),
  examples: z.array(z.string()).nullable().describe('Example phrases that trigger this action'),
  metadata: z.record(z.string(), z.unknown()).nullable().describe('Additional metadata'),
  version: z.number().int().describe('Version number for optimistic locking'),
  createdAt: z.coerce.date().describe('Timestamp when the flow action was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the flow action was last updated'),
});

/**
 * Schema for paginated list of flow actions
 * Includes pagination metadata: items, total count, offset, and limit
 */
export const flowActionListResponseSchema = z.object({
  items: z.array(flowActionResponseSchema).describe('Array of flow actions in the current page'),
  total: z.number().int().min(0).describe('Total number of flow actions matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: z.number().int().positive().nullable().describe('Maximum number of items per page (null if no limit)'),
});

/**
 * Schema for cloning a flow action
 * All fields are optional - id defaults to auto-generated, name defaults to "{original name} (Clone)"
 */
export const cloneFlowActionSchema = z.object({
  id: z.string().min(1).optional().describe('New ID for the cloned flow action (auto-generated if not provided)'),
  name: z.string().min(1).optional().describe('Name for the cloned flow action (defaults to "{original name} (Clone)")'),
});

/** Request body for creating a new flow action */
export type CreateFlowActionRequest = z.infer<typeof createFlowActionSchema>;

/** Request body for updating a flow action */
export type UpdateFlowActionRequest = z.infer<typeof updateFlowActionBodySchema>;

/** Request body for deleting a flow action */
export type DeleteFlowActionRequest = z.infer<typeof deleteFlowActionBodySchema>;

/** Request body for cloning a flow action */
export type CloneFlowActionRequest = z.infer<typeof cloneFlowActionSchema>;

/** Response for a single flow action */
export type FlowActionResponse = z.infer<typeof flowActionResponseSchema>;

/** Response for paginated list of flow actions with metadata */
export type FlowActionListResponse = z.infer<typeof flowActionListResponseSchema>;
