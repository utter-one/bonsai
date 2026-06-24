import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export const sendGridChannelProviderConfigSchema = z.strictObject({
  apiKey: z.string().describe('SendGrid API key'),
  fromAddress: z.string().email().describe('Sender email address'),
  threadingStrategy: z.enum(['messageId', 'senderSubject']).default('messageId').describe('How to derive thread ID for conversation continuity'),
}).openapi('SendGridChannelConfig');

export type SendGridChannelProviderConfig = z.infer<typeof sendGridChannelProviderConfigSchema>;
