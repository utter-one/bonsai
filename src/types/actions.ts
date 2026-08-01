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
  priority: z.number().optional().describe('Optional execution priority override. Lower numbers execute first. Default: 11000.'),
}).openapi('EndConversationEffect');

/**
 * Effect type: Abort Conversation
 * Immediately ends conversation without AI response
 */
export const abortConversationEffectSchema = z.object({
  type: z.literal('abort_conversation').describe('Effect type'),
  reason: z.string().optional().describe('Optional reason for aborting the conversation'),
  priority: z.number().optional().describe('Optional execution priority override. Lower numbers execute first. Default: 12000.'),
}).openapi('AbortConversationEffect');

/**
 * Effect type: Go To Stage
 * Switches the conversation to a different stage
 */
export const goToStageEffectSchema = z.object({
  type: z.literal('go_to_stage').describe('Effect type'),
  stageId: z.string().min(1).describe('ID of the stage to switch to'),
  priority: z.number().optional().describe('Optional execution priority override. Lower numbers execute first. Default: 13000.'),
}).openapi('GoToStageEffect');

/**
 * Effect type: Modify User Input
 * Changes the contents of user input using a template (can replace, redact, or inject whisper)
 */
export const modifyUserInputEffectSchema = z.object({
  type: z.literal('modify_user_input').describe('Effect type'),
  template: z.string().min(1).describe('Template to render and replace user input with'),
  priority: z.number().optional().describe('Optional execution priority override. Lower numbers execute first. Default: 5000.'),
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
  priority: z.number().optional().describe('Optional execution priority override. Lower numbers execute first. Default: 3000.'),
}).openapi('ModifyVariablesEffect');

/**
 * Effect type: Modify User Profile
 * Updates user profile fields using specific operations
 */
export const modifyUserProfileEffectSchema = z.object({
  type: z.literal('modify_user_profile').describe('Effect type'),
  modifications: z.array(userProfileOperationSchema).min(1).describe('Array of user profile field modifications to apply'),
  priority: z.number().optional().describe('Optional execution priority override. Lower numbers execute first. Default: 4000.'),
}).openapi('ModifyUserProfileEffect');

/**
 * Effect type: Call Tool
 * Calls a selected tool with parameters and puts the result in context
 */
export const callToolEffectSchema = z.object({
  type: z.literal('call_tool').describe('Effect type'),
  toolId: z.string().min(1).describe('ID of the tool to call'),
  parameters: z.record(z.string(), z.unknown()).describe('Parameters to pass to the tool'),
  asynchronous: z.boolean().optional().default(false).describe('When true, the tool runs in the background without blocking the conversation. The result is not stored in context and flow control signals (go_to_stage, end_conversation, etc.) are discarded. Use for fire-and-forget operations such as logging or saving data.'),
  priority: z.number().optional().describe('Optional execution priority override. Lower numbers execute first. Default: 1000 (webhook), 2000 (smart_function), 6000 (script).'),
}).openapi('CallToolEffect');

/**
 * Effect type: Generate Response
 * Triggers AI response generation (must be explicitly added to actions)
 */
export const generateResponseEffectSchema = z.object({
  type: z.literal('generate_response').describe('Effect type'),
  responseMode: z.enum(['generated', 'prescripted']).optional().default('generated').describe('Type of response to generate: generated (AI-generated), prescripted (predefined response), best_match (choose the best match from predefined responses)'),
  prescriptedSelectionStrategy: z.enum(['random', 'round_robin']).optional().default('random').describe('Strategy to select prescripted response when multiple are provided'),
  prescriptedResponses: z.array(z.string()).optional().describe('Optional array of prescripted responses to use'),
  priority: z.number().optional().describe('Optional execution priority override. Lower numbers execute first. Default: 10000.'),
}).openapi('GenerateResponseEffect');

/**
 * Effect type: Change Visibility
 * Changes visibility of messages in current turn
 */
export const changeVisibilityEffectSchema = z.object({
  type: z.literal('change_visibility').describe('Effect type'),
  visibility: z.enum(['always', 'stage', 'never', 'conditional']).describe('Visibility setting: always (always visible), stage (visible only in current stage), never (never visible), conditional (visible based on a JavaScript condition expression)'),
  condition: z.string().optional().describe('JavaScript condition expression evaluated against the conversation context — required when visibility is "conditional"'),
  priority: z.number().optional().describe('Optional execution priority override. Lower numbers execute first. Default: 9000.'),
}).openapi('ChangeVisibilityEffect');

