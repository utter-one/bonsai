import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

/**
 * Configuration schema for the WhatsApp channel provider (Meta WhatsApp Cloud API).
 *
 * Stores the credentials required for both inbound webhook validation and outbound
 * message delivery via the Meta Graph API.
 */
export const whatsAppChannelProviderConfigSchema = z.strictObject({
  phoneNumberId: z.string().describe('Meta phone number ID used in the Graph API URL for outbound messages (e.g. 123456789012345)'),
  accessToken: z.string().describe('Permanent Meta access token used as Bearer auth for outbound Graph API calls'),
  appSecret: z.string().describe('Meta app secret used to validate incoming webhook signatures via HMAC-SHA256'),
  verifyToken: z.string().describe('Static verification token echoed back during the one-time Meta webhook challenge/verification GET request'),
}).openapi('WhatsAppChannelConfig');

export type WhatsAppChannelProviderConfig = z.infer<typeof whatsAppChannelProviderConfigSchema>;
