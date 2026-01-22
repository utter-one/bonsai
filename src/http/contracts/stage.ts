import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema } from './common';
import type { ListParams } from './common';
import type { StageAction, Operation, EndConversationOperation, AbortConversationOperation, GoToStageOperation, RunScriptOperation, ModifyUserInputOperation, ModifyVariablesOperation, VariableOperation, CallToolOperation, CallWebhookOperation } from '../../types/models';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };

/**
 * Operation type: End Conversation
 * Gracefully ends conversation with an AI response
 */
export const endConversationOperationSchema = z.object({
  type: z.literal('end_conversation').describe('Operation type'),
  reason: z.string().optional().describe('Optional reason for ending the conversation'),
});

/**
 * Operation type: Abort Conversation
 * Immediately ends conversation without AI response
 */
export const abortConversationOperationSchema = z.object({
  type: z.literal('abort_conversation').describe('Operation type'),
  reason: z.string().optional().describe('Optional reason for aborting the conversation'),
});

/**
 * Operation type: Go To Stage
 * Switches the conversation to a different stage
 */
export const goToStageOperationSchema = z.object({
  type: z.literal('go_to_stage').describe('Operation type'),
  stageId: z.string().min(1).describe('ID of the stage to switch to'),
});

/**
 * Operation type: Run Script
 * Runs an isolated JavaScript code that can modify stage state and variables
 */
export const runScriptOperationSchema = z.object({
  type: z.literal('run_script').describe('Operation type'),
  code: z.string().min(1).describe('JavaScript code to execute in isolated context'),
});

/**
 * Operation type: Modify User Input
 * Changes the contents of user input using a template (can replace, redact, or inject whisper)
 */
export const modifyUserInputOperationSchema = z.object({
  type: z.literal('modify_user_input').describe('Operation type'),
  template: z.string().min(1).describe('Template to render and replace user input with'),
});

/**
 * Schema for a single variable modification operation
 */
export const variableOperationSchema = z.object({
  variableName: z.string().min(1).describe('Name of the variable to modify'),
  operation: z.enum(['set', 'reset', 'add', 'remove']).describe('Operation to perform: set (assign value), reset (clear value), add (append to array), remove (remove from array)'),
  value: z.unknown().describe('Value for the operation (not used for reset operation)'),
});

/**
 * Operation type: Modify Variables
 * Updates stage variables using specific operations
 */
export const modifyVariablesOperationSchema = z.object({
  type: z.literal('modify_variables').describe('Operation type'),
  modifications: z.array(variableOperationSchema).min(1).describe('Array of variable modifications to apply'),
});

/**
 * Operation type: Call Tool
 * Calls a selected tool with parameters and puts the result in context
 */
export const callToolOperationSchema = z.object({
  type: z.literal('call_tool').describe('Operation type'),
  toolId: z.string().min(1).describe('ID of the tool to call'),
  parameters: z.record(z.string(), z.unknown()).describe('Parameters to pass to the tool'),
});

/**
 * Operation type: Call Webhook
 * Calls an HTTP(S) endpoint and stores the result in conversation context
 */
export const callWebhookOperationSchema = z.object({
  type: z.literal('call_webhook').describe('Operation type'),
  url: z.string().url().describe('HTTP(S) URL to call'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional().default('GET').describe('HTTP method to use'),
  headers: z.record(z.string(), z.string()).optional().describe('HTTP headers to send with the request'),
  body: z.unknown().optional().describe('Request body for POST/PUT/PATCH requests'),
  resultKey: z.string().min(1).describe('Key name to store the webhook result under in context.results.webhooks'),
});

/**
 * Discriminated union of all operation types
 * Defines the possible operations that can be executed in stage actions or global actions
 */
export const operationSchema = z.discriminatedUnion('type', [
  endConversationOperationSchema,
  abortConversationOperationSchema,
  goToStageOperationSchema,
  runScriptOperationSchema,
  modifyUserInputOperationSchema,
  modifyVariablesOperationSchema,
  callToolOperationSchema,
  callWebhookOperationSchema,
]);

/**
 * Schema for enter behavior configuration
 * Defines what happens when a conversation enters this stage
 */
export const enterBehaviorSchema = z.enum(['generate_response', 'await_user_input']).describe('What should happen when entering the stage');

/**
 * Schema for variable definitions
 * Defines variables available in this conversation stage
 */
export const variablesSchema = z.record(z.string(), z.unknown()).describe('Variable definitions for this stage');

/**
 * Schema for a single stage action
 * Defines an action available within a conversation stage (similar structure to global actions)
 */
export const stageActionSchema = z.object({
  name: z.string().min(1).describe('Display name of the action'),
  condition: z.string().nullable().optional().describe('Optional condition expression for action activation'),
  promptTrigger: z.string().min(1).describe('Description of when this action should be triggered'),
  operations: z.array(operationSchema).describe('Array of operations to execute when action is triggered'),
  template: z.string().nullable().optional().describe('Optional message template for the action'),
  examples: z.array(z.string()).nullable().optional().describe('Example phrases that trigger this action'),
  metadata: z.record(z.string(), z.unknown()).nullable().optional().describe('Additional action-specific metadata'),
});

/**
 * Schema for action definitions
 * Defines a map of actions available in this conversation stage
 */
export const actionsSchema = z.record(z.string(), stageActionSchema).describe('Action definitions for this stage (map of action ID to action definition)');

/**
 * Schema for creating a new stage
 * Required fields: id, prompt, personaId
 * Optional fields: llmProviderId, enterBehavior, useKnowledge, knowledgeSections, useGlobalActions, globalActions, variables, actions, classifierIds, transformerIds, metadata
 */
export const createStageSchema = z.object({
  id: z.string().min(1).describe('Unique identifier for the stage'),
  projectId: z.string().min(1).describe('ID of the project this stage belongs to'),
  prompt: z.string().min(1).describe('System prompt that defines the stage behavior and instructions'),
  llmProviderId: z.string().nullable().optional().describe('ID of the LLM provider to use for this stage'),
  personaId: z.string().min(1).describe('ID of the persona associated with this stage'),
  enterBehavior: enterBehaviorSchema.optional().default('generate_response').describe('What should happen when entering the stage'),
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
  enterBehavior: enterBehaviorSchema.optional().describe('Updated behavior when entering this stage'),
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
  projectId: z.string().describe('ID of the project this stage belongs to'),
  prompt: z.string().describe('System prompt defining the stage behavior'),
  llmProviderId: z.string().nullable().describe('ID of the LLM provider'),
  personaId: z.string().describe('ID of the associated persona'),
  enterBehavior: enterBehaviorSchema.describe('What happens when entering the stage'),
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

// Re-export types from models.ts for convenience
export type { StageAction, Operation, EndConversationOperation, AbortConversationOperation, GoToStageOperation, RunScriptOperation, ModifyUserInputOperation, ModifyVariablesOperation, VariableOperation, CallToolOperation, CallWebhookOperation };