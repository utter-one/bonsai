# Processing Deferral Mechanism — Specification

## 1. Problem Statement

Non-immediate communication channels (email, SMS, WhatsApp, Telegram) currently process incoming messages and deliver AI responses as soon as generation completes. This creates two problems:

1. **Unnatural experience** — the agent replies instantly, which feels robotic and can trigger spam filters or user suspicion.
2. **Premature side effects** — AI actions and tools execute immediately upon receiving the message, potentially triggering consequences (sending emails, making API calls, updating external systems, charging payments) **before** the response delay elapses. If the response is deferred at the outgoing layer, these side effects have already fired, and the user sees no response correlating with them.

The solution: **defer processing**, not just the final response. The incoming message is queued with a random delay, and the entire pipeline (AI generation, tool execution, side effects, response delivery) runs only after the delay elapses.

## 2. Requirements

### 2.1 Core Requirements

- **Min/max delay configuration** — each channel provider defines `processingDelayMinMs` and `processingDelayMaxMs` (milliseconds).
- **Uniform random distribution** — actual delay is picked uniformly at random from `[min, max]` per incoming message.
- **Processing deferral, not response deferral** — the delay occurs **before** the message enters the ConversationRunner pipeline. No AI generation, no tool execution, no side effects occur until after the delay.
- **Per-channel-provider scope** — delay settings live on the channel provider config, so different providers (e.g., two SMTP accounts) can have different delay profiles.
- **Opt-in** — deferral is disabled by default. When `processingDelayMinMs` and `processingDelayMaxMs` are absent or both zero, messages are processed immediately (current behavior).
- **Applies to all non-immediate channels** — email (SMTP/IMAP, SendGrid, SES), SMS (Twilio Messaging), WhatsApp, Telegram.

### 2.2 Non-Goals (V1)

- Not configurable per conversation or per stage (provider-level only).
- No jitter functions beyond uniform random (e.g., normal distribution).
- No "business hours" awareness.
- No per-user delay customization.
- WebSocket/WebRTC (real-time channels) are never deferred — they are excluded by design.

## 3. Configuration

### 3.1 Channel Provider Config Schema

Add two optional fields to every non-immediate channel provider config schema:

```typescript
processingDelayMinMs: z.number()
  .int()
  .min(0)
  .default(0)
  .describe('Minimum delay in milliseconds before processing an incoming message. 0 means immediate processing.'),
processingDelayMaxMs: z.number()
  .int()
  .min(0)
  .default(0)
  .describe('Maximum delay in milliseconds before processing an incoming message. Must be >= processingDelayMinMs.'),
```

These fields are added to the existing config schemas for:
- `SmtpImapChannelProviderConfig`
- `SendGridChannelProviderConfig`
- `SesChannelProviderConfig`
- `TwilioMessagingChannelProviderConfig`
- `WhatsAppChannelProviderConfig`
- `TelegramChannelProviderConfig`

Validation: `processingDelayMaxMs >= processingDelayMinMs`. If only one is set, the other defaults to 0 (no deferral).

### 3.2 Recommended Defaults by Channel

| Channel | Min | Max | Rationale |
|---------|-----|-----|-----------|
| Email (SMTP) | 30 000 | 120 000 | 30s–2min feels natural for email |
| SMS (Twilio) | 10 000 | 45 000 | 10s–45s for SMS |
| WhatsApp | 10 000 | 45 000 | Same as SMS |
| Telegram | 5 000 | 30 000 | Faster expectations for chat apps |

These are documentation recommendations, not hardcoded defaults. Config values default to 0 (disabled).

## 4. Architecture

### 4.1 Overview

