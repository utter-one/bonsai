import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export const sesSendRouteParamsSchema = z.object({
  channelProviderId: z.string().min(1).describe('ID of the SES channel provider to use for sending the email'),
});

export const sesSendBodySchema = z.object({
  to: z.string().email().describe('Recipient email address'),
  cc: z.string().email().optional().describe('CC address for this email. Overrides any CC set in the routing entry.'),
  bcc: z.string().email().optional().describe('BCC address for this email. Overrides any BCC set in the routing entry.'),
  subject: z.string().optional().describe('Email subject line. If omitted, defaults to the agent name.'),
  fromAddress: z.string().email().optional().describe('Override sender email address (defaults to provider config)'),
  stageId: z.string().optional().describe('Stage ID to start the conversation at. When omitted, falls back to the project-level default starting stage.'),
  agentId: z.string().optional().describe('Optional agent ID override for this conversation'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Optional metadata to attach to the conversation record'),
  userProfile: z.record(z.string(), z.unknown()).optional().describe('Optional user profile data to inject and deep-merge into the user profile on the users table.'),
});

export const sesSendResponseSchema = z.object({
  conversationId: z.string().describe('ID of the pre-created conversation record'),
});

export type SesSendRouteParams = z.infer<typeof sesSendRouteParamsSchema>;
export type SesSendBody = z.infer<typeof sesSendBodySchema>;
export type SesSendResponse = z.infer<typeof sesSendResponseSchema>;
