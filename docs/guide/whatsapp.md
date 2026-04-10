# WhatsApp Channel

The WhatsApp channel enables text-based conversations over WhatsApp using the [Meta WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api). Inbound messages arrive as HTTPS webhooks from Meta; outbound replies are sent via the Meta Graph API.

This is a **text-only, server-initiated** channel — there is no persistent client socket. Each unique sender phone number gets a virtual session that is automatically created on the first message and expires after a configurable inactivity period.

## When to Use WhatsApp

| Scenario | Recommended? |
|---|---|
| WhatsApp Business conversational agents | ✅ Yes |
| Text-based customer support | ✅ Yes |
| Voice calls / IVR | ❌ No — use Twilio Voice channel |
| Browser or mobile app conversations | ❌ No — use WebSocket or WebRTC |
| SMS messaging | ❌ No — use Twilio Messaging channel |

## Prerequisites

1. A [Meta Developer account](https://developers.facebook.com) with a WhatsApp Business app.
2. A **WhatsApp Business Account (WABA)** with a phone number onboarded in Meta's App Dashboard.
3. A **permanent access token** (or a system user token) with `whatsapp_business_messaging` permission.
4. A publicly reachable HTTPS URL for your Bonsai backend (Meta requires HTTPS).
5. A project with at least one stage configured.

## Setup Overview

1. Create a **channel provider** record with your Meta credentials.
2. Create (or reuse) an **API key** with the `whatsapp` channel permitted.
3. Configure the **webhook URL** in the Meta App Dashboard.
4. Send a test WhatsApp message — a conversation starts automatically.

---

## Step 1: Create a Channel Provider

A channel provider stores your Meta credentials securely. Create one with `providerType: "channel"` and `apiType: "whatsapp"`.

```http
POST /api/providers
Content-Type: application/json
Authorization: Bearer <operator-token>
```

```json
{
  "name": "My WhatsApp Business",
  "providerType": "channel",
  "apiType": "whatsapp",
  "config": {
    "phoneNumberId": "123456789012345",
    "accessToken": "EAAxxxxxxxxxxxxxxxx",
    "appSecret": "your_app_secret",
    "verifyToken": "your_custom_verify_token"
  }
}
```

Save the `id` from the response — you will need it in the webhook URL.

| Config Field | Description |
|---|---|
| `phoneNumberId` | The Meta phone number ID used in Graph API URLs for outbound messages (found in the App Dashboard under WhatsApp > API Setup) |
| `accessToken` | Permanent Meta access token (or system user token) used as Bearer auth for Graph API calls |
| `appSecret` | Meta app secret used to validate incoming webhook signatures via HMAC-SHA256 (found in the App Dashboard under App Settings > Basic) |
| `verifyToken` | A static string of your choice — echoed back during the one-time Meta webhook challenge/verification |

::: warning Access Token Security
The `accessToken` and `appSecret` are stored in the provider `config` field and are readable by operators with `provider:read` permission. Use a dedicated system user token with minimal scopes in production and rotate it if compromised.
:::

## Step 2: Create (or Update) an API Key

Ensure the API key permits the `whatsapp` channel. When `allowedChannels` is omitted, all channels are allowed.

```http
POST /api/api-keys
Content-Type: application/json
Authorization: Bearer <operator-token>
```

```json
{
  "projectId": "your-project-id",
  "name": "WhatsApp key",
  "allowedChannels": ["whatsapp"],
  "allowedFeatures": ["conversation_control", "text_input", "text_output"]
}
```

Save the `key` value from the response.

## Step 3: Configure the Meta Webhook URL

In the [Meta App Dashboard](https://developers.facebook.com), navigate to **WhatsApp > Configuration > Webhook** and set:

- **Callback URL**: `https://your-backend.example.com/api/whatsapp/webhook?apiKey=<key>&stageId=<stage-id>&channelProviderId=<provider-id>`
- **Verify Token**: the exact `verifyToken` value from your channel provider config

Then subscribe to the **messages** webhook field.

### Query Parameters

| Parameter | Required | Description |
|---|---|---|
| `apiKey` | Yes | The API key value from Step 2 |
| `stageId` | Yes | The stage ID to start new conversations at |
| `channelProviderId` | Yes | The provider `id` from Step 1 |
| `agentId` | No | Optional agent ID override for conversation start |

::: tip One URL Per Stage
You can configure different webhook URLs with different `stageId` values to route conversations to different flows from the same backend.
:::

---

## Session Lifecycle

When a text message arrives from a new sender number:

1. A virtual session is created and linked to a new conversation on the configured stage.
2. The user's message is delivered as the first text input.
3. The AI responds — the reply text is sent as an outbound WhatsApp message to the sender.
4. Subsequent messages from the same number **reuse the same session** and keep the conversation context alive.

Sessions expire automatically after **30 minutes of inactivity**. On expiry:
- The conversation is ended.
- The session is removed from memory.
- The next message from that number starts a fresh conversation.

### Inactivity Timeout

The timeout can be configured globally via an environment variable:

```
WHATSAPP_SESSION_TIMEOUT_MS=1800000   # 30 minutes (default)
```

---

## Slash Commands

The WhatsApp channel supports a lightweight slash-command interface for control operations sent by the user.

| Command | Description | Required API key feature |
|---|---|---|
| `/reset` | Ends the current conversation and immediately starts a fresh one | `conversation_control` |
| `/stage <stageId>` | Navigates to a specific stage mid-conversation | `stage_control` |
| Any other `/xxx` | Treated as regular text input, forwarded to the AI | — |

::: tip
Unknown slash commands (e.g. `/help`) are not intercepted — they are passed through to the AI as normal text input, so you can handle them in your stage prompt.
:::

---

## Limitations

| Feature | Supported |
|---|---|
| Text input / output | ✅ |
| Voice input / output | ❌ |
| Image / media messages | ❌ (silently ignored) |
| Events (conversation_event push) | ❌ |
| Transcription updates | ❌ |
| Session authentication (per-message API key) | ✅ (via webhook URL query param) |
| Meta webhook signature validation | ✅ |

Only `end_ai_generation_output` messages are delivered as WhatsApp replies. Streaming voice chunks, image outputs, and event push messages are silently discarded. Non-text inbound message types (images, audio, video, documents) are silently ignored.

---

## Security

### Webhook Signature Validation

Every inbound POST is validated using the **`X-Hub-Signature-256` header** — an HMAC-SHA256 signature of the raw request body computed with the `appSecret`. Requests with a missing or invalid signature are silently dropped (Meta requires a 200 response regardless, which is sent before any validation).

Ensure:

- The exact webhook URL (including query parameters) is used consistently — the signature is computed over the raw body only, but your `appSecret` must match the app that signed the request.
- If you run behind a reverse proxy, ensure the raw request body is preserved and forwarded without modification.

### Webhook Verification (Challenge)

When you first set the webhook URL in the Meta App Dashboard, Meta sends a `GET` request with `hub.mode=subscribe`, `hub.verify_token`, and `hub.challenge`. Bonsai responds by comparing `hub.verify_token` against the `verifyToken` in your channel provider config and echoing back `hub.challenge` on match.

### Rate Limiting

Inbound webhooks are subject to IP-based rate limiting. Excessive requests from the same IP are silently dropped.
