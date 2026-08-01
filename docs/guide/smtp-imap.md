# SMTP-IMAP Email

The **SMTP-IMAP** channel enables full email conversations using standard SMTP for sending and IMAP for receiving. Unlike webhook-based channels, SMTP-IMAP actively polls an IMAP mailbox for new messages, enabling email conversations with any email provider that supports SMTP/IMAP (Gmail, Outlook, custom servers).

## Setup

### 1. Create a Channel Provider

Create a provider of type `channel` with API type `smtp_imap`. Configuration:

```json
{
  "projectId": "your-project-id",
  "fromAddress": "bot@yourdomain.com",
  "threadingStrategy": "messageId",
  "smtp": {
    "host": "smtp.yourdomain.com",
    "port": 587,
    "secure": false,
    "auth": {
      "user": "bot@yourdomain.com",
      "pass": "your-password"
    }
  },
  "imap": {
    "host": "imap.yourdomain.com",
    "port": 993,
    "secure": true,
    "auth": {
      "user": "bot@yourdomain.com",
      "pass": "your-password"
    },
    "pollingIntervalMs": 30000
  }
}
```

| Field | Description |
|---|---|
| `projectId` | Project ID for IMAP inbound routing |
| `fromAddress` | Sender email address |
| `threadingStrategy` | `messageId` (default) or `senderSubject` |
| `smtp.host` | SMTP server hostname |
| `smtp.port` | SMTP port (587 for STARTTLS, 465 for implicit TLS) |
| `smtp.secure` | `true` for implicit TLS, `false` for STARTTLS |
| `smtp.auth.user` | SMTP username |
| `smtp.auth.pass` | SMTP password or app-specific password |
| `imap.host` | IMAP server hostname |
| `imap.port` | IMAP port (993 for TLS, 143 for STARTTLS) |
| `imap.secure` | `true` for implicit TLS, `false` for STARTTLS |
| `imap.auth.user` | IMAP username |
| `imap.auth.pass` | IMAP password or app-specific password |
| `imap.pollingIntervalMs` | Fallback polling interval when IDLE is unavailable (default: 30000) |
| `processingDelayMinMs` | Minimum delay in milliseconds before processing an incoming message (default: 0, disabled) |
| `processingDelayMaxMs` | Maximum delay in milliseconds before processing an incoming message (default: 0, disabled) |

### 2. Secret Migration

The `smtp.auth.pass` and `imap.auth.pass` fields are automatically migrated to encrypted storage on startup if `MASTER_ENCRYPTION_KEY` is set.

## How It Works

### Outbound (SMTP)

To initiate an outgoing conversation:

```http
POST /api/email/smtp-imap/send?apiKey=YOUR_API_KEY&channelProviderId=YOUR_PROVIDER_ID
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

The system verifies the SMTP connection, creates a conversation record, and starts the conversation. AI responses are sent via `nodemailer` with proper `Message-ID`, `In-Reply-To`, and `References` headers.

### Inbound (IMAP Polling)

The `ImapInboundService` starts at server boot and:

1. Discovers all `smtp_imap` channel providers
2. For each provider, creates an `ImapMailboxSession` with persistent connection (`keepalive: true`)
3. Uses IMAP IDLE for real-time notification, falling back to polling at the configured interval
4. Parses each new message with `mailparser`, extracting sender, body, subject, and threading headers
5. Routes replies to existing conversations via `In-Reply-To` / `References` headers
6. Creates new virtual sessions and conversations for unrecognized senders
7. Marks processed messages as `\Seen` to avoid reprocessing

Connection failures trigger exponential backoff reconnection (max 5 minutes).

### Threading

Outbound emails include `Message-ID` (generated from conversation ID), `In-Reply-To`, and `References` headers. The `skipNextEmail` flag suppresses the first response on new inbound conversations.

### Outbound Attachments

When an action uses the [`attach_file`](./actions-and-effects#attach_file) effect alongside `generate_response`, the resulting file is downloaded from storage and included as an attachment on the outbound email. Multiple attachments are supported and delivered in the order they were staged. The email is sent with all attachments buffered after the AI response completes.

### Processing Delay

By default, incoming emails are processed immediately. To introduce a natural response delay, set `processingDelayMinMs` and `processingDelayMaxMs` on the provider config. The actual delay is picked uniformly at random from `[min, max]` per message. The full AI pipeline (generation, tool execution, reply) runs only after the delay elapses.

Recommended for email: `30000`–`120000` (30 seconds to 2 minutes).

See [Deferred Processing](./deferred-processing) for details.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `EMAIL_SESSION_TIMEOUT_MS` | `86400000` (24 hours) | Session inactivity timeout |
| `MASTER_ENCRYPTION_KEY` | — | Enables automatic migration of SMTP/IMAP passwords to encrypted storage |

## References

- [Providers](./providers) — Provider configuration
- [API Keys](../api/api-keys) — API key management
- [Conversations](./conversations) — Conversation lifecycle
