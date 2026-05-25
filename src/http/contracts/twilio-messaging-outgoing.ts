import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

/**
 * Route params for the outgoing Twilio Messaging send endpoint.
 */
export const twilioMessagingSendRouteParamsSchema = z.object({
  channelProviderId: z.string().min(1).describe('ID of the Twilio Messaging channel provider to use for sending the message'),
});

/**
 * Request body for initiating an outgoing Twilio Messaging conversation.
 * The opening message text is generated automatically by the project's AI.
 */
export const twilioMessagingSendBodySchema = z.object({
  to: z.string().min(1).describe('Destination phone number in E.164 format (e.g. +15551234567)'),
  stageId: z.string().optional().describe('Stage ID to start the conversation at. When omitted, falls back to the project-level default starting stage.'),
  agentId: z.string().optional().describe('Optional agent ID override for this conversation'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Optional metadata to attach to the conversation record'),
  userProfile: z.record(z.string(), z.unknown()).optional().describe('Optional user profile data to inject and deep-merge into the user\'s existing profile on the users table.'),
});

/**
 * Response for a successfully initiated outgoing Twilio Messaging conversation.
 */
export const twilioMessagingSendResponseSchema = z.object({
  conversationId: z.string().describe('ID of the conversation record created for this outgoing conversation'),
});

export type TwilioMessagingSendRouteParams = z.infer<typeof twilioMessagingSendRouteParamsSchema>;
export type TwilioMessagingSendBody = z.infer<typeof twilioMessagingSendBodySchema>;
export type TwilioMessagingSendResponse = z.infer<typeof twilioMessagingSendResponseSchema>;