The deferral mechanism intercepts **incoming messages** at the channel host layer, before they reach `ChannelHandlerDispatcher`. Instead of dispatching immediately, the message is persisted to a **deferred processing queue** table with a computed `processAt` timestamp. A background service polls this table and dispatches messages whose `processAt` has passed, triggering the full pipeline (AI generation → tool execution → response delivery).

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
│  Persist to                  │
│  deferred_processing queue   │
│  (DB table)                  │
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
│  ChannelHandlerDispatcher    │
│  .dispatch(message, ctx)     │
│    → ConversationRunner      │
│      → AI generation         │
│      → tool execution        │
│      → response delivery     │
└──────────────────────────────┘
```

### 4.2 Flow Detail

1. **Incoming message arrives** at a channel host (e.g., `SmtpImapChannelHost.handleInboundEmail`, `TwilioMessagingChannelHost.handleWebhook`).

2. **Channel host checks deferral config**:
   - If `processingDelayMinMs == 0 && processingDelayMaxMs == 0` → dispatch immediately via `ChannelHandlerDispatcher` (current behavior).
   - Otherwise → compute `processAt = now + random(min, max)` and persist to `deferred_processing` table.

3. **Session management during deferral**:
   - A virtual session is still created and registered in `SessionManager` at arrival time (needed for inbound reply threading, session timeouts, etc.).
   - The session's inactivity timer is reset when the deferred message is eventually processed.
   - If the session times out **before** `processAt`, the deferred message is cancelled (status → `cancelled`).

4. **ProcessingDeferralService** (runs every 15 seconds via `node-cron`):
   - Queries `deferred_processing` WHERE `processAt <= NOW()` AND `status = 'pending'`.
   - For each row: resolves the session, rebuilds the `ClientMessageHandlerContext`, and calls `ChannelHandlerDispatcher.dispatch()` with the stored message.
   - Marks the row as `processed` on success, `failed` on error.
   - Failed messages are retried up to 3 times with exponential backoff (1m, 5m, 15m).

### 4.3 Why DB Queue (Not In-Memory)

- **Process restart safety**: queued messages survive server restarts. A message arriving at 3:00 with a 2-hour delay must still be processed even if the server restarts at 3:30.
- **Multi-instance support**: if multiple backend instances run, any can process the queue (with advisory locking).
- **Observability**: operators can inspect pending messages via the database or a future API endpoint.
- **Consistent with existing patterns**: `ConversationTimeoutService` and `ScenarioRunExecutorService` use DB-backed polling.

### 4.4 Why Not Defer at the Response Layer?

Deferring only the outgoing `end_ai_generation_output` message was the original approach, but it has a critical flaw: **side effects fire before the delay**. The AI pipeline runs immediately — tools execute, actions trigger, external APIs are called, payments are charged — and only the final text response is held back. This means:

- A tool sends a confirmation email to a third party, but the user hasn't received any response from the agent yet.
- A payment is processed, but the user sees no confirmation message.
- An external system is updated, creating an inconsistency between what the system has done and what the user knows.

By deferring at the **incoming** layer, the entire pipeline is delayed. Side effects only occur as part of the actual response flow, ensuring the user sees the response at the same time the system acts.

## 5. Database Schema

### 5.1 New Table: `deferred_processing`

```typescript
export const deferredProcessing = pgTable('deferred_processing', {
  id: uuid('id').defaultRandom().primaryKey(),
  sessionId: varchar('session_id', { length: 255 }).notNull(),
  providerId: uuid('provider_id').notNull().references(() => providers.id),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  conversationId: uuid('conversation_id').references(() => conversations.id),
  channelType: varchar('channel_type', { length: 50 }).notNull(),
  processAt: timestamp('process_at', { mode: 'date', timezone: true }).notNull(),
  message: jsonb('message').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  retryCount: integer('retry_count').notNull().default(0),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { mode: 'date', timezone: true }).defaultFn(now()).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', timezone: true }).defaultFn(now()).notNull(),
  processedAt: timestamp('processed_at', { mode: 'date', timezone: true }),
});
```

**Status values**: `pending` | `processed` | `failed` | `cancelled`

**Message structure** (stored as JSONB — the full CAL input message):
```json
{
  "type": "send_user_text_input",
  "conversationId": "conv_abc123",
  "text": "I'd like to order a replacement",
  "correlationId": null
}
```

### 5.2 Indexes

```sql
CREATE INDEX idx_deferred_processing_process_at_status
  ON deferred_processing (process_at, status)
  WHERE status = 'pending';

