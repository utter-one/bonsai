import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

/**
 * Route params for the outgoing Twilio Voice call endpoint.
 */
export const twilioVoiceCallRouteParamsSchema = z.object({
  channelProviderId: z.string().min(1).describe('ID of the Twilio Voice channel provider to use for placing the call'),
});

/**
 * Request body for initiating an outgoing Twilio Voice call.
 */
export const twilioVoiceCallBodySchema = z.object({
  to: z.string().min(1).describe('Destination phone number in E.164 format (e.g. +15551234567)'),
  stageId: z.string().optional().describe('Stage ID to start the conversation at. When omitted, falls back to the project-level default starting stage.'),
  agentId: z.string().optional().describe('Optional agent ID override for this conversation'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Optional metadata to attach to the conversation record'),
  userProfile: z.record(z.string(), z.unknown()).optional().describe('Optional user profile data to inject and deep-merge into the user\'s existing profile on the users table.'),
});

/**
 * Response for a successfully initiated outgoing Twilio Voice call.
 * The conversation record is created immediately; the call connection is established asynchronously when the callee answers.
 */
export const twilioVoiceCallResponseSchema = z.object({
  callSid: z.string().describe('Twilio Call SID of the initiated outbound call'),
  conversationId: z.string().describe('ID of the pre-created conversation record for this call attempt'),
});

export type TwilioVoiceCallRouteParams = z.infer<typeof twilioVoiceCallRouteParamsSchema>;
export type TwilioVoiceCallBody = z.infer<typeof twilioVoiceCallBodySchema>;
export type TwilioVoiceCallResponse = z.infer<typeof twilioVoiceCallResponseSchema>;
