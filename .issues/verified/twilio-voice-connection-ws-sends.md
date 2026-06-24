---
title: "TwilioVoiceConnection unguarded WebSocket sends and uninitialized session"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-29
assignee: ""
tags: [crash, twilio]
---

# TwilioVoiceConnection unguarded WebSocket sends and uninitialized session

## Description

Multiple HIGH issues in `TwilioVoiceConnection.ts`:

1. **Line 151/157/167/176**: `this.ws.send()` calls without checking `ws.readyState`. Throws if WebSocket closed.
2. **Line 30**: `session` typed as non-optional but never initialized. Every `this.session?.id` is workaround for incorrect type.
3. **Line 99**: Twilio module resolution via `as any` fallbacks fragile and untyped.

## Steps to Reproduce

1. Call ws.send() after WebSocket is closed
2. Observe uncaught exception

## Expected Behavior

WebSocket readyState should be checked before send. Session type should reflect initialization state.

## Actual Behavior

Uncaught exceptions on closed sockets. Incorrect type annotations.

## Notes

File: `src/channels/twilio-voice/TwilioVoiceConnection.ts`
