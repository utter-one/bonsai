import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export const sesChannelProviderConfigSchema = z.strictObject({
  accessKeyId: z.string().describe('AWS Access Key ID'),
  secretAccessKey: z.string().describe('AWS Secret Access Key'),
  region: z.string().describe('AWS region (e.g., us-east-1)'),
  fromAddress: z.string().email().describe('Sender email address'),
  threadingStrategy: z.enum(['messageId', 'senderSubject']).default('messageId').describe('How to derive thread ID for conversation continuity'),
  inboundMode: z.enum(['sns', 's3']).default('sns').describe('How inbound email body is delivered: "sns" includes raw MIME in the SNS notification (150 KB limit), "s3" fetches raw MIME from the S3 bucket specified by s3BucketName (40 MB limit). Must match the SES receipt rule action.'),
  s3BucketName: z.string().optional().describe('S3 bucket name for "s3" inbound mode. Must match the S3 bucket configured in the SES receipt rule. The object key is provided by the notification.'),
}).openapi('SesChannelConfig');

export type SesChannelProviderConfig = z.infer<typeof sesChannelProviderConfigSchema>;
