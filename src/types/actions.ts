import { z } from 'zod';

// Operation schemas and types for stage actions and global actions

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
 * Schema for a single user profile modification operation
 */
export const userProfileOperationSchema = z.object({
  fieldName: z.string().min(1).describe('Name of the profile field to modify'),
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
 * Operation type: Modify User Profile
 * Updates user profile fields using specific operations
 */
export const modifyUserProfileOperationSchema = z.object({
  type: z.literal('modify_user_profile').describe('Operation type'),
  modifications: z.array(userProfileOperationSchema).min(1).describe('Array of user profile field modifications to apply'),
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
  modifyUserProfileOperationSchema,
  callToolOperationSchema,
  callWebhookOperationSchema,
]);

// Infer types from schemas
export type EndConversationOperation = z.infer<typeof endConversationOperationSchema>;
export type AbortConversationOperation = z.infer<typeof abortConversationOperationSchema>;
export type GoToStageOperation = z.infer<typeof goToStageOperationSchema>;
export type RunScriptOperation = z.infer<typeof runScriptOperationSchema>;
export type ModifyUserInputOperation = z.infer<typeof modifyUserInputOperationSchema>;
export type VariableOperation = z.infer<typeof variableOperationSchema>;
export type UserProfileOperation = z.infer<typeof userProfileOperationSchema>;
export type ModifyVariablesOperation = z.infer<typeof modifyVariablesOperationSchema>;
export type ModifyUserProfileOperation = z.infer<typeof modifyUserProfileOperationSchema>;
export type CallToolOperation = z.infer<typeof callToolOperationSchema>;
export type CallWebhookOperation = z.infer<typeof callWebhookOperationSchema>;
export type Operation = z.infer<typeof operationSchema>;

/**
 * Schema for a single stage action
 * Defines an action available within a conversation stage
 */
export const stageActionSchema = z.object({
  name: z.string().min(1).describe('Display name of the action'),
  condition: z.string().nullable().optional().describe('Optional condition expression for action activation'),
  triggerOnUserInput: z.boolean().describe('Whether this action should be triggered on user input'),
  triggerOnClientCommand: z.boolean().describe('Whether this action should be triggered on client commands'),
  classificationTrigger: z.string().nullable().optional().describe('Optional classification label that triggers this action'),
  overrideClassifierId: z.string().nullable().optional().describe('Optional classifier ID to override the stage classifier for this action'),
  operations: z.array(operationSchema).describe('Array of operations to execute when action is triggered'),
  template: z.string().nullable().optional().describe('Optional message template for the action'),
  examples: z.array(z.string()).nullable().optional().describe('Example phrases that trigger this action'),
  metadata: z.record(z.string(), z.unknown()).nullable().optional().describe('Additional action-specific metadata'),
});

export type StageAction = z.infer<typeof stageActionSchema>;