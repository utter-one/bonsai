---
title: "AbortAiGenerationHandler type unsoundness and null runner crash"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-29
assignee: ""
tags: [crash, type-safety, websocket]
---

# AbortAiGenerationHandler type unsoundness and null runner crash

## Description

Multiple HIGH issues in `AbortAiGenerationHandler.ts`:

1. **Line 17**: Type unsoundness — `Session` declares `runner: ConversationRunner` (non-nullable) but `registerSession()` assigns `runner: null`.
2. **Line 39**: `context.session.runner` can be `null` at runtime. Will crash with TypeError if abort message sent before runner is attached.

## Steps to Reproduce

1. Send an abort message before the runner is attached to the session
2. Observe TypeError crash

## Expected Behavior

Runner should be null-checked before use. Session type should reflect that runner can be null.

## Actual Behavior

No null guard on runner access. Runtime crash when abort is issued before runner attachment.

## Notes

File: `src/channels/handlers/AbortAiGenerationHandler.ts`