CREATE INDEX idx_deferred_processing_session_id
  ON deferred_processing (session_id)
  WHERE status = 'pending';
```

- Partial index on `(process_at, status)` for the polling query (hot path).
- Index on `session_id` for session timeout cancellation lookups.

### 5.3 Cleanup

Records with `status IN ('processed', 'failed', 'cancelled')` older than 7 days are cleaned up by `ProcessingDeferralService` during each poll cycle (batch DELETE, max 1000 rows per cycle).

## 6. Implementation Details

### 6.1 Channel Host Changes

Each non-immediate channel host replaces the immediate `dispatchTextInput` / `dispatchCommand` call with a deferral-aware wrapper. The pattern:

```typescript
// In SmtpImapChannelHost.handleInboundEmail (and equivalents):
private async dispatchOrDefer(
  sessionId: string,
  projectId: string,
  conversationId: string | undefined,
  providerId: string,
  channelType: string,
  message: CALInputMessage,
  deferralConfig: { processingDelayMinMs: number; processingDelayMaxMs: number },
): Promise<void> {
  const { processingDelayMinMs, processingDelayMaxMs } = deferralConfig;

  // No deferral configured — dispatch immediately (current behavior)
  if (processingDelayMinMs === 0 || processingDelayMaxMs === 0) {
    await this.dispatcher.dispatch(message, this.buildContext(sessionId));
    return;
  }

  // Queue for deferred processing
  const delayMs = randomBetween(processingDelayMinMs, processingDelayMaxMs);
  const processAt = new Date(Date.now() + delayMs);

  await this.deferredProcessingService.queue({
    sessionId,
    providerId,
    projectId,
    conversationId,
    channelType,
    processAt,
    message,
  });

  logger.info({
    sessionId,
    projectId,
    conversationId,
    delayMs,
    processAt,
  }, 'Incoming message queued for deferred processing');
}
```

The deferral config (`processingDelayMinMs`, `processingDelayMaxMs`) is read from the channel provider record and passed through the call chain.

### 6.2 DeferredProcessingService

```typescript
@injectable()
export class DeferredProcessingService {
  /** Queue a message for deferred processing. */
  public async queue(entry: DeferredProcessingEntry): Promise<void> {
    await db.insert(deferredProcessing).values({
      sessionId: entry.sessionId,
      providerId: entry.providerId,
      projectId: entry.projectId,
      conversationId: entry.conversationId ?? null,
      channelType: entry.channelType,
      processAt: entry.processAt,
      message: entry.message,
    });
  }

  /** Cancel pending messages for a session (e.g., on session timeout). */
  public async cancelBySessionId(sessionId: string): Promise<void> {
    await db.update(deferredProcessing)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(
        eq(deferredProcessing.sessionId, sessionId),
        eq(deferredProcessing.status, 'pending'),
      ));
  }

  /** Get a deferred message by ID (for inspection/API). */
  public async getById(id: string): Promise<DeferredProcessingRow | null> { ... }
}
```

### 6.3 ProcessingDeferralService (Background)

```typescript
@singleton()
export class ProcessingDeferralService {
  private scheduledTask: ScheduledTask | null = null;

  constructor(
    @inject(DeferredProcessingService) private readonly deferredProcessingService: DeferredProcessingService,
    @inject(SessionManager) private readonly sessionManager: SessionManager,
    @inject(ChannelHandlerDispatcher) private readonly dispatcher: ChannelHandlerDispatcher,
  ) {}

  start(): void {
    logger.info('Starting ProcessingDeferralService (polls every 15 seconds)');
    this.scheduledTask = schedule('*/15 * * * * *', () => {
      this.processQueue().catch(error =>
        logger.error({ error }, 'ProcessingDeferralService error'));
    });
  }

  stop(): void {
    this.scheduledTask?.destroy();
    logger.info('ProcessingDeferralService stopped');
  }

