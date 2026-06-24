---
title: "EndConversationHandler null session access and data corruption"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-29
assignee: ""
tags: [crash, data-integrity, websocket]
---

# EndConversationHandler null session access and data corruption

## Description

Multiple HIGH issues in `EndConversationHandler.ts`:

1. **Line 11**: No validation that `message.conversationId` matches session's active conversation — client could end arbitrary conversation.
2. **Line 27, 30-33**: No guard for `context.session` being null. Proceeds with empty strings.
3. **Line 31-33**: No guard when `session` is null — `stageId` and `projectId` become empty strings, producing DB records with invalid data.
4. **Line 41**: `reason: ''` hardcoded. Should use reason from request if available.
5. **Line 46-47**: `detachConversationFromSession` runs before `finishConversation` — if finish throws, session detached but conversation unfinished with no rollback.

## Steps to Reproduce

1. End a conversation with a different conversationId than the session's active one
2. Observe no validation, arbitrary conversation ended

## Expected Behavior

Conversation ID should be validated against session. Null guards on session access. Atomic detach/finish operations.

## Actual Behavior

No conversation ID validation. Empty strings produce invalid DB records. Non-atomic operations leave inconsistent state.

## Notes

File: `src/channels/handlers/EndConversationHandler.ts`
