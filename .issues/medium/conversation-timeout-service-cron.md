---
title: "ConversationTimeoutService multiple issues: shutdown, concurrency, and stale timestamps"
severity: medium
status: open
created: 2026-05-29
updated: 2026-05-31
assignee: ""
tags: [resource-leak, data-integrity, race-condition]
---

# ConversationTimeoutService multiple issues: shutdown, concurrency, and stale timestamps

## Description

Multiple issues in `ConversationTimeoutService.ts`:

### High (FIXED)

1. **Line 33**: `node-cron` schedule handle never stored. No way to stop the in-process timer on shutdown. Keeps the Node.js process alive.
2. **Line 74-76**: No concurrency guard. If `processTimeouts` takes longer than 60s, a second invocation starts, causing duplicate aborts, duplicate events, and redundant WebSocket messages.

### Medium

3. **Line 85**: `saveConversationEvent` always updates `lastActivityAt` to `now()`. Saving the `conversation_aborted` event resets the activity timestamp on an aborted conversation, making it appear recently active.
4. **Line 74-76**: Conversations processed sequentially in a `for` loop. With many timed-out conversations, this blocks the timer and increases risk of overlap with the next invocation.

### Low

5. **Line 48 vs 85**: Race condition — the query filters `isNull(projects.archivedAt)`, but `saveConversationEvent` calls `requireProjectNotArchived`. If the project is archived between the query and the event save, a partial abort occurs (status updated + clients notified, but event save fails).

## Steps to Reproduce

1. For #1: Send SIGTERM and observe the timer keeps the process alive.
2. For #2: Seed many timed-out conversations and observe duplicate events on overlapping runs.
3. For #3: Abort a conversation and observe `lastActivityAt` is set to the abort time.

## Expected Behavior

- Timer stops on shutdown.
- Concurrency guard prevents overlapping execution.
- Aborted conversations retain their original `lastActivityAt`.
- Conversations processed in parallel for efficiency.

## Actual Behavior

- No shutdown hook, no concurrency guard, sequential processing, stale timestamp reset.

## False Positives (Investigated, Not Issues)

- ~~`abortConversation` swallows errors~~ — it rethrows on line 470 of `ConversationService.ts`.
- ~~Event saved unconditionally after abort~~ — since `abortConversation` rethrows, the existing catch block already gates event/notification.

## Notes

File: `src/services/ConversationTimeoutService.ts`

## Verification

Re-opened 2026-05-31: Issues #1 (cron handle) and #2 (concurrency guard) are fixed. Issues #3 (lastActivityAt reset on aborted conversations), #4 (sequential for loop), and #5 (race condition with requireProjectNotArchived) remain unresolved.
