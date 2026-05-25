import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

/**
 * Configuration schema for the Telegram channel provider (Telegram Bot API).
 *
 * Stores the bot token required for both receiving webhooks and sending
 * outbound messages via the Telegram Bot API.
 */
export const telegramChannelProviderConfigSchema = z.strictObject({
  botToken: z.string().describe('Telegram Bot Token obtained from @BotFather'),
}).openapi('TelegramChannelConfig');

export type TelegramChannelProviderConfig = z.infer<typeof telegramChannelProviderConfigSchema>;
