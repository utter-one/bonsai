import { z } from 'zod';

// Effect schemas and types for stage actions and global actions

/**
 * Effect type: End Conversation
 * Gracefully ends conversation with an AI response
 */
export const endConversationEffectSchema = z.object({
  type: z.literal('end_conversation').describe('Effect type'),
  reason: z.string().optional().describe('Optional reason for ending the conversation'),
});

/**
 * Effect type: Abort Conversation
 * Immediately ends conversation without AI response
 */
export const abortConversationEffectSchema = z.object({
  type: z.literal('abort_conversation').describe('Effect type'),
  reason: z.string().optional().describe('Optional reason for aborting the conversation'),
});

/**
 * Effect type: Go To Stage
 * Switches the conversation to a different stage
 */
export const goToStageEffectSchema = z.object({
  type: z.literal('go_to_stage').describe('Effect type'),
  stageId: z.string().min(1).describe('ID of the stage to switch to'),
});

/**
 * Effect type: Run Script
 * Runs an isolated JavaScript code that can modify stage state and variables
 */
export const runScriptEffectSchema = z.object({
  type: z.literal('run_script').describe('Effect type'),
  code: z.string().min(1).describe('JavaScript code to execute in isolated context'),
});

/**
 * Effect type: Modify User Input
 * Changes the contents of user input using a template (can replace, redact, or inject whisper)
 */
export const modifyUserInputEffectSchema = z.object({
  type: z.literal('modify_user_input').describe('Effect type'),
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
 * Effect type: Modify Variables
 * Updates stage variables using specific operations
 */
export const modifyVariablesEffectSchema = z.object({
  type: z.literal('modify_variables').describe('Effect type'),
  modifications: z.array(variableOperationSchema).min(1).describe('Array of variable modifications to apply'),
});

/**
 * Effect type: Modify User Profile
 * Updates user profile fields using specific operations
 */
export const modifyUserProfileEffectSchema = z.object({
  type: z.literal('modify_user_profile').describe('Effect type'),
  modifications: z.array(userProfileOperationSchema).min(1).describe('Array of user profile field modifications to apply'),
});

/**
 * Effect type: Call Tool
 * Calls a selected tool with parameters and puts the result in context
 */
export const callToolEffectSchema = z.object({
  type: z.literal('call_tool').describe('Effect type'),
  toolId: z.string().min(1).describe('ID of the tool to call'),
  parameters: z.record(z.string(), z.unknown()).describe('Parameters to pass to the tool'),
});

/**
 * Effect type: Call Webhook
 * Calls an HTTP(S) endpoint and stores the result in conversation context
 */
export const callWebhookEffectSchema = z.object({
  type: z.literal('call_webhook').describe('Effect type'),
  url: z.string().url().describe('HTTP(S) URL to call'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional().default('GET').describe('HTTP method to use'),
  headers: z.record(z.string(), z.string()).optional().describe('HTTP headers to send with the request'),
  body: z.unknown().optional().describe('Request body for POST/PUT/PATCH requests'),
  resultKey: z.string().min(1).describe('Key name to store the webhook result under in context.results.webhooks'),
});

/**
 * Discriminated union of all effect types
 * Defines the possible effects that can be executed in stage actions or global actions
 */
export const effectSchema = z.discriminatedUnion('type', [
  endConversationEffectSchema,
  abortConversationEffectSchema,
  goToStageEffectSchema,
  runScriptEffectSchema,
  modifyUserInputEffectSchema,
  modifyVariablesEffectSchema,
  modifyUserProfileEffectSchema,
  callToolEffectSchema,
  callWebhookEffectSchema,
]);

// Infer types from schemas
export type EndConversationEffect = z.infer<typeof endConversationEffectSchema>;
export type AbortConversationEffect = z.infer<typeof abortConversationEffectSchema>;
export type GoToStageEffect = z.infer<typeof goToStageEffectSchema>;
export type RunScriptEffect = z.infer<typeof runScriptEffectSchema>;
export type ModifyUserInputEffect = z.infer<typeof modifyUserInputEffectSchema>;
export type VariableOperation = z.infer<typeof variableOperationSchema>;
export type UserProfileOperation = z.infer<typeof userProfileOperationSchema>;
export type ModifyVariablesEffect = z.infer<typeof modifyVariablesEffectSchema>;
export type ModifyUserProfileEffect = z.infer<typeof modifyUserProfileEffectSchema>;
export type CallToolEffect = z.infer<typeof callToolEffectSchema>;
export type CallWebhookEffect = z.infer<typeof callWebhookEffectSchema>;
export type Effect = z.infer<typeof effectSchema>;

/**
 * Schema for parameter types supported in stage actions
 * Defines the valid parameter types that can be extracted from user input
 */
export const stageActionParameterTypeSchema = z.enum([
  'string',
  'number',
  'boolean',
  'string[]',
  'number[]',
  'boolean[]',
]).describe('Type of the parameter: string, number, boolean, or arrays of these');

/**
 * Schema for a single stage action parameter
 * Defines a parameter that can be extracted from user input and passed to effects
 */
export const stageActionParameterSchema = z.object({
  name: z.string().min(1).describe('Name of the parameter (used as key when passing to effects)'),
  type: stageActionParameterTypeSchema.describe('Expected type of the parameter value'),
  description: z.string().min(1).describe('Description of what the parameter represents (helps with extraction)'),
  required: z.boolean().describe('Whether this parameter must be present in the user input'),
});

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
  parameters: z.array(stageActionParameterSchema).describe('Optional array of parameters to extract from user input'),
  effects: z.array(effectSchema).describe('Array of effects to execute when action is triggered'),
  template: z.string().nullable().optional().describe('Optional message template for the action'),
  examples: z.array(z.string()).nullable().optional().describe('Example phrases that trigger this action'),
  metadata: z.record(z.string(), z.unknown()).nullable().optional().describe('Additional action-specific metadata'),
});

export type StageActionParameterType = z.infer<typeof stageActionParameterTypeSchema>;
export type StageActionParameter = z.infer<typeof stageActionParameterSchema>;
export type StageAction = z.infer<typeof stageActionSchema>;