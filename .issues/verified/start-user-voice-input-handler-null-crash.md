---
title: "StartUserVoiceInputHandler null access crashes and double response"
severity: high
status: closed
created: 2026-05-29
updated: 2026-06-01
assignee: ""
tags: [crash, error-handling, websocket]
---

# StartUserVoiceInputHandler null access crashes and double response

## Description

Multiple HIGH issues in `StartUserVoiceInputHandler.ts`:

1. **Line 30**: `context.session.sessionSettings` accessed without null check — throws unhandled TypeError.
2. **Line 42**: `context.session.runner` accessed without null check — same crash risk.
3. **Line 51-64**: If `context.send()` throws, catch sends second error response. Double response risk.
4. **Line 54-64**: Catch block swallows ALL errors, including unexpected runtime errors. Internal failures silently returned as `success: false`.

## Steps to Reproduce

1. Start user voice input without session settings
2. Observe TypeError crash

## Expected Behavior

Null checks on session settings and runner. No double responses on send failure.

## Actual Behavior

Uncaught TypeErrors on null access. Double error responses on send failure.

## Notes

File: `src/channels/handlers/StartUserVoiceInputHandler.ts`

## Verification

Re-opened 2026-05-31: Issues #1 and #2 (null checks) are fixed, but issues #3 and #4 remain: double response if `context.send()` at line 55 throws, and the catch block still swallows all errors including unexpected runtime errors from `runner.startUserVoiceInput()`.
