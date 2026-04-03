import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

/**
 * Zod schema for Twilio Voice channel provider credentials.
 *
 * Used to store the Twilio account credentials needed to handle inbound voice calls
 * via Twilio Media Streams (8 kHz µLaw bidirectional audio over WebSocket).
 */
export const twilioVoiceChannelProviderConfigSchema = z.strictObject({
  accountSid: z.string().describe('Twilio Account SID (starts with AC)'),
  authToken: z.string().describe('Twilio Auth Token used for webhook signature validation'),
  phoneNumber: z.string().describe('Twilio phone number in E.164 format (e.g. +15551234567)'),
}).openapi('TwilioVoiceChannelConfig');

export type TwilioVoiceChannelProviderConfig = z.infer<typeof twilioVoiceChannelProviderConfigSchema>;
