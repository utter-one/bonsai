import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

/**
 * Configuration schema for the Slack channel provider.
 *
 * Two inbound transports are supported, selected by `mode`:
 * - `events_api` (default): Slack POSTs signed Events API payloads to the
 *   `/api/slack/webhook` endpoint (production). Requires `botToken` +
 *   `signingSecret`; `appToken`/`projectId` are unused (optional).
 * - `socket_mode`: the server opens an outbound WebSocket to Slack using an
 *   app-level token (local development, no public URL). Requires `botToken` +
 *   `appToken` + `projectId`; `signingSecret` is unused (optional).
 *
 * `botToken` is required in both modes — it authenticates the bot's Web API
 * calls (`chat.postMessage` for replies, `auth.test` to resolve the bot user id
 * for @-mention detection/stripping in channels). Only the transport-specific
 * fields differ. They're enforced by a single `superRefine` (same pattern as
 * the notifier config), so each credential is optional in the object shape but
 * required for the matching mode.
 */
export const slackChannelProviderConfigSchema = z.strictObject({
  mode: z.enum(['events_api', 'socket_mode']).default('events_api').describe('Inbound transport. "events_api" receives signed HTTP webhook events (production); "socket_mode" opens an outbound WebSocket to Slack via an app-level token (local development, no public URL needed)'),
  botToken: z.string().optional().describe('Slack Bot Token (xoxb-). Required in both modes: authenticates replies (chat.postMessage) and resolving the bot user id (auth.test) for @-mention detection/stripping in channels'),
  signingSecret: z.string().optional().describe('Slack App Signing Secret (SEC...). Required for "events_api" (verifies X-Slack-Signature on inbound webhook requests); unused in "socket_mode"'),
  appToken: z.string().optional().describe('Slack App-Level Token (xapp-) with the connections:write scope. Required for "socket_mode"; unused by "events_api"'),
  projectId: z.string().min(1).optional().describe('Bonsai project ID this provider serves. Required for "socket_mode"; ignored for "events_api" (the project is chosen per-request via the webhook apiKey)'),
  processingDelayMinMs: z.number().int().min(0).default(0).describe('Minimum delay in milliseconds before processing an incoming message. 0 means immediate processing.'),
  processingDelayMaxMs: z.number().int().min(0).default(0).describe('Maximum delay in milliseconds before processing an incoming message. Must be >= processingDelayMinMs.'),
}).superRefine((config, ctx) => {
  const issue = (field: string, message: string): void => {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message });
  };
  // botToken is required in both modes: it authenticates the bot's Web API calls
  // (chat.postMessage for replies, auth.test to resolve the bot user id for
  // detecting/stripping @-mentions in channel messages).
  if (!config.botToken) issue('botToken', 'botToken is required');
  if (config.mode === 'events_api') {
    if (!config.signingSecret) issue('signingSecret', 'signingSecret is required when mode is "events_api"');
  } else {
    if (!config.appToken) issue('appToken', 'appToken is required when mode is "socket_mode"');
    if (!config.projectId) issue('projectId', 'projectId is required when mode is "socket_mode"');
  }
}).openapi('SlackChannelConfig');

export type SlackChannelProviderConfig = z.infer<typeof slackChannelProviderConfigSchema>;
