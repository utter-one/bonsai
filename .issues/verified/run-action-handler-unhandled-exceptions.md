---
title: "RunActionHandler unhandled exceptions and conflicting responses"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-29
assignee: ""
tags: [crash, error-handling, websocket]
---

# RunActionHandler unhandled exceptions and conflicting responses

## Description

Multiple HIGH issues in `RunActionHandler.ts`:

1. **Line 46**: `executePendingTerminalAction()` can throw after success response sent. Client gets conflicting responses.
2. **Line 46**: `executePendingTerminalAction()` outside try-catch — if it throws, error is unhandled and client in inconsistent state.
3. **Line 52**: `context.send()` throws in catch block. Exception propagates unhandled.

## Steps to Reproduce

1. Run an action where `executePendingTerminalAction()` throws after success response
2. Observe conflicting client state

## Expected Behavior

Terminal action execution should be wrapped in try-catch. No operations after response send.

## Actual Behavior

Unhandled exceptions after response. Client receives conflicting state.

## Notes

File: `src/channels/handlers/RunActionHandler.ts`
