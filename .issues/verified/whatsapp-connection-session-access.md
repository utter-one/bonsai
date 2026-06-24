---
title: "WhatsAppConnection unguarded session access and silent fetch failures"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-29
assignee: ""
tags: [crash, error-handling, whatsapp]
---

# WhatsAppConnection unguarded session access and silent fetch failures

## Description

Multiple HIGH issues in `WhatsAppConnection.ts`:

1. **Line 48**: `this.session.id` accessed without guard — throws TypeError if `attachSession()` never called.
2. **Line 88-90**: Errors from `fetch` silently swallowed. Caller has no way to know message delivery failed.

## Steps to Reproduce

1. Call sendMessage before attachSession
2. Observe TypeError crash

## Expected Behavior

Session should be guarded. Fetch errors should be propagated.

## Actual Behavior

Uncaught TypeError. Silent fetch failures.

## Notes

File: `src/channels/whatsapp/WhatsAppConnection.ts`
