# WhatsApp API

The WhatsApp channel handles inbound messages from WhatsApp users via Meta webhooks. See the [WhatsApp Channel](../guide/whatsapp) guide for setup instructions.

## Webhook Endpoints

### GET /api/whatsapp/webhook

Handles the one-time Meta webhook challenge/verification request. Called by Meta when the webhook URL is first registered in the App Dashboard — not by your own clients.

#### Query Parameters

| Parameter | Required | Description |
|---|---|---|
| `apiKey` | Yes | API key used to identify the channel provider |
| `stageId` | Yes | Stage ID (not used during verification, but required by the shared query schema) |
| `channelProviderId` | Yes | ID of the `channel` provider record containing Meta credentials |

Meta also appends `hub.mode=subscribe`, `hub.verify_token`, and `hub.challenge` to the URL.

#### Response

```http
HTTP/1.1 200 OK
Content-Type: text/plain

<hub.challenge value>
```

#### Error Responses

| Status | Cause |
|---|---|
| `400 Bad Request` | Missing or invalid query parameters; `channelProviderId` not found or wrong type |
| `403 Forbidden` | `hub.verify_token` does not match the `verifyToken` in the channel provider config |
| `500 Internal Server Error` | Channel provider config is malformed |

---

### POST /api/whatsapp/webhook

Receives an inbound Meta WhatsApp webhook. Called by Meta for every message, status update, or other notification — not by your own clients.

**No standard API authentication** — the request is authenticated by validating the `X-Hub-Signature-256` header (HMAC-SHA256 of the raw body using the `appSecret` from the channel provider config).

::: tip Always returns 200
Meta requires a `200 OK` response within 20 seconds. Bonsai sends this immediately before processing, so error conditions (invalid signature, unknown sender, etc.) result in a silent no-op rather than a non-200 status.
:::

#### Query Parameters

| Parameter | Required | Description |
|---|---|---|
| `apiKey` | Yes | API key used to identify the project and validate channel/feature permissions |
| `stageId` | Yes | Stage ID to start new conversations at for first-time senders |
| `channelProviderId` | Yes | ID of the `channel` provider record containing Meta credentials |
| `agentId` | No | Optional agent ID override applied when starting new conversations |

#### Request

Meta sends a JSON body:

```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "changes": [{
      "value": {
        "messages": [{
          "from": "15559876543",
          "id": "wamid.xxx",
          "type": "text",
          "text": { "body": "Hello" }
        }],
        "metadata": { "phone_number_id": "123456789012345" }
      }
    }]
  }]
}
```

Relevant fields consumed by the handler:

| Field | Description |
|---|---|
| `entry[0].changes[0].value.messages[0].from` | Sender phone number — becomes `userId` for the conversation |
| `entry[0].changes[0].value.messages[0].text.body` | Message text — delivered as `send_user_text_input` |
| `entry[0].changes[0].value.messages[0].type` | Must be `"text"` — other types (image, audio, etc.) are silently ignored |

#### Response

```http
HTTP/1.1 200 OK
Content-Type: application/json

{}
```

An empty JSON object is always returned immediately. Outbound replies are sent proactively via the Meta Graph API after the AI turn completes.

---

## Channel Provider Configuration

A channel provider for WhatsApp uses `providerType: "channel"` and `apiType: "whatsapp"`. Manage it via the standard [Providers API](./providers).

### Config Schema

```json
{
  "phoneNumberId": "123456789012345",
  "accessToken": "EAAxxxxxxxxxxxxxxxx",
  "appSecret": "your_app_secret",
  "verifyToken": "your_custom_verify_token"
}
```

| Field | Type | Description |
|---|---|---|
| `phoneNumberId` | `string` | Meta phone number ID used in the Graph API URL for outbound messages |
| `accessToken` | `string` | Permanent Meta access token used as Bearer auth for Graph API calls |
| `appSecret` | `string` | Meta app secret used to validate `X-Hub-Signature-256` on inbound webhooks |
| `verifyToken` | `string` | Static token echoed back during one-time Meta webhook challenge verification |

---

## Session Management

The WhatsApp channel maintains **virtual sessions** in memory, keyed by `projectId + senderPhoneNumber`. No persistent socket exists.

| Event | Behaviour |
|---|---|
| First text message from a number | New session created; `start_conversation` dispatched with `userId = from`; text input delivered |
| Subsequent messages | Same session reused; only `send_user_text_input` (or slash command) dispatched |
| `/reset` command | Active session torn down; `end_conversation` dispatched; fresh session started |
| `/stage <id>` command | `go_to_stage` dispatched on the active session |
| Inactivity timeout | Session unregistered; next message starts a fresh conversation |

### Inactivity Timeout

Default: **30 minutes**. Override via environment variable:

```
WHATSAPP_SESSION_TIMEOUT_MS=1800000
```

---

## Slash Commands

| Command | Dispatched message | Required feature |
|---|---|---|
| `/reset` | `end_conversation` + `start_conversation` | `conversation_control` |
| `/stage <stageId>` | `go_to_stage` | `stage_control` |
| Any other text (incl. unknown `/xxx`) | `send_user_text_input` | `text_input` |

---

## Webhook URL Structure

Configure this URL in the Meta App Dashboard under **WhatsApp > Configuration > Webhook**:

```
https://your-backend.example.com/api/whatsapp/webhook
  ?apiKey=<api-key-value>
  &stageId=<stage-id>
  &channelProviderId=<provider-id>
  [&agentId=<agent-id>]
```

The same URL with the same query parameters is used for both the `GET` verification request and `POST` inbound messages.

::: warning
Query parameters are part of the URL Meta records during webhook verification. Changing query parameters after verification has been completed requires re-verifying the webhook.
:::
