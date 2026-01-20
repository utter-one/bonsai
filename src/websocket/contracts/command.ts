import { z } from 'zod';
import { sessionInputMessageSchema, sessionOutputMessageSchema } from './common';

/** Request to navigate to a specific stage in a conversation. */
export const goToStageRequestSchema = sessionInputMessageSchema.extend({
  type: z.literal('go_to_stage').describe('Message type for navigating to a stage'),
  conversationId: z.string().describe('Unique identifier of the conversation'),
  stageId: z.string().describe('Unique identifier of the target stage'),
});

export type GoToStageRequest = z.infer<typeof goToStageRequestSchema>;

/** Response to go to stage request. */
export const goToStageResponseSchema = sessionOutputMessageSchema.extend({
  type: z.literal('go_to_stage').describe('Message type for go to stage response'),
  success: z.boolean().describe('Whether navigation to the stage was successful'),
  error: z.string().optional().describe('Error message if navigation failed'),
});

export type GoToStageResponse = z.infer<typeof goToStageResponseSchema>;

/** Request to set a variable value in a specific stage. */
export const setVarRequestSchema = sessionInputMessageSchema.extend({
  type: z.literal('set_var').describe('Message type for setting a variable'),
  conversationId: z.string().describe('Unique identifier of the conversation'),
  stageId: z.string().describe('Unique identifier of the stage'),
  variableName: z.string().describe('Name of the variable to set'),
  variableValue: z.any().describe('Value to set for the variable (can be any JSON-serializable type)'),
});

export type SetVarRequest = z.infer<typeof setVarRequestSchema>;

/** Response to set variable request. */
export const setVarResponseSchema = sessionOutputMessageSchema.extend({
  type: z.literal('set_var').describe('Message type for set variable response'),
  success: z.boolean().describe('Whether the variable was successfully set'),
  error: z.string().optional().describe('Error message if setting the variable failed'),
});

export type SetVarResponse = z.infer<typeof setVarResponseSchema>;

/** Request to get a variable value from a specific stage. */
export const getVarRequestSchema = sessionInputMessageSchema.extend({
  type: z.literal('get_var').describe('Message type for getting a variable'),
  conversationId: z.string().describe('Unique identifier of the conversation'),
  stageId: z.string().describe('Unique identifier of the stage'),
  variableName: z.string().describe('Name of the variable to retrieve'),
});

export type GetVarRequest = z.infer<typeof getVarRequestSchema>;

/** Response to get variable request. */
export const getVarResponseSchema = sessionOutputMessageSchema.extend({
  type: z.literal('get_var').describe('Message type for get variable response'),
  success: z.boolean().describe('Whether the variable was successfully retrieved'),
  variableName: z.string().describe('Name of the retrieved variable'),
  variableValue: z.any().optional().describe('Value of the variable (undefined if not found)'),
  error: z.string().optional().describe('Error message if retrieving the variable failed'),
});

export type GetVarResponse = z.infer<typeof getVarResponseSchema>;

/** Request to get all variables from a specific stage. */
export const getAllVarsRequestSchema = sessionInputMessageSchema.extend({
  type: z.literal('get_all_vars').describe('Message type for getting all variables'),
  conversationId: z.string().describe('Unique identifier of the conversation'),
  stageId: z.string().describe('Unique identifier of the stage'),
});

export type GetAllVarsRequest = z.infer<typeof getAllVarsRequestSchema>;

/** Response to get all variables request. */
export const getAllVarsResponseSchema = sessionOutputMessageSchema.extend({
  type: z.literal('get_all_vars').describe('Message type for get all variables response'),
  success: z.boolean().describe('Whether the variables were successfully retrieved'),
  variables: z.record(z.string(), z.any()).describe('Map of variable names to their values'),
  error: z.string().optional().describe('Error message if retrieving variables failed'),
});

export type GetAllVarsResponse = z.infer<typeof getAllVarsResponseSchema>;

/** Request to run a global action with parameters. */
export const runActionRequestSchema = sessionInputMessageSchema.extend({
  type: z.literal('run_action').describe('Message type for running an action'),
  conversationId: z.string().describe('Unique identifier of the conversation'),
  actionName: z.string().describe('Name of the global action to execute'),
  parameters: z.array(z.any()).describe('Array of parameters to pass to the action'),
});

export type RunActionRequest = z.infer<typeof runActionRequestSchema>;

/** Response to run action request. */
export const runActionResponseSchema = sessionOutputMessageSchema.extend({
  type: z.literal('run_action').describe('Message type for run action response'),
  success: z.boolean().describe('Whether the action was successfully executed'),
  result: z.any().optional().describe('Result returned by the action'),
  error: z.string().optional().describe('Error message if action execution failed'),
});

export type RunActionResponse = z.infer<typeof runActionResponseSchema>;
