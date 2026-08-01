# SendGrid Email

The **SendGrid** channel enables email-based conversations via SendGrid's API. Supports both inbound (receiving replies via SendGrid webhook) and outbound (initiating conversations by sending emails).

> **Note:** This channel exists in the codebase but is currently disabled by default. It is commented out in the server configuration.

## Setup

### 1. Create a Channel Provider

Create a provider of type `channel` with API type `sendgrid`. Configuration:

```json
{
  "apiKey": "SG.xxxxxxxx",
  "fromAddress": "bot@yourdomain.com",
  "threadingStrategy": "messageId"
}
```

| Field | Description |
|---|---|
| `apiKey` | SendGrid API key |
| `fromAddress` | Sender email address |
| `threadingStrategy` | `messageId` (default) or `senderSubject` — how to derive thread ID for conversation continuity |
| `processingDelayMinMs` | Minimum delay in milliseconds before processing an incoming message (default: 0, disabled) |
| `processingDelayMaxMs` | Maximum delay in milliseconds before processing an incoming message (default: 0, disabled) |

### 2. Configure SendGrid Inbound Parse

In your SendGrid dashboard, configure Inbound Parse to forward incoming emails to:

```
https://your-domain.com/api/email/sendgrid/inbound?apiKey=YOUR_API_KEY&channelProviderId=YOUR_PROVIDER_ID
```

## How It Works

### Inbound Emails

When SendGrid forwards an incoming email:

1. System extracts sender email, text body, and threading headers
2. If `In-Reply-To` references an existing conversation, the reply is routed to that session
3. Otherwise, a new virtual session and conversation are created

### Outbound Emails

To initiate an outgoing conversation:

```http
POST /api/email/sendgrid/send?apiKey=YOUR_API_KEY&channelProviderId=YOUR_PROVIDER_ID
Content-Type: application/json
```

```json
{
  "to": "user@example.com",
  "subject": "Hello",
  "stageId": "greeting",
  "agentId": "agent-id",
  "userProfile": { "name": "John" },
  "metadata": { "source": "marketing" }
}
```

| Field | Required | Description |
|---|---|---|
| `to` | Yes | Recipient email (user ID) |
| `fromAddress` | No | Override sender address |
| `subject` | No | Email subject (default: "New Conversation") |
| `stageId` | No | Stage to start at |
| `agentId` | No | Agent override |
| `userProfile` | No | User profile attributes to upsert |
| `metadata` | No | Conversation metadata |

AI responses are sent back via SendGrid's SDK. Only `end_ai_generation_output` messages produce an email.

### Outbound Attachments

When an action uses the [`attach_file`](./actions-and-effects#attach_file) effect alongside `generate_response`, the resulting file is downloaded from storage and included as an attachment on the outbound email. Multiple attachments are supported and delivered in the order they were staged.

### Threading

Outbound emails include `Message-ID` (generated from conversation ID), `In-Reply-To`, and `References` headers to maintain email thread continuity.

The `skipNextEmail` flag is used internally to suppress the first response when an inbound email already triggered a conversation start.

### Processing Delay

By default, incoming emails are processed immediately. To introduce a natural response delay, set `processingDelayMinMs` and `processingDelayMaxMs` on the provider config. The actual delay is picked uniformly at random from `[min, max]` per message.

Recommended for email: `30000`–`120000` (30 seconds to 2 minutes).

See [Deferred Processing](./deferred-processing) for details.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `EMAIL_SESSION_TIMEOUT_MS` | `86400000` (24 hours) | Session inactivity timeout |

## References

- [Providers](./providers) — Provider configuration
- [API Keys](../api/api-keys) — API key management
- [Conversations](./conversations) — Conversation lifecycle
