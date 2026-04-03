# Twilio Messaging Channel

The Twilio Messaging channel enables text-based conversations over SMS and WhatsApp using [Twilio's Messaging API](https://www.twilio.com/docs/messaging). Inbound messages arrive as HTTP webhooks; outbound replies are sent via the Twilio REST API.

This is a **text-only, server-initiated** channel — there is no persistent client socket. Instead, each unique sender phone number gets a virtual session that is automatically created on the first message and expires after a configurable inactivity period.

## When to Use Twilio Messaging

| Scenario | Recommended? |
|---|---|
| SMS-based conversational agents | ✅ Yes |
| WhatsApp business messaging | ✅ Yes |
| Voice calls / IVR | ❌ No — use Twilio Media Streaming (voice channel) |
| Browser or mobile app conversations | ❌ No — use WebSocket or WebRTC |

## Prerequisites

1. A [Twilio account](https://www.twilio.com/try-twilio) with a phone number capable of sending/receiving SMS (or a WhatsApp-enabled Twilio number).
2. A publicly reachable HTTPS URL for your Bonsai backend (Twilio's webhook validation requires HTTPS in production).
3. A project with at least one stage configured.

## Setup Overview

1. Create a **channel provider** record in Bonsai with your Twilio credentials.
2. Create (or reuse) an **API key** with the `twilio_messaging` channel permitted.
3. Configure the Twilio **webhook URL** on your phone number in the Twilio console.
4. Send a test SMS — a conversation starts automatically.

---

## Step 1: Create a Channel Provider

A channel provider stores your Twilio credentials securely. It is a standard provider record with `providerType: "channel"` and `apiType: "twilio_messaging"`.

```http
POST /api/providers
Content-Type: application/json
Authorization: Bearer <operator-token>
```

```json
{
  "name": "My Twilio SMS",
  "providerType": "channel",
  "apiType": "twilio_messaging",
  "config": {
    "accountSid": "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "authToken": "your_auth_token",
    "fromNumber": "+15551234567"
  }
}
```

Save the `id` from the response — you will need it in the webhook URL.

| Config Field | Description |
|---|---|
| `accountSid` | Twilio Account SID (starts with `AC`) |
| `authToken` | Twilio Auth Token — used to validate incoming webhook signatures and send messages |
| `fromNumber` | The Twilio phone number in E.164 format (e.g. `+15551234567`) used as the sender |

::: warning Auth Token Security
The `authToken` is stored in the provider `config` field and is readable by operators with `provider:read` permission. Use a dedicated sub-account Auth Token in production and rotate it if compromised.
:::

## Step 2: Create (or Update) an API Key

Ensure the API key you use explicitly permits the `twilio_messaging` channel. When `allowedChannels` is `null` (omitted), all channels are allowed.

```http
POST /api/api-keys
Content-Type: application/json
Authorization: Bearer <operator-token>
```

```json
{
  "projectId": "your-project-id",
  "name": "Twilio SMS key",
  "allowedChannels": ["twilio_messaging"],
  "allowedFeatures": ["conversation_control", "text_input", "text_output"]
}
```

Save the `key` value from the response.

## Step 3: Configure the Twilio Webhook URL

In the [Twilio console](https://console.twilio.com), navigate to your phone number's messaging configuration and set the **"A message comes in"** webhook to:

```
POST https://your-backend.example.com/api/twilio/messaging/webhook?apiKey=<key>&stageId=<stage-id>&channelProviderId=<provider-id>
```

### Query Parameters

| Parameter | Required | Description |
|---|---|---|
| `apiKey` | Yes | The API key value from Step 2 |
| `stageId` | Yes | The stage ID to start new conversations at |
| `channelProviderId` | Yes | The provider `id` from Step 1 |
| `agentId` | No | Optional agent ID override for conversation start |

::: tip One URL Per Stage
You can point multiple Twilio numbers at different webhook URLs with different `stageId` values to run independent conversation flows from a single backend instance.
:::

---

## Session Lifecycle

When a message arrives from a new sender number:

1. A virtual session is created and linked to a new conversation on the configured stage.
2. The user's message is delivered as the first text input.
3. The AI responds — the reply text is sent as an outbound Twilio message to the sender.
4. Subsequent messages from the same number **reuse the same session** and keep the conversation context alive.

Sessions expire automatically after **30 minutes of inactivity** (no new inbound messages). On expiry:
- The conversation is ended.
- The session is removed from memory.
- The next message from that number starts a fresh conversation.

### Inactivity Timeout

The timeout can be configured globally via an environment variable:

```
TWILIO_MESSAGING_SESSION_TIMEOUT_MS=1800000   # 30 minutes (default)
```

---

## WhatsApp

Twilio Messaging also supports WhatsApp. Use a WhatsApp-enabled sender number and format the `fromNumber` configuration accordingly. No other changes are required — the channel treats WhatsApp and SMS identically at the session level.

WhatsApp sender format: `whatsapp:+15551234567`

```json
{
  "fromNumber": "whatsapp:+15551234567"
}
```

---

## Limitations

| Feature | Supported |
|---|---|
| Text input / output | ✅ |
| Voice input / output | ❌ |
| Commands (go-to-stage, set-var, etc.) | ❌ |
| Events (conversation_event push) | ❌ |
| Transcription updates | ❌ |
| Session authentication (per-message API key) | ✅ (via webhook URL query param) |
| Twilio request signature validation | ✅ |

The channel only delivers the final AI text turn (`end_ai_generation_output`) as an SMS/WhatsApp message. Streaming voice chunks, image outputs, and event push messages are silently discarded.

## Security

Every inbound webhook is validated using the **Twilio request signature**. Requests with a missing or invalid `X-Twilio-Signature` header are rejected with `403 Forbidden`. This prevents spoofed webhook calls from arbitrary HTTP clients.

The validation uses the `authToken` from the configured channel provider and the full webhook URL (including query parameters). Make sure:

- Your backend is reachable at the exact URL you configured in the Twilio console.
- If you run behind a reverse proxy, ensure `trust proxy` is enabled (it is by default) so `req.protocol` and `req.get('host')` reflect the public URL.
