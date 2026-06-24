---
title: "TwilioMessagingConnection unguarded session access and client recreation"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-29
assignee: ""
tags: [crash, performance, twilio]
---

# TwilioMessagingConnection unguarded session access and client recreation

## Description

Multiple HIGH issues in `TwilioMessagingConnection.ts`:

1. **Line 48**: `this.session.id` accessed without guard — throws TypeError if `attachSession()` never called.
2. **Line 65**: Creates new `TwilioClient` on every `sendMessage` call. Should be reused.

## Steps to Reproduce

1. Call sendMessage before attachSession
2. Observe TypeError crash

## Expected Behavior

Session should be guarded. TwilioClient should be reused.

## Actual Behavior

Uncaught TypeError on unguarded access. New client per message wastes resources.

## Notes

File: `src/channels/twilio-messaging/TwilioMessagingConnection.ts`
