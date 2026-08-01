import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { emailRoutingEntrySchema } from '../../../channels/email/shared/EmailRoutingTypes';

extendZodWithOpenApi(z);

export const sendGridChannelProviderConfigSchema = z.strictObject({
  apiKey: z.string().describe('SendGrid API key'),
  fromAddress: z.string().email().describe('Sender email address'),
  threadingStrategy: z.enum(['messageId', 'senderSubject']).default('messageId').describe('How to derive thread ID for conversation continuity'),
  emailToProject: z.record(z.string().email(), z.union([z.string(), emailRoutingEntrySchema])).optional().describe('Maps email addresses to routing entries for multi-project routing. Each entry can specify projectId, cc, bcc, fromAddress, subject, stageId, and agentId. Plain string values (projectId only) are supported for backward compatibility.'),
  ccBccReplyAsHandOff: z.boolean().default(true).describe('When enabled, a reply from a CC/BCC recipient (not the conversation user) is treated as a human hand-off: the conversation is closed and no AI response is sent.'),
  processingDelayMinMs: z.number().int().min(0).default(0).describe('Minimum delay in milliseconds before processing an incoming message. 0 means immediate processing.'),
  processingDelayMaxMs: z.number().int().min(0).default(0).describe('Maximum delay in milliseconds before processing an incoming message. Must be >= processingDelayMinMs.'),
}).openapi('SendGridChannelConfig');

export type SendGridChannelProviderConfig = z.infer<typeof sendGridChannelProviderConfigSchema>;