  private async processQueue(): Promise<void> {
    // 1. Fetch due messages
    const due = await db.select().from(deferredProcessing)
      .where(and(
        eq(deferredProcessing.status, 'pending'),
        lte(deferredProcessing.processAt, new Date()),
      ))
      .orderBy(asc(deferredProcessing.processAt))
      .limit(50);

    // 2. Process each
    for (const entry of due) {
      await this.processEntry(entry);
    }

    // 3. Cleanup old records
    await this.cleanupOldRecords();
  }

  private async processEntry(entry: DeferredProcessingRow): Promise<void> {
    // Verify session still exists
    const session = this.sessionManager.getSession(entry.sessionId);
    if (!session) {
      await db.update(deferredProcessing)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(deferredProcessing.id, entry.id));
      logger.warn({
        messageId: entry.id,
        sessionId: entry.sessionId,
      }, 'Deferred message cancelled — session expired');
      return;
    }

    // Reset session inactivity timer
    // (channel host's scheduleTimeout is called by the dispatcher flow)

    try {
      const message = entry.message as CALInputMessage;
      const context = this.buildContext(entry.sessionId);
      await this.dispatcher.dispatch(message, context);

      await db.update(deferredProcessing)
        .set({
          status: 'processed',
          processedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(deferredProcessing.id, entry.id));

      logger.info({
        messageId: entry.id,
        sessionId: entry.sessionId,
        conversationId: entry.conversationId,
      }, 'Deferred message processed');
    } catch (error) {
      await this.handleRetryOrFail(entry, error);
    }
  }

  private async handleRetryOrFail(entry: DeferredProcessingRow, error: unknown): Promise<void> {
    if (entry.retryCount < 3) {
      const backoffMs = [60_000, 300_000, 900_000][entry.retryCount]; // 1m, 5m, 15m
      const newProcessAt = new Date(Date.now() + backoffMs);
      await db.update(deferredProcessing)
        .set({
          status: 'pending',
          retryCount: entry.retryCount + 1,
          processAt: newProcessAt,
          lastError: error instanceof Error ? error.message : String(error),
          updatedAt: new Date(),
        })
        .where(eq(deferredProcessing.id, entry.id));
      logger.warn({
        messageId: entry.id,
        retryCount: entry.retryCount + 1,
        nextProcessAt: newProcessAt,
        error: error instanceof Error ? error.message : String(error),
      }, 'Deferred message retry scheduled');
    } else {
      await db.update(deferredProcessing)
        .set({
          status: 'failed',
          lastError: error instanceof Error ? error.message : String(error),
          updatedAt: new Date(),
        })
        .where(eq(deferredProcessing.id, entry.id));
      logger.error({
        messageId: entry.id,
        conversationId: entry.conversationId,
        error: error instanceof Error ? error.message : String(error),
      }, 'Deferred message permanently failed');
    }
  }

  private async cleanupOldRecords(): Promise<void> {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = await db.delete(deferredProcessing)
      .where(and(
        inArray(deferredProcessing.status, ['processed', 'failed', 'cancelled']),
        lt(deferredProcessing.updatedAt, cutoff),
      ))
      .returning({ id: deferredProcessing.id });
    if (result.length > 0) {
      logger.debug({ count: result.length }, 'Cleaned up old deferred processing records');
    }
  }

