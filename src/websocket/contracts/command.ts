import { z } from 'zod';
import { calToWsInput, calToWsOutput } from './utils';
import {
  calGoToStageRequestSchema,
  calGoToStageResponseSchema,
  calSetVarRequestSchema,
  calSetVarResponseSchema,
  calGetVarRequestSchema,
  calGetVarResponseSchema,
  calGetAllVarsRequestSchema,
  calGetAllVarsResponseSchema,
  calRunActionRequestSchema,
  calRunActionResponseSchema,
  calCallToolRequestSchema,
  calCallToolResponseSchema,
} from '../../channels/messages';

/**
 * Schema for webhook call results stored in context.
 * Contains HTTP response details including status, headers, and data.
 */
export const webhookResultSchema = z.object({
  status: z.number().describe('HTTP status code'),
  statusText: z.string().describe('HTTP status text'),
  headers: z.record(z.string(), z.string()).describe('HTTP response headers'),
  data: z.unknown().describe('Response body (parsed JSON or raw text)'),
});

export type WebhookResult = z.infer<typeof webhookResultSchema>;

/** Request to navigate to a specific stage in a conversation. */
export const goToStageRequestSchema = calToWsInput(calGoToStageRequestSchema);
export type GoToStageRequest = z.infer<typeof goToStageRequestSchema>;

/** Response to go to stage request. */
export const goToStageResponseSchema = calToWsOutput(calGoToStageResponseSchema);
export type GoToStageResponse = z.infer<typeof goToStageResponseSchema>;

/** Request to set a variable value in a specific stage. */
export const setVarRequestSchema = calToWsInput(calSetVarRequestSchema);
export type SetVarRequest = z.infer<typeof setVarRequestSchema>;

/**
 * Response to set variable request.
 * Note: the response type is `set_var_result` (not `set_var`) to distinguish it from the request.
 */
export const setVarResponseSchema = calToWsOutput(calSetVarResponseSchema);
export type SetVarResponse = z.infer<typeof setVarResponseSchema>;

/** Request to get a variable value from a specific stage. */
export const getVarRequestSchema = calToWsInput(calGetVarRequestSchema);
export type GetVarRequest = z.infer<typeof getVarRequestSchema>;

/** Response to get variable request. */
export const getVarResponseSchema = calToWsOutput(calGetVarResponseSchema);
export type GetVarResponse = z.infer<typeof getVarResponseSchema>;

/** Request to get all variables from a specific stage. */
export const getAllVarsRequestSchema = calToWsInput(calGetAllVarsRequestSchema);
export type GetAllVarsRequest = z.infer<typeof getAllVarsRequestSchema>;

/** Response to get all variables request. */
export const getAllVarsResponseSchema = calToWsOutput(calGetAllVarsResponseSchema);
export type GetAllVarsResponse = z.infer<typeof getAllVarsResponseSchema>;

/** Request to run a global action with parameters. */
export const runActionRequestSchema = calToWsInput(calRunActionRequestSchema);
export type RunActionRequest = z.infer<typeof runActionRequestSchema>;

/** Response to run action request. */
export const runActionResponseSchema = calToWsOutput(calRunActionResponseSchema);
export type RunActionResponse = z.infer<typeof runActionResponseSchema>;

/** Request to call a tool with parameters. */
export const callToolRequestSchema = calToWsInput(calCallToolRequestSchema);
export type CallToolRequest = z.infer<typeof callToolRequestSchema>;

/** Response to call tool request. */
export const callToolResponseSchema = calToWsOutput(calCallToolResponseSchema);
export type CallToolResponse = z.infer<typeof callToolResponseSchema>;
