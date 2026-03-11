import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { parameterTypeSchema } from './parameters';

extendZodWithOpenApi(z);

// Effect schemas and types for stage actions and global actions

/**
 * Effect type: End Conversation
 * Gracefully ends conversation with an AI response
 */
export const endConversationEffectSchema = z.object({
  type: z.literal('end_conversation').describe('Effect type'),
  reason: z.string().optional().describe('Optional reason for ending the conversation'),
}).openapi('EndConversationEffect');

/**
 * Effect type: Abort Conversation
 * Immediately ends conversation without AI response
 */
export const abortConversationEffectSchema = z.object({
  type: z.literal('abort_conversation').describe('Effect type'),
  reason: z.string().optional().describe('Optional reason for aborting the conversation'),
}).openapi('AbortConversationEffect');

/**
 * Effect type: Go To Stage
 * Switches the conversation to a different stage
 */
export const goToStageEffectSchema = z.object({
  type: z.literal('go_to_stage').describe('Effect type'),
  stageId: z.string().min(1).describe('ID of the stage to switch to'),
}).openapi('GoToStageEffect');

/**
 * Effect type: Run Script
 * Runs an isolated JavaScript code that can modify stage state and variables
 */
export const runScriptEffectSchema = z.object({
  type: z.literal('run_script').describe('Effect type'),
  code: z.string().min(1).describe('JavaScript code to execute in isolated context'),
}).openapi('RunScriptEffect');

/**
 * Effect type: Modify User Input
 * Changes the contents of user input using a template (can replace, redact, or inject whisper)
 */
export const modifyUserInputEffectSchema = z.object({
  type: z.literal('modify_user_input').describe('Effect type'),
  template: z.string().min(1).describe('Template to render and replace user input with'),
}).openapi('ModifyUserInputEffect');

/**
 * Schema for a single variable modification operation
 */
export const variableOperationSchema = z.object({
  variableName: z.string().min(1).describe('Name of the variable to modify'),
  operation: z.enum(['set', 'reset', 'add', 'remove']).describe('Operation to perform: set (assign value), reset (clear value), add (append to array), remove (remove from array)'),
  value: z.unknown().describe('Value for the operation (not used for reset operation)'),
}).openapi('VariableOperation');

/**
 * Schema for a single user profile modification operation
 */
export const userProfileOperationSchema = z.object({
  fieldName: z.string().min(1).describe('Name of the profile field to modify'),
  operation: z.enum(['set', 'reset', 'add', 'remove']).describe('Operation to perform: set (assign value), reset (clear value), add (append to array), remove (remove from array)'),
  value: z.unknown().describe('Value for the operation (not used for reset operation)'),
}).openapi('UserProfileOperation');

/**
 * Effect type: Modify Variables
 * Updates stage variables using specific operations
 */
export const modifyVariablesEffectSchema = z.object({
  type: z.literal('modify_variables').describe('Effect type'),
  modifications: z.array(variableOperationSchema).min(1).describe('Array of variable modifications to apply'),
}).openapi('ModifyVariablesEffect');

/**
 * Effect type: Modify User Profile
 * Updates user profile fields using specific operations
 */
export const modifyUserProfileEffectSchema = z.object({
  type: z.literal('modify_user_profile').describe('Effect type'),
  modifications: z.array(userProfileOperationSchema).min(1).describe('Array of user profile field modifications to apply'),
}).openapi('ModifyUserProfileEffect');

/**
 * Effect type: Call Tool
 * Calls a selected tool with parameters and puts the result in context
 */
export const callToolEffectSchema = z.object({
  type: z.literal('call_tool').describe('Effect type'),
  toolId: z.string().min(1).describe('ID of the tool to call'),
  parameters: z.record(z.string(), z.unknown()).describe('Parameters to pass to the tool'),
}).openapi('CallToolEffect');

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
}).openapi('CallWebhookEffect');

/**
 * Effect type: Generate Response
 * Triggers AI response generation (must be explicitly added to actions)
 */
export const generateResponseEffectSchema = z.object({
  type: z.literal('generate_response').describe('Effect type'),
  responseMode: z.enum(['generated', 'prescripted']).optional().default('generated').describe('Type of response to generate: generated (AI-generated), prescripted (predefined response), best_match (choose the best match from predefined responses)'),
  prescriptedSelectionStrategy: z.enum(['random', 'round_robin']).optional().default('random').describe('Strategy to select prescripted response when multiple are provided'),
  prescriptedResponses: z.array(z.string()).optional().describe('Optional array of prescripted responses to use'),
}).openapi('GenerateResponseEffect');

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
  generateResponseEffectSchema,
]).openapi('Effect');

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
export type GenerateResponseEffect = z.infer<typeof generateResponseEffectSchema>;
export type Effect = z.infer<typeof effectSchema>;


