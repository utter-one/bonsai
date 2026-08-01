import { z } from 'zod';

/**
 * Request body for triggering an action in an active conversation.
 */
export const externalTriggerRequestSchema = z.object({
  conversationId: z.string().describe('The conversation ID to trigger the action in'),
  sessionId: z.string().optional().describe('Optional session ID. Required when multiple sessions exist for the conversation. If omitted and only one session exists, it is used automatically.'),
  actionName: z.string().describe('The action ID or name to trigger. The action must have triggerOnExternal enabled.'),
  parameters: z.record(z.string(), z.unknown()).optional().default({}).describe('Parameters to pass to the action'),
});

/**
 * Successful response from the external trigger endpoint.
 */
export const externalTriggerResponseSchema = z.object({
  success: z.boolean().describe('Whether the action was triggered successfully'),
  conversationId: z.string().describe('The conversation ID'),
  sessionId: z.string().describe('The session ID where the action was triggered'),
  actionName: z.string().describe('The action that was triggered'),
  outcome: z.object({
    hasModifiedUserInput: z.boolean().describe('Whether the action modified user input'),
    hasModifiedVars: z.boolean().describe('Whether the action modified variables'),
    shouldGenerateResponse: z.boolean().describe('Whether the AI will generate a response after this action'),
    shouldAbortConversation: z.boolean().describe('Whether the action aborted the conversation'),
    shouldEndConversation: z.boolean().describe('Whether the action ended the conversation'),
  }).describe('Outcome metadata from the action execution'),
});

/**
 * Error response shape for the external trigger endpoint.
 */
export type ExternalTriggerError = {
  success: false;
  error: string;
  code?: string;
};
