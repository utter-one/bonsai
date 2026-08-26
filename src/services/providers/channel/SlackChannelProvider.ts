import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

/**
 * Configuration schema for the Slack channel provider.
 *
 * Stores the bot token (used for sending replies via the Web API and resolving the
 * bot user id via `auth.test`) and the app signing secret (used to verify the
 * `X-Slack-Signature` header on inbound Events API webhook payloads).
 *
 * Two inbound transports are supported, selected by `mode`:
 * - `events_api` (default): Slack POSTs signed Events API payloads to the
 *   `/api/slack/webhook` endpoint. Production.
 * - `socket_mode`: the server opens an outbound WebSocket to Slack using an
 *   app-level token (`appToken`). No public URL required, intended for local
 *   development. The `projectId` binds the provider to a single Bonsai project.
 */
export const slackChannelProviderConfigSchema = z.strictObject({
  mode: z.enum(['events_api', 'socket_mode']).default('events_api').describe('Inbound transport. "events_api" receives signed HTTP webhook events (production); "socket_mode" opens an outbound WebSocket to Slack via an app-level token (local development, no public URL needed)'),
  botToken: z.string().describe('Slack Bot Token (xoxb-) used to send replies via the Web API and to resolve the bot user id'),
  signingSecret: z.string().describe('Slack App Signing Secret (SEC...) used to verify X-Slack-Signature on inbound webhook requests. Unused in socket_mode.'),
  appToken: z.string().optional().describe('Slack App-Level Token (xapp-) with the connections:write scope. Required when mode is "socket_mode".'),
  projectId: z.string().min(1).optional().describe('Bonsai project ID this provider serves. Required when mode is "socket_mode"; ignored for "events_api" (the project is chosen per-request via the webhook apiKey).'),
  processingDelayMinMs: z.number().int().min(0).default(0).describe('Minimum delay in milliseconds before processing an incoming message. 0 means immediate processing.'),
  processingDelayMaxMs: z.number().int().min(0).default(0).describe('Maximum delay in milliseconds before processing an incoming message. Must be >= processingDelayMinMs.'),
}).openapi('SlackChannelConfig');

export type SlackChannelProviderConfig = z.infer<typeof slackChannelProviderConfigSchema>;