  private buildContext(sessionId: string): ClientMessageHandlerContext {
    const session = this.sessionManager.getSession(sessionId);
    return {
      session,
      send: () => { /* outbound messages flow through connection.sendMessage */ },
      sendError: (error: string) => {
        logger.warn({ sessionId, error }, 'ProcessingDeferralService dispatcher error');
      },
    };
  }
}
```

### 6.4 Registration in `src/index.ts`

```typescript
// After existing background services
container.resolve(ProcessingDeferralService).start();
```

### 6.5 Session Timeout Cancellation

When a session times out, the channel host's `scheduleTimeout` callback must also cancel pending deferred messages:

```typescript
// In SmtpImapChannelHost.scheduleTimeout (and equivalents):
private scheduleTimeout(sessionId: string, emailKey: string): void {
  const handle = setTimeout(async () => {
    logger.info({ sessionId }, 'Session timed out due to inactivity');

    // Cancel any pending deferred messages for this session
    await this.deferredProcessingService.cancelBySessionId(sessionId);

    this.emailSessionMap.delete(emailKey);
    this.sessionTimeoutMap.delete(sessionId);
    await this.sessionManager.unregisterSession(sessionId);
  }, this.timeoutMs);

  handle.unref?.();
  this.sessionTimeoutMap.set(sessionId, handle);
}
```

### 6.6 Utility: Random Delay

```typescript
/** Returns a random integer in [min, max] inclusive. */
export function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
```

## 7. Channel Host Changes (Per Channel)

Each non-immediate channel host must:

1. **Read deferral config** from the provider record (already parsed via Zod schema).
2. **Inject `DeferredProcessingService`** into the host constructor.
3. **Replace** `dispatchTextInput` / `dispatchCommand` calls with `dispatchOrDefer`.
4. **Update `scheduleTimeout`** to cancel pending deferred messages.

### 7.1 SmtpImapChannelHost

```typescript
constructor(
  // ... existing injects ...
  @inject(DeferredProcessingService) private readonly deferredProcessingService: DeferredProcessingService,
) {}

