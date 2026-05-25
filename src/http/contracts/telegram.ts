import { z } from 'zod';

/** Request body for deploying a Telegram webhook */
export const deployTelegramWebhookSchema = z.object({
  channelProviderId: z.string().min(1).describe('ID of the Telegram channel provider record whose bot token will be used'),
  apiKey: z.string().min(1).describe('API key to embed in the webhook URL. The webhook callback will include this key as a query parameter.'),
  origin: z.string().url().optional().describe('Custom origin (protocol + host) for the webhook URL, e.g. https://api.example.com. If omitted, inferred from the incoming request'),
});

/** Response returned after deploying a Telegram webhook */
export const deployTelegramWebhookResponseSchema = z.object({
  success: z.boolean().describe('Whether the webhook was deployed successfully'),
  webhookUrl: z.string().url().describe('The full webhook URL that was registered with Telegram'),
  telegramResponse: z.any().optional().describe('Raw response body from the Telegram Bot API (present on success)'),
  error: z.string().optional().describe('Error message from the Telegram Bot API (present when success is false)'),
}).openapi('DeployTelegramWebhookResponse');

export type DeployTelegramWebhookRequest = z.infer<typeof deployTelegramWebhookSchema>;
export type DeployTelegramWebhookResponse = z.infer<typeof deployTelegramWebhookResponseSchema>;