/**
 * Effect type: Ban User
 * Permanently bans the user associated with the current conversation
 */
export const banUserEffectSchema = z.object({
  type: z.literal('ban_user').describe('Effect type'),
  reason: z.string().optional().describe('Optional reason for banning the user'),
  priority: z.number().optional().describe('Optional execution priority override. Lower numbers execute first. Default: 7000.'),
}).openapi('BanUserEffect');

/**
 * Effect type: Save Artifact
 * Saves data from the conversation context to project storage and stores the artifactId in a variable.
 * Accepts either inline data (base64-encoded string or any JSON-serializable value) or a variable reference.
 * The artifactId is stored in the specified variable for downstream effects (e.g. attach_file).
 */
export const saveArtifactEffectSchema = z.object({
  type: z.literal('save_artifact').describe('Effect type'),
  data: z.unknown().describe('Data to save: inline value (string, base64, object) or a variable reference template such as {{vars.myFile}}'),
  dataEncoding: z.enum(['raw', 'base64']).optional().default('raw').describe('Encoding of the data: raw (store as-is), base64 (decode before storing)'),
  fileName: z.string().min(1).describe('Display name for the stored file; supports Handlebars templating'),
  mimeType: z.string().min(1).optional().describe('MIME type for the stored file'),
  variableName: z.string().min(1).describe('Variable name to store the artifactId in (e.g. "myArtifactId")'),
  priority: z.number().optional().describe('Optional execution priority override. Lower numbers execute first. Default: 8000.'),
}).openapi('SaveArtifactEffect');

/**
 * Effect type: Attach File
 * Stages a file for delivery alongside the AI response. Must be paired with generate_response
 * in the same action — standalone attach_file is silently skipped.
 */
export const attachFileEffectSchema = z.object({
  type: z.literal('attach_file').describe('Effect type'),
  artifactId: z.string().min(1).describe('Artifact ID of the file in storage to attach. Typically from a save_artifact effect or a tool result.'),
  fileName: z.string().min(1).optional().describe('Display name for the attachment. Defaults to the artifact\'s stored name when omitted.'),
  mimeType: z.string().min(1).optional().describe('MIME type override. When omitted, uses the artifact\'s stored MIME type.'),
  priority: z.number().optional().describe('Optional execution priority override. Lower numbers execute first. Default: 9500.'),
}).openapi('AttachFileEffect');

/**
 * Discriminated union of all effect types
 * Defines the possible effects that can be executed in stage actions or global actions
 */
export const effectSchema = z.discriminatedUnion('type', [
  endConversationEffectSchema,
  abortConversationEffectSchema,
  goToStageEffectSchema,
  modifyUserInputEffectSchema,
  modifyVariablesEffectSchema,
  modifyUserProfileEffectSchema,
  callToolEffectSchema,
  saveArtifactEffectSchema,
  generateResponseEffectSchema,
  changeVisibilityEffectSchema,
  banUserEffectSchema,
  attachFileEffectSchema,
]).openapi('Effect');

// Infer types from schemas
export type EndConversationEffect = z.infer<typeof endConversationEffectSchema>;
export type AbortConversationEffect = z.infer<typeof abortConversationEffectSchema>;
export type GoToStageEffect = z.infer<typeof goToStageEffectSchema>;
export type ModifyUserInputEffect = z.infer<typeof modifyUserInputEffectSchema>;
export type VariableOperation = z.infer<typeof variableOperationSchema>;
export type UserProfileOperation = z.infer<typeof userProfileOperationSchema>;
export type ModifyVariablesEffect = z.infer<typeof modifyVariablesEffectSchema>;
export type ModifyUserProfileEffect = z.infer<typeof modifyUserProfileEffectSchema>;
export type CallToolEffect = z.infer<typeof callToolEffectSchema>;
export type SaveArtifactEffect = z.infer<typeof saveArtifactEffectSchema>;
export type GenerateResponseEffect = z.infer<typeof generateResponseEffectSchema>;
export type ChangeVisibilityEffect = z.infer<typeof changeVisibilityEffectSchema>;
export type BanUserEffect = z.infer<typeof banUserEffectSchema>;
export type AttachFileEffect = z.infer<typeof attachFileEffectSchema>;
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
 * Effect types that existed in older versions of the API but are no longer supported.
 * These are silently ignored when loading actions instead of causing validation errors.
 */
