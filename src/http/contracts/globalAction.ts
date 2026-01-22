import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema } from './common';
import type { ListParams } from './common';
import {
  operationSchema,
  endConversationOperationSchema,
  abortConversationOperationSchema,
  goToStageOperationSchema,
  runScriptOperationSchema,
  modifyUserInputOperationSchema,
  modifyVariablesOperationSchema,
  variableOperationSchema,
  callToolOperationSchema,
} from './stage';
import type {
  Operation,
  EndConversationOperation,
  AbortConversationOperation,
  GoToStageOperation,
  RunScriptOperation,
  ModifyUserInputOperation,
  ModifyVariablesOperation,
  VariableOperation,
  CallToolOperation,
} from './stage';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };
export {
  operationSchema,
  endConversationOperationSchema,
  abortConversationOperationSchema,
  goToStageOperationSchema,
  runScriptOperationSchema,
  modifyUserInputOperationSchema,
  modifyVariablesOperationSchema,
  variableOperationSchema,
  callToolOperationSchema,
};
export type {
  Operation,
  EndConversationOperation,
  AbortConversationOperation,
  GoToStageOperation,
  RunScriptOperation,
  ModifyUserInputOperation,
  ModifyVariablesOperation,
  VariableOperation,
  CallToolOperation,
};

/**
 * Schema for creating a new global action
 * Required fields: id, name, promptTrigger
 * Optional fields: condition, operations, template, examples, metadata
 */
export const createGlobalActionSchema = z.object({
  id: z.string().min(1).describe('Unique identifier for the global action'),
  projectId: z.string().min(1).describe('ID of the project this global action belongs to'),
  name: z.string().min(1).describe('Display name of the global action'),
  condition: z.string().nullable().optional().describe('Optional condition expression for action activation'),
  promptTrigger: z.string().min(1).describe('Description of when this action should be triggered'),
  operations: z.array(operationSchema).optional().describe('Array of operations to execute when action is triggered'),
  template: z.string().nullable().optional().describe('Optional message template for the action'),
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
  promptTrigger: z.string().min(1).optional().describe('Updated prompt trigger description'),
  operations: z.array(operationSchema).optional().describe('Updated operations array'),
  template: z.string().nullable().optional().describe('Updated message template'),
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
  promptTrigger: z.string().describe('Description of when this action should be triggered'),
  operations: z.array(operationSchema).describe('Array of operations to execute'),
  template: z.string().nullable().describe('Message template for the action'),
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

/** Response for a single global action */
export type GlobalActionResponse = z.infer<typeof globalActionResponseSchema>;

/** Response for paginated list of global actions with metadata */
export type GlobalActionListResponse = z.infer<typeof globalActionListResponseSchema>;