// In handleInboundEmail — replace:
//   await this.dispatchTextInput(sessionId, emailBody);
// With:
await this.dispatchOrDefer(
  sessionId,
  projectId,
  conversationId,
  providerId,
  'smtp_imap',
  { type: 'send_user_text_input', conversationId, text: emailBody },
  { processingDelayMinMs: config.processingDelayMinMs, processingDelayMaxMs: config.processingDelayMaxMs },
);
```

### 7.2 TwilioMessagingChannelHost

Same pattern — replace `dispatchTextInput` with `dispatchOrDefer` in `handleWebhook`. Inject `DeferredProcessingService`. Update `scheduleTimeout`.

### 7.3 WhatsAppChannelHost

Same pattern — replace `dispatchCommand` with `dispatchOrDefer` in `handleWebhook`. Inject `DeferredProcessingService`. Update `scheduleTimeout`.

### 7.4 Other Channels

Same pattern for `SendGridChannelHost`, `SesChannelHost`, `TelegramChannelHost`.

## 8. Edge Cases

### 8.1 Session Expires Before processAt

If the session has timed out and been unregistered by the time `processAt` arrives:
- The `ProcessingDeferralService.processEntry()` checks if the session exists.
- If not → status → `cancelled`, message is dropped.
- The conversation record remains in its current state. Acceptable — operator can inspect via audit log.
- If a new inbound message arrives from the same user, a new session is created and the new message goes through its own deferral cycle.

### 8.2 Message Coalescing

When multiple user messages arrive for the same conversation while one is already queued:
- **Coalescing**: The channel host checks for an existing `pending` entry for the same conversation. If found, the new text is **appended** to the existing entry's message text (separated by `\n\n`), and the old entry's `processAt` is **not** changed. The single queued entry fires once and delivers all accumulated texts as one `send_user_text_input`.
- **Single AI turn**: The user gets one AI response that sees all their messages in context, rather than N separate turns.
- **Ordering preserved**: Texts are appended in arrival order, so the AI sees them chronologically.
- **Session timer**: The session inactivity timer is reset on each new message **arrival** (not processing), so the session stays alive as long as the user keeps sending messages.

This applies to **`send_user_text_input` only** — the only message type subject to deferral. All other CAL message types (`start_conversation`, `go_to_stage`, `end_conversation`, `set_var`, `get_var`, etc.) are **always dispatched immediately** and never queued.

**Rationale**: Deferral only makes sense for user-generated text input. Control messages from clients (WebSocket, API calls) need predictable immediate delivery. Coalescing prevents the "10 emails = 10 AI turns" problem while keeping the implementation simple — no per-conversation queue limits or drop-and-replace logic needed.

### 8.3 Conversation Not Yet Created

For new conversations, the `conversationId` may not exist when the message is queued (the conversation is created by `start_conversation`, not beforehand). The flow:

1. Inbound message arrives → session created → `start_conversation` dispatched immediately (not deferred) → conversation created.
2. The user's text input (`send_user_text_input`) is the message that gets deferred.
3. `conversationId` is known at queue time (from step 1).

This means **`start_conversation` is never deferred** — only `send_user_text_input` (and other subsequent input messages) are deferred. The conversation is created immediately so the session is valid, but the actual user input processing is delayed.

### 8.4 Server Restart

Queued messages are persisted in the database. On restart, `ProcessingDeferralService.start()` re-registers the cron job and picks up any due messages. No data loss.

However, sessions are in-memory (SessionManager). If the server restarts:
- Sessions are lost.
- Deferred messages for lost sessions are detected as "session expired" and cancelled when `processAt` arrives.
- This is acceptable for non-immediate channels — the user won't notice a cancelled deferred message because they're not waiting in real-time.

### 8.5 Very Long Delays

There is no upper bound enforced by the system. An operator could set `processingDelayMaxMs` to 86400000 (24 hours). The message would sit in the queue until `processAt`. The 7-day cleanup only removes completed/failed/cancelled records, not pending ones.

### 8.6 Immediate Channels (WebSocket/WebRTC)

WebSocket and WebRTC channels are **never deferred**. The deferral config is only added to non-immediate channel provider schemas. Even if an operator somehow set the config, the WebSocket/WebRTC channel hosts do not use `dispatchOrDefer` — they dispatch directly.

### 8.7 Slash Commands Are Never Deferred

Control commands (`/reset`, `/stage <stageId>`, `/start`) are dispatched immediately, bypassing deferral entirely. Only plain text input (`send_user_text_input`) is subject to deferral. This ensures:
- `/reset` tears down the session immediately (not after the deferral window).
- `/stage` navigation takes effect immediately.
- `/start` creates the conversation immediately.

### 8.8 `terminateSession` Cancels Deferred Messages

When `/reset` triggers `terminateSession()` on WhatsApp or Telegram:
- `cancelBySessionId` is called before `unregisterSession`, so pending deferred messages are marked `cancelled` immediately.
- The session timer is cleared, the session is unregistered, and `end_conversation` is dispatched.
- Wrapped in try/catch so cancellation failures don't block session teardown.

### 8.9 Conversation Timeout Cancels Deferred Messages

When the `ConversationTimeoutService` aborts a conversation (project-level `conversationTimeoutSeconds`):
- The conversation is aborted, sessions are closed, and `cancelByConversationId` is called.
- Pending deferred messages are marked `cancelled` immediately.
- Wrapped in try/catch so cancellation failures don't block conversation abort.

### 8.10 Provider Config Change During Deferral Window

If deferral is enabled/disabled on a channel provider while messages are already queued:
- **Queued messages are NOT affected** — they continue to be processed by `ProcessingDeferralService` regardless of the current provider config.
- **New messages** use the current provider config at arrival time.
- Deferral is a "point-in-time" decision made when the message is queued.

### 8.11 Poll Cycle Skipping (`isProcessing` Guard)

`ProcessingDeferralService` uses an `isProcessing` flag to prevent concurrent poll cycles:
- If processing 50 entries takes longer than 15 seconds (the poll interval), the next scheduled poll is **skipped**.
- Messages due during this window are processed in the next non-skipped cycle.
- In practice, this is rare — most dispatches complete in seconds. Under heavy load or slow AI generation, this could cause additional delay beyond the configured deferral window.

### 8.12 Poll Batch Size Limit (50)

Each poll cycle fetches at most 50 due messages (`POLL_BATCH_SIZE = 50`):
- If more than 50 messages are due in a single 15-second window, only 50 are processed.
- The remaining messages wait for the next poll cycle.
- This is unlikely to be an issue in production but could matter during bulk testing or message floods.

### 8.13 Outbound Messages Are Never Deferred

Outbound-initiated conversations (`POST /api/whatsapp/send`, `POST /api/twilio/messaging/send`, `POST /api/email/smtp-imap/send`):
- The `start_conversation` is dispatched immediately.
- The AI generates and sends the opening message immediately.
- Deferral only applies to **inbound** messages (user replies).

### 8.14 Session Inactivity Timer Starts From Message Arrival

The session inactivity timer is set/reset when the message **arrives** (and is queued), not when it's processed:
- If deferral is set to 5 minutes and session timeout is 30 minutes, the session timer starts counting from arrival.
- The deferred message is processed at 5 minutes, which resets the timer.
- If the user sends another message before the 30-minute timeout, the timer resets again.
- **Edge case**: If deferral is set to 35 minutes (longer than the 30-minute session timeout), the session could expire before the deferred message is processed. The message is then cancelled.

### 8.15 Provider Deletion Cancels Deferred Messages

If a channel provider is deleted while messages are queued:
- `cancelByProviderId` is called after the provider is deleted.
- All pending deferred messages for that provider are marked `cancelled` immediately.
- Wrapped in try/catch so cancellation failures don't block provider deletion.

### 8.16 Reschedule Clamping

The REST API `reschedule` endpoint clamps `processAt` to `[now, now + 30 days]`:
- Past dates are clamped to `now` (immediate processing on next poll).
- Future dates beyond 30 days are clamped to `now + 30 days`.
- Only entries in `pending` status can be rescheduled.
- The `MAX_RESCHEDULE_DELAY_MS` constant (30 days) prevents unreasonable delays.

### 8.17 Feature Permission Check Before Deferral

The `text_input` feature permission is checked **before** the deferral decision:
- If the API key doesn't permit `text_input`, the message is dropped immediately (not queued).
- This prevents queuing messages that would be rejected anyway.
- `go_to_stage` similarly requires `stage_control` permission before dispatch.

### 8.18 SMTP/IMAP Duplicate Processing Prevention

SMTP-IMAP polls the inbox every 30 seconds with `search(['ALL'])`:
- Without deferral, the `\Seen` flag was set after the AI response was sent, creating a window where the same message could be picked up again.
- With deferral, the email is moved to the processed folder **immediately** after `handleInboundEmail` returns (before the deferral window), preventing re-picking.
- The `onEmailSent` callback is cleared after first use to prevent duplicate move attempts.
- Other channels (SendGrid, SES, Twilio, WhatsApp, Telegram) are webhook-driven and have no duplicate risk.

## 9. API Surface (Implemented)

The following endpoints are implemented for observability and manual control:

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/projects/:projectId/deferred-processing` | `PROJECT_READ` | List entries with filters (status, conversationId, channelType, pagination) |
| `GET` | `/api/projects/:projectId/deferred-processing/:id` | `PROJECT_READ` | Get single entry by ID |
| `POST` | `/api/projects/:projectId/deferred-processing/:id/reschedule` | `PROJECT_WRITE` | Change `processAt` — use past date for immediate processing (next poll cycle). Max 30-day future delay. |
| `POST` | `/api/projects/:projectId/deferred-processing/:id/cancel` | `PROJECT_WRITE` | Cancel a pending entry |