export const DEPRECATED_EFFECT_TYPES = new Set(['call_webhook', 'run_script']);

/**
 * Preprocessor that strips deprecated effect types from an effects array.
 * Use with `z.preprocess` to silently ignore unknown legacy effect types.
 */
export const filterDeprecatedEffects = (val: unknown): unknown =>
  Array.isArray(val) ? val.filter((e: unknown) => !(e && typeof e === 'object' && 'type' in e && DEPRECATED_EFFECT_TYPES.has((e as { type: unknown }).type as string))) : val;

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
  effects: z.preprocess(filterDeprecatedEffects, z.array(effectSchema).describe('Array of effects to execute when action is triggered')),
  examples: z.array(z.string()).nullable().optional().describe('Example phrases that trigger this action'),
  triggerOnTransformation: z.boolean().optional().default(false).describe('Whether this action should be triggered on variable transformations'),
  triggerOnExternal: z.boolean().optional().default(false).describe('Whether this action can be triggered by external services via the external trigger endpoint'),
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
 * Reserved global action IDs for conversation-level lifecycle hooks.
 * A global action with one of these IDs fires at the corresponding conversation lifecycle event.
 * These IDs are validated and excluded from stage-level global action processing.
 */
export const CONVERSATION_LIFECYCLE_ACTION_IDS = {
  /** Executed once after the conversation and first stage are initialised */
  ON_START: '__conversation_start',
  /** Executed when a previously-interrupted conversation is resumed */
  ON_RESUME: '__conversation_resume',
  /** Executed when the conversation is gracefully ended */
  ON_END: '__conversation_end',
  /** Executed when the conversation is aborted (immediate stop) */
  ON_ABORT: '__conversation_abort',
  /** Executed when the conversation encounters a fatal error */
  ON_FAILED: '__conversation_failed',
} as const;

/**
 * Schema for lifecycle action context - indicates which lifecycle hook is being executed.
 * Null when triggered by regular user-input classification.
 */
export const lifecycleContextSchema = z.enum([
  'on_enter',
  'on_leave',
  'on_fallback',
  'conversation_start',
  'conversation_resume',
  'conversation_end',
  'conversation_abort',
  'conversation_failed',
]).nullable();

/** Type for lifecycle action context - indicates which lifecycle hook is being executed */
export type LifecycleContext = z.infer<typeof lifecycleContextSchema>;

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
  on_leave: new Set<Effect['type']>(['go_to_stage', 'generate_response', 'attach_file']),

  /**
   * __on_fallback: No restrictions - fallback can do anything
   * This is the last chance to handle unmatched input
   */
  on_fallback: new Set<Effect['type']>(),

  /**
   * __conversation_start: Cannot immediately end or abort the freshly started conversation
   * Use go_to_stage to redirect, call_tool to initialise context
   */
  conversation_start: new Set<Effect['type']>(['end_conversation', 'abort_conversation']),

  /**
   * __conversation_resume: Same restrictions as conversation_start
   */
  conversation_resume: new Set<Effect['type']>(['end_conversation', 'abort_conversation']),

  /**
   * __conversation_end: Conversation is already ending — no stage navigation, response generation, or abort
   */
  conversation_end: new Set<Effect['type']>(['go_to_stage', 'generate_response', 'abort_conversation', 'attach_file']),

  /**
   * __conversation_abort: Conversation is already aborting — no stage navigation, response generation, or end
   */
  conversation_abort: new Set<Effect['type']>(['go_to_stage', 'generate_response', 'end_conversation', 'attach_file']),

  /**
   * __conversation_failed: Conversation is in an error state — no navigation, response, or termination effects
   */
  conversation_failed: new Set<Effect['type']>(['go_to_stage', 'generate_response', 'end_conversation', 'abort_conversation', 'attach_file']),
};
