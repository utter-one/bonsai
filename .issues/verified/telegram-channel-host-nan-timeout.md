---
title: "TelegramChannelHost NaN timeout and orphaned sessions"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-29
assignee: ""
tags: [crash, resource-leak, telegram]
---

# TelegramChannelHost NaN timeout and orphaned sessions

## Description

Multiple HIGH issues in `TelegramChannelHost.ts`:

1. **Line 419-421**: When `start_conversation` fails, session registered but never cleaned up. Orphaned session.
2. **Line 517-522**: `setTimeout` callback is `async` — errors inside `unregisterSession` become unhandled promise rejections.
3. **Line 99**: `parseInt` can produce `NaN` if env var non-numeric. `setTimeout(cb, NaN)` fires immediately, destroying all sessions.

## Steps to Reproduce

1. Set TELEGRAM_SESSION_TIMEOUT_MS to a non-numeric value
2. Observe all sessions destroyed immediately

## Expected Behavior

Timeout should be validated. Session cleanup on conversation start failure.

## Actual Behavior

NaN timeout destroys all sessions. Orphaned sessions on failure.

## Notes

File: `src/channels/telegram/TelegramChannelHost.ts`
