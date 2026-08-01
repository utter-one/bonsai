import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export const emailRoutingEntrySchema = z.strictObject({
  projectId: z.string().describe('Target project ID for this email address'),
  cc: z.string().email().optional().describe('CC address for all emails sent from this identity'),
  bcc: z.string().email().optional().describe('BCC address for all emails sent from this identity'),
  fromAddress: z.string().email().optional().describe('Override sender email address for this identity'),
  subject: z.string().optional().describe('Default subject line for outbound-initiated conversations (not applied to inbound replies)'),
  stageId: z.string().optional().describe('Default starting stage for conversations from this identity'),
  agentId: z.string().optional().describe('Default agent for conversations from this identity'),
}).openapi('EmailRoutingEntry');

export type EmailRoutingEntry = z.infer<typeof emailRoutingEntrySchema>;

export interface EmailRoutingResult {
  projectId: string;
  targetEmail: string;
  cc: string | undefined;
  bcc: string | undefined;
  fromAddress: string | undefined;
  subject: string | undefined;
  stageId: string | undefined;
  agentId: string | undefined;
}

export function normalizeRoutingEntry(value: string | EmailRoutingEntry): EmailRoutingEntry {
  if (typeof value === 'string') {
    return { projectId: value };
  }
  return value;
}
