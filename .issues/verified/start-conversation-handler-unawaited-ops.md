---
title: "StartConversationHandler unawaited operations and session crash on error"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-29
assignee: ""
tags: [crash, data-integrity, websocket]
---

# StartConversationHandler unawaited operations and session crash on error

## Description

Multiple HIGH issues in `StartConversationHandler.ts`:

1. **Line 137-139**: Uses `context.session!` inside outer catch block. If session destroyed during error, will crash.
2. **Line 62, 143**: `detachConversationFromSession()` not awaited. May not complete before handler returns.
3. **Lines 128-129/130**: `context.send()` inside try block. If send fails, catch marks conversation as failed.
4. **Lines 56-57/58**: Same issue in outgoing call path. Send failure detaches conversation.

## Steps to Reproduce

1. Start a conversation where `context.send()` throws
2. Observe conversation marked as failed due to send error, not actual failure

## Expected Behavior

Send failures should not trigger conversation failure. Detach should be awaited.

## Actual Behavior

Send failures cascade into conversation failure. Unawaited detach may not complete.

## Notes

File: `src/channels/handlers/StartConversationHandler.ts`
