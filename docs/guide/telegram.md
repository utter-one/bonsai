# Telegram Channel

The **Telegram** channel integrates the platform with Telegram via the Bot API. Users interact with a Telegram bot, and messages are routed through the conversation engine.

> **Capabilities:** Text input/output only. No voice or media support.

## Setup

### 1. Create a Telegram Bot

Use [@BotFather](https://t.me/BotFather) to create a new bot and obtain a `botToken`.

### 2. Create a Channel Provider

Create a provider of type `channel` with API type `telegram`. Configuration:

```json
{
  "botToken": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
  "processingDelayMinMs": 5000,
  "processingDelayMaxMs": 30000
}
```

| Field | Description |
|---|---|
| `botToken` | Telegram bot token from @BotFather |
| `processingDelayMinMs` | Minimum delay in milliseconds before processing an incoming message (default: 0, disabled) |
| `processingDelayMaxMs` | Maximum delay in milliseconds before processing an incoming message (default: 0, disabled) |

### 3. Deploy the Webhook

Call the deploy-webhook endpoint to register the server's webhook URL with Telegram:

```http
POST /api/telegram/deploy-webhook
Content-Type: application/json
Authorization: Bearer <token>
```

```json
{
  "channelProviderId": "your-provider-id",
  "apiKey": "your-api-key",
  "origin": "https://your-domain.com"
}
```

This registers `https://your-domain.com/api/telegram/webhook?apiKey=...&channelProviderId=...` as the webhook target with Telegram's Bot API.

Requires `provider:write` permission.

## How It Works

### Session Management

Virtual sessions are created per Telegram user ID, with an inactivity timeout (default: 30 minutes, configurable via `TELEGRAM_SESSION_TIMEOUT_MS`). Each session maps to a conversation.

### Message Flow

| Telegram Message | System Action |
|---|---|
| `/start` | Creates a new virtual session and starts a conversation |
| `/reset` | Ends the current conversation and starts a fresh one (requires `conversation_control` API key feature) |
| `/stage <stageId>` | Navigates to a specific stage (requires `stage_control` API key feature) |
| Any other text | Sent as user input to the active conversation |
| Unknown `/xxx` commands | Treated as regular text (falls through to AI) |

### Outbound Messages

Only `end_ai_generation_output` messages produce a Telegram text message, sent via the Bot API `sendMessage` with Markdown parse mode.

## Webhook URL

The webhook accepts both `GET` and `POST`:

```
/api/telegram/webhook?apiKey=xxx&stageId=yyy&channelProviderId=zzz[&agentId=aaa]
```

| Query Parameter | Required | Description |
|---|---|---|
| `apiKey` | Yes | API key for authentication |
| `channelProviderId` | Yes | ID of the Telegram channel provider |
| `stageId` | No | Starting stage ID |
| `agentId` | No | Agent override |

## Processing Delay

By default, incoming messages are processed immediately. To introduce a natural response delay, set `processingDelayMinMs` and `processingDelayMaxMs` on the provider config. The actual delay is picked uniformly at random from `[min, max]` per message.

Recommended for Telegram: `5000`–`30000` (5 to 30 seconds).

See [Deferred Processing](./deferred-processing) for details.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `TELEGRAM_SESSION_TIMEOUT_MS` | `1800000` (30 min) | Session inactivity timeout |

## References

- [Providers](./providers) — Provider configuration
- [API Keys](../api/api-keys) — API key management and feature flags
- [Conversations](./conversations) — Conversation lifecycle
