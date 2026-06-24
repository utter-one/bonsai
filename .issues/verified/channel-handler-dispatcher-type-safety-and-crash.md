---
title: "ChannelHandlerDispatcher startup crash and type safety bypasses"
severity: high
status: closed
created: 2026-05-29
updated: 2026-06-01
assignee: ""
tags: [crash, type-safety, websocket]
---

# ChannelHandlerDispatcher startup crash and type safety bypasses

## Description

Multiple HIGH issues in `ChannelHandlerDispatcher.ts`:

1. **Line 33-42**: `registerHandlers()` runs in the constructor with no try/catch. If any `handlerFactory()` throws, the entire application crashes at startup.
2. **Line 88**: `message as any` cast discards all type safety. Should use Zod `.infer` types or generics.
3. **Line 92**: `context.sendError()` missing `message.correlationId`. Client cannot correlate error to request.

## Steps to Reproduce

1. Introduce a handler factory that throws during registration
2. Observe application crash at startup

## Expected Behavior

Handler registration failures should be caught and reported without crashing the application. Type safety should be maintained through message dispatch.

## Actual Behavior

Startup crash on handler factory failure. Type safety bypassed via `as any` cast. Missing correlation ID breaks request tracing.

## Notes

File: `src/channels/ChannelHandlerDispatcher.ts`

## Verification

Re-opened 2026-05-31: Issue 1 (startup crash) is resolved, but issue 2 (`message as any` at line 92) and issue 3 (missing `correlationId` in catch-block `sendError` at line 96) remain unresolved.