All entries are scoped to the project — cross-project access returns 404. The `reschedule` endpoint clamps `processAt` to `[now, now + 30 days]`.

## 10. Testing Strategy

### 10.1 Unit Tests

- `randomBetween` returns values within [min, max] over 10,000 iterations.
- Deferral config validation: `max < min` is rejected.
- `DeferredProcessingService.queue` persists correct fields.
- `DeferredProcessingService.cancelBySessionId` marks pending rows as `cancelled`.

### 10.2 Integration Tests

- Message with deferral config → row appears in `deferred_processing` with correct `processAt`.
- Message without deferral config → dispatched immediately, no DB row.
- `ProcessingDeferralService.processQueue` dispatches due messages and marks as `processed`.
- Session expired before `processAt` → status becomes `cancelled`, no dispatch attempted.
- Retry logic: dispatch failure → retry count increments, `processAt` pushed forward.
- After 3 retries → status becomes `failed`.
- Cleanup: old `processed`/`failed`/`cancelled` records removed after 7 days.
- Session timeout cancels pending deferred messages.

### 10.3 E2E Tests

- Full SMTP/IMAP flow with deferral: inbound email → queued → email processed after delay → response sent.
- Twilio Messaging flow with deferral: inbound SMS → queued → SMS processed after delay → response sent.
- WhatsApp flow with deferral: inbound message → queued → processed after delay → response sent.
- Zero deferral (default): immediate processing, no DB row.
- `start_conversation` is never deferred (conversation created immediately).
- Multiple messages queued → processed in `processAt` order.

