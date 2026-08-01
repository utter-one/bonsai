import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { emailRoutingEntrySchema } from '../../../channels/email/shared/EmailRoutingTypes';

extendZodWithOpenApi(z);

export const sesChannelProviderConfigSchema = z.strictObject({
  accessKeyId: z.string().describe('AWS Access Key ID'),
  secretAccessKey: z.string().describe('AWS Secret Access Key'),
  region: z.string().describe('AWS region (e.g., us-east-1)'),
  fromAddress: z.string().email().describe('Sender email address'),
  threadingStrategy: z.enum(['messageId', 'senderSubject']).default('messageId').describe('How to derive thread ID for conversation continuity'),
  inboundMode: z.enum(['sns', 's3']).default('sns').describe('How inbound email body is delivered: "sns" includes raw MIME in the SNS notification (150 KB limit), "s3" fetches raw MIME from the S3 bucket specified by s3BucketName (40 MB limit). Must match the SES receipt rule action.'),
  s3BucketName: z.string().optional().describe('S3 bucket name for "s3" inbound mode. Must match the S3 bucket configured in the SES receipt rule. The object key is provided by the notification.'),
  emailToProject: z.record(z.string().email(), z.union([z.string(), emailRoutingEntrySchema])).optional().describe('Maps email addresses to routing entries for multi-project routing. Each entry can specify projectId, cc, bcc, fromAddress, subject, stageId, and agentId. Plain string values (projectId only) are supported for backward compatibility.'),
  ccBccReplyAsHandOff: z.boolean().default(true).describe('When enabled, a reply from a CC/BCC recipient (not the conversation user) is treated as a human hand-off: the conversation is closed and no AI response is sent.'),
  processingDelayMinMs: z.number().int().min(0).default(0).describe('Minimum delay in milliseconds before processing an incoming message. 0 means immediate processing.'),
  processingDelayMaxMs: z.number().int().min(0).default(0).describe('Maximum delay in milliseconds before processing an incoming message. Must be >= processingDelayMinMs.'),
}).openapi('SesChannelConfig');

export type SesChannelProviderConfig = z.infer<typeof sesChannelProviderConfigSchema>;
