import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

/**
 * Route params for the outgoing WhatsApp send endpoint.
 */
export const whatsAppSendRouteParamsSchema = z.object({
  channelProviderId: z.string().min(1).describe('ID of the WhatsApp channel provider to use for sending the message'),
});

/**
 * Request body for initiating an outgoing WhatsApp conversation.
 * WhatsApp requires an approved message template for business-initiated conversations.
 */
export const whatsAppSendBodySchema = z.object({
  to: z.string().min(1).describe('Destination WhatsApp phone number in E.164 format (e.g. +15551234567)'),
  templateName: z.string().min(1).describe('Name of the approved WhatsApp message template to use'),
  templateParams: z.array(z.string()).optional().describe('Positional parameter values to substitute into the template body ({{1}}, {{2}}, …)'),
  stageId: z.string().optional().describe('Stage ID to start the conversation at. When omitted, falls back to the project-level default starting stage.'),
  agentId: z.string().optional().describe('Optional agent ID override for this conversation'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Optional metadata to attach to the conversation record'),
  userProfile: z.record(z.string(), z.unknown()).optional().describe('Optional user profile data to inject and deep-merge into the user\'s existing profile on the users table.'),
});

/**
 * Response for a successfully initiated outgoing WhatsApp conversation.
 */
export const whatsAppSendResponseSchema = z.object({
  messageId: z.string().describe('Meta message ID of the sent template message'),
  conversationId: z.string().describe('ID of the pre-created conversation record'),
});

export type WhatsAppSendRouteParams = z.infer<typeof whatsAppSendRouteParamsSchema>;
export type WhatsAppSendBody = z.infer<typeof whatsAppSendBodySchema>;
export type WhatsAppSendResponse = z.infer<typeof whatsAppSendResponseSchema>;