/**
 * Schema for a single stage action parameter
 * Defines a parameter that can be extracted from user input and passed to effects
 */
export const stageActionParameterSchema = z.object({
  name: z.string().min(1).describe('Name of the parameter (used as key when passing to effects)'),
  type: parameterTypeSchema.describe('Expected type of the parameter value'),
  description: z.string().min(1).describe('Description of what the parameter represents (helps with extraction)'),
  required: z.boolean().describe('Whether this parameter must be present in the user input'),
}).openapi('StageActionParameter');

/**
 * Schema for a single tool parameter
 * Defines a parameter that the tool expects to receive when invoked
 */
export const toolParameterSchema = z.object({
  name: z.string().min(1).describe('Name of the parameter (used as key when passing to tool)'),
  type: parameterTypeSchema.describe('Expected type of the parameter value'),
  description: z.string().min(1).describe('Description of what the parameter represents'),
  required: z.boolean().describe('Whether this parameter must be provided when invoking the tool'),
}).openapi('ToolParameter');

export const fieldWatchTriggerSchema = z.enum(['new', 'changed', 'removed', 'any']).describe('Condition for triggering an action based on variable changes: new (variable is created), changed (variable value changes), removed (variable is deleted)');

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
  overrideClassifierId: z.string().nullable().optional().describe('Optional classifier ID - if set, this action is only enumerated for that specific classifier'),
  parameters: z.array(stageActionParameterSchema).describe('Optional array of parameters to extract from user input'),
  effects: z.array(effectSchema).describe('Array of effects to execute when action is triggered'),
  examples: z.array(z.string()).nullable().optional().describe('Example phrases that trigger this action'),
  triggerOnTransformation: z.boolean().optional().default(false).describe('Whether this action should be triggered on variable transformations'),
  watchedVariables: z.record(z.string(), fieldWatchTriggerSchema).optional().describe('Optional map of variable paths to watch for changes that trigger this action'),  
  metadata: z.record(z.string(), z.unknown()).nullable().optional().describe('Additional action-specific metadata'),
}).openapi('StageAction');

export type ParameterType = z.infer<typeof parameterTypeSchema>;
export type StageActionParameter = z.infer<typeof stageActionParameterSchema>;
export type ToolParameter = z.infer<typeof toolParameterSchema>;
export type StageAction = z.infer<typeof stageActionSchema>;

/**
 * Reserved lifecycle action names that trigger at specific points in the stage lifecycle
 * These actions use a double-underscore prefix to avoid conflicts with user-defined actions
 */
export const LIFECYCLE_ACTION_NAMES = {
  /** Executed when entering a stage (before enterBehavior logic) */
  ON_ENTER: '__on_enter',
  /** Executed when leaving a stage (before loading new stage) */
  ON_LEAVE: '__on_leave',
  /** Executed when no user action matches after classification */
  ON_FALLBACK: '__on_fallback',
} as const;

/**
 * Type for lifecycle action context - indicates which lifecycle hook is being executed
 */
export type LifecycleContext = 'on_enter' | 'on_leave' | 'on_fallback' | null;

/**
 * Mapping of lifecycle contexts to effects that should be ignored
 * Effects not in this map are allowed for that lifecycle context
 */
export const LIFECYCLE_EFFECT_RESTRICTIONS: Record<string, Set<Effect['type']>> = {
  /**
   * __on_enter: Cannot end/abort conversation during entry or change stage
   * These would interfere with the stage initialization flow
   */
  on_enter: new Set<Effect['type']>(['end_conversation', 'abort_conversation', 'go_to_stage']),
  
  /**
   * __on_leave: Cannot change stage or generate response during exit
   * go_to_stage would create infinite loops, generate_response is handled by destination stage
   */
  on_leave: new Set<Effect['type']>(['go_to_stage', 'generate_response']),
  
  /**
   * __on_fallback: No restrictions - fallback can do anything
   * This is the last chance to handle unmatched input
   */
  on_fallback: new Set<Effect['type']>(),
};