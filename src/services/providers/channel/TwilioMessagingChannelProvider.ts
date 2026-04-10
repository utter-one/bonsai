import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

/**
 * Configuration schema for the Twilio Messaging channel provider.
 *
 * Stores the Twilio Account SID, Auth Token, and the sending phone number.
 * These credentials are used both for validating incoming webhook signatures
 * and for sending outbound SMS/WhatsApp messages via the Twilio REST API.
 */
export const twilioMessagingChannelProviderConfigSchema = z.strictObject({
  accountSid: z.string().describe('Twilio Account SID (starts with AC)'),
  authToken: z.string().describe('Twilio Auth Token used for request signature validation and REST API authentication'),
  fromNumber: z.string().describe('Twilio phone number or WhatsApp sender in E.164 format (e.g. +15551234567) used as the "From" address for outbound messages'),
}).openapi('TwilioMessagingChannelConfig');

export type TwilioMessagingChannelProviderConfig = z.infer<typeof twilioMessagingChannelProviderConfigSchema>;
