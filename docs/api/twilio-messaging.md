# Twilio Messaging API

The Twilio Messaging channel handles inbound SMS and WhatsApp messages via Twilio webhooks. See the [Twilio Messaging Channel](../guide/twilio-messaging) guide for setup instructions.

## Webhook Endpoint

### POST /api/twilio/messaging/webhook

Receives an inbound Twilio Messaging webhook. This endpoint is called by Twilio — not by your own clients.

**No standard API authentication** — the request is authenticated by validating the `X-Twilio-Signature` Twilio header together with the `apiKey` query parameter.

#### Query Parameters

| Parameter | Required | Description |
|---|---|---|
| `apiKey` | Yes | API key used to identify the project and validate channel/feature permissions |
| `stageId` | Yes | Stage ID to start new conversations at for first-time senders |
| `channelProviderId` | Yes | ID of the `channel` provider record containing Twilio credentials |
| `agentId` | No | Optional agent ID override applied when starting new conversations |

#### Request

Twilio sends an `application/x-www-form-urlencoded` body:

```
From=%2B15559876543&To=%2B15551234567&Body=Hello&...
```

Relevant fields consumed by the handler:

| Field | Description |
|---|---|
| `From` | Sender phone number in E.164 format — becomes `userId` for the conversation |
| `To` | Recipient (your Twilio number) |
| `Body` | Message text — delivered as `send_user_text_input` |

#### Response

```http
HTTP/1.1 200 OK
Content-Type: text/xml
```

```xml
<Response/>
```

An empty TwiML response is always returned. Outbound replies are sent proactively via the Twilio REST API after the AI turn completes — not in this response body.

#### Error Responses

| Status | Cause |
|---|---|
| `400 Bad Request` | Missing or invalid query parameters; missing `From` or `Body` fields; `channelProviderId` not found or wrong type; invalid provider config |
| `401 Unauthorized` | API key is missing, unknown, or inactive |
| `403 Forbidden` | `X-Twilio-Signature` validation failed; API key does not permit `twilio_messaging` channel |
| `429 Too Many Requests` | IP-based rate limit exceeded |
| `500 Internal Server Error` | Provider config is malformed |

---

## Channel Provider Configuration

A channel provider for Twilio Messaging uses `providerType: "channel"` and `apiType: "twilio_messaging"`. Manage it via the standard [Providers API](./providers).

### Config Schema

```json
{
  "accountSid": "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "authToken": "your_auth_token",
  "fromNumber": "+15551234567"
}
```

| Field | Type | Description |
|---|---|---|
| `accountSid` | `string` | Twilio Account SID (starts with `AC`) |
| `authToken` | `string` | Twilio Auth Token used for signature validation and REST API calls |
| `fromNumber` | `string` | Sender number in E.164 format (or <code v-pre>whatsapp:+1...</code> for WhatsApp) |

---

## Session Management

The Twilio Messaging channel maintains **virtual sessions** in memory, keyed by `projectId + senderPhoneNumber`. No persistent socket exists.

| Event | Behaviour |
|---|---|
| First message from a number | New session created; `start_conversation` dispatched with `userId = From`; text input delivered |
| Subsequent messages | Same session reused; only `send_user_text_input` dispatched |
| Inactivity timeout | Session unregistered; next message starts a fresh conversation |

### Inactivity Timeout

Default: **30 minutes**. Override via environment variable:

```
TWILIO_MESSAGING_SESSION_TIMEOUT_MS=1800000
```

---

## Webhook URL Structure

Configure this URL in the Twilio console for your phone number:

```
POST https://your-backend.example.com/api/twilio/messaging/webhook
  ?apiKey=<api-key-value>
  &stageId=<stage-id>
  &channelProviderId=<provider-id>
  [&agentId=<agent-id>]
```

::: tip
Query parameters are part of the URL used for Twilio request signature validation. Do not modify them after configuring — the signature will break.
:::
