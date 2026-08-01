# Deferred Processing

**Deferred processing** delays the processing of incoming messages on non-immediate channels (email, SMS, WhatsApp, Telegram). Instead of triggering the AI pipeline immediately, the message is queued with a random delay, and the full pipeline (AI generation, tool execution, side effects, response delivery) runs only after the delay elapses.

## Why Defer Processing?

### Natural Response Timing

Non-immediate channels have different user expectations than real-time chat. An instant reply to an email or SMS can feel robotic, trigger spam filters, or raise user suspicion. Deferred processing introduces a configurable, randomized delay so responses arrive at a natural pace.

### Side Effect Ordering

Deferring at the **incoming** layer (not the outgoing layer) ensures side effects fire at the right time. If only the final response were delayed, tools would execute, external APIs would be called, and payments would be charged — all before the user sees any response. By deferring the entire pipeline, the user sees the response at the same time the system acts.

## How It Works

```
Incoming message arrives at channel host
        │
        ▼
┌─────────────────────────┐
│  Has deferral config?   │
└────────┬────────────────┘
         │
    yes  │        no
         │         └──▶ dispatch immediately (current behavior)
         ▼
┌──────────────────────────────┐
│  Compute processAt =         │
│  now + random(min, max)      │
│  Persist to DB queue         │
└────────┬─────────────────────┘
         │
┌────────▼─────────────────────┐
│  ProcessingDeferralService   │
│  (polls every 15 seconds)    │
└────────┬─────────────────────┘
         │
    processAt passed?
         │
    yes  │        no
         │         └──▶ wait next poll
         ▼
┌──────────────────────────────┐
│  Full AI pipeline runs       │
│  (generation, tools, reply)  │
└──────────────────────────────┘
```

### Key Behaviors

- **Random uniform delay** — actual delay is picked uniformly at random from `[min, max]` per message.
- **DB-backed queue** — messages survive server restarts and are observable via the REST API.
- **Retry with backoff** — failed dispatches retry up to 3 times with exponential backoff (1m, 5m, 15m).
- **Automatic cleanup** — processed/failed/cancelled records older than 7 days are purged.
- **Session-safe** — if a session expires before `processAt`, the entry is cancelled automatically.
- **`start_conversation` is never deferred** — conversation creation is immediate; only user input messages are deferred.

## Configuration

Add two fields to a channel provider's config:

```json
{
  "processingDelayMinMs": 30000,
  "processingDelayMaxMs": 120000
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `processingDelayMinMs` | `number` (ms) | `0` | Minimum delay before processing. `0` disables deferral. |
| `processingDelayMaxMs` | `number` (ms) | `0` | Maximum delay before processing. Must be `>= processingDelayMinMs`. |

When both are `0` (default), messages are processed immediately — current behavior is preserved.

### Recommended Defaults by Channel

| Channel | Min | Max | Rationale |
|---|---|---|---|
| Email (SMTP/IMAP, SendGrid, SES) | 30 000 (30s) | 120 000 (2m) | 30s–2min feels natural for email |
| SMS (Twilio Messaging) | 10 000 (10s) | 45 000 (45s) | Shorter expectations for SMS |
| WhatsApp | 10 000 (10s) | 45 000 (45s) | Same as SMS |
| Telegram | 5 000 (5s) | 30 000 (30s) | Faster expectations for chat apps |

These are recommendations, not hardcoded defaults. Config values default to `0` (disabled).

## Supported Channels

Deferred processing applies to all **non-immediate** channel providers:

| Channel | Supported |
|---|---|
| SMTP-IMAP Email | ✅ |
| SendGrid Email | ✅ |
| SES Email | ✅ |
| Twilio Messaging (SMS/WhatsApp) | ✅ |
| WhatsApp (Meta Cloud API) | ✅ |
| Telegram | ✅ |
| WebSocket | ❌ (real-time) |
| WebRTC | ❌ (real-time) |
| Twilio Voice | ❌ (real-time voice) |

## Observability & Control

The deferred processing queue is exposed via a REST API:

- **`GET /api/projects/:projectId/deferred-processing`** — list entries with filters
- **`GET /api/projects/:projectId/deferred-processing/:id`** — get single entry
- **`POST /api/projects/:projectId/deferred-processing/:id/reschedule`** — change processing time
- **`POST /api/projects/:projectId/deferred-processing/:id/cancel`** — cancel a pending entry

See [Deferred Processing API](../api/deferred-processing) for full reference.

### Status Values

| Status | Description |
|---|---|
| `pending` | Queued and waiting for `processAt` |
| `processed` | Successfully dispatched to the AI pipeline |
| `failed` | Dispatch failed after 3 retries |
| `cancelled` | Cancelled manually or due to session timeout |

## Edge Cases

### Session Expires Before Processing

If a session times out before `processAt` arrives, the entry is automatically cancelled. The conversation record remains in its current state. If a new inbound message arrives from the same user, a new session is created and the new message goes through its own deferral cycle.

### Multiple Messages for Same Conversation

Each message gets its own queue entry with its own `processAt`. Messages are processed in `processAt` order (FIFO within the same second).

### Server Restart

Queue entries are persisted in the database and survive restarts. Sessions are in-memory — if the server restarts, deferred messages for lost sessions are cancelled when `processAt` arrives. This is acceptable for non-immediate channels since users are not waiting in real-time.

## References

- [SMTP-IMAP Email](./smtp-imap) — Email channel with deferral support
- [SendGrid Email](./sendgrid) — SendGrid channel with deferral support
- [SES Email](./ses-email) — AWS SES channel with deferral support
- [Twilio Messaging](./twilio-messaging) — SMS channel with deferral support
- [WhatsApp](./whatsapp) — WhatsApp channel with deferral support
- [Telegram](./telegram) — Telegram channel with deferral support
- [Deferred Processing API](../api/deferred-processing) — REST API reference
- [Conversations](./conversations) — Conversation lifecycle
