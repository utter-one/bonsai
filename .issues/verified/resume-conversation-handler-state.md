---
title: "ResumeConversationHandler inconsistent state and premature response"
severity: high
status: closed
created: 2026-05-29
updated: 2026-06-01
assignee: ""
tags: [data-integrity, websocket]
---

# ResumeConversationHandler inconsistent state and premature response

## Description

Multiple HIGH issues in `ResumeConversationHandler.ts`:

1. **Line 48-50**: Error message says "archived project" but checks `conversation.archived`. Should say "archived conversation".
2. **Line 52**: If `attachConversationToSession` throws, no response sent. Session left in inconsistent state.
3. **Line 55-56**: Success response sent BEFORE `resumeConversation()` called. Client told success before operation.
4. **Line 60**: No null guard on `context.session.runner` before calling `resumeConversation()`. Crashes if runner not initialized.

## Steps to Reproduce

1. Resume a conversation where the runner is not initialized
2. Observe TypeError crash

## Expected Behavior

Response should only be sent after successful operation. Null guards on runner access.

## Actual Behavior

Premature success response. No null guard on runner. Inconsistent state on errors.

## Notes

File: `src/channels/handlers/ResumeConversationHandler.ts`

## Verification

Re-opened 2026-05-31: 3 of 4 issues remain. Issue 1: error message still says 'archived project' for archived conversation. Issue 2: `attachConversationToSession` has no try/catch. Issue 4: no null guard on `context.session.runner` before `resumeConversation()`.