## 11. Migration Plan

1. Add `processingDelayMinMs` and `processingDelayMaxMs` to all non-immediate channel provider config schemas (optional, default 0).
2. Create `deferred_processing` table via Drizzle migration.
3. Add `DeferredProcessingService` and `ProcessingDeferralService`.
4. Update all non-immediate channel hosts to use `dispatchOrDefer` instead of direct dispatch.
5. Update session timeout handlers to cancel pending deferred messages.
6. Register `ProcessingDeferralService` in `src/index.ts` alongside existing background services.
7. No breaking changes — all defaults preserve current immediate-processing behavior.

## 12. File Structure

```
src/
├── channels/
│   ├── email/
│   │   ├── smtp-imap/SmtpImapChannelHost.ts   (modified: dispatchOrDefer)
│   │   ├── sendgrid/SendGridChannelHost.ts     (modified: dispatchOrDefer)
│   │   └── ses/SesChannelHost.ts               (modified: dispatchOrDefer, if exists)
│   ├── twilio-messaging/
│   │   └── TwilioMessagingChannelHost.ts       (modified: dispatchOrDefer)
│   ├── whatsapp/
│   │   └── WhatsAppChannelHost.ts              (modified: dispatchOrDefer)
│   └── telegram/
│       └── TelegramChannelHost.ts              (modified: dispatchOrDefer)
├── services/
│   ├── DeferredProcessingService.ts            (new)
│   ├── ProcessingDeferralService.ts            (new)
│   └── providers/channel/
│       ├── SmtpImapChannelProvider.ts          (modified: config schema)
│       ├── SendGridChannelProvider.ts          (modified: config schema)
│       ├── SesChannelProvider.ts               (modified: config schema)
│       ├── TwilioMessagingChannelProvider.ts   (modified: config schema)
│       ├── WhatsAppChannelProvider.ts          (modified: config schema)
│       └── TelegramChannelProvider.ts          (modified: config schema)
├── db/
│   └── schema.ts                               (modified: deferredProcessing table)
└── index.ts                                    (modified: start ProcessingDeferralService)
```

## 13. Open Questions

1. **Should deferral apply to the first message only**, or every message? Current spec: every `send_user_text_input`. A per-conversation "first message only" flag could be added later.
2. **Should `start_conversation` ever be deferred?** Resolved: no — conversation creation is immediate, only user input is deferred. Deferring conversation creation would leave the session in a limbo state with no conversation attached.
3. **Should there be a "human-like" preset** that uses a normal distribution centered on the midpoint? Not in V1 — uniform random is simpler and sufficient.
4. **Should the deferral timer start from the incoming message timestamp or include AI generation time?** Resolved: timer starts from message arrival. Total user wait = deferral delay + AI generation time. This is the correct order — delay first, then process.
5. **Should there be a maximum queue size per conversation?** Resolved: not needed — coalescing (8.2) means only one pending entry exists per conversation regardless of message volume.
6. **Should `ConversationTimeoutService` cancel deferred messages?** Resolved: yes — `cancelByConversationId` is wired up (8.9).
7. **Should `terminateSession` cancel deferred messages?** Resolved: yes — `cancelBySessionId` is called before `unregisterSession` (8.8).
9. **Should provider deletion cancel deferred messages?** Resolved: yes — `cancelByProviderId` is called after provider deletion (8.15).
8. **Should slash commands (`/stage`, `/reset`) be deferred?** Resolved: no — control commands are dispatched immediately to ensure predictable behavior. Only plain text input is deferred.
