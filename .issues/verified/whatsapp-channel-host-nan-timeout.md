---
title: "WhatsAppChannelHost NaN timeout and unhandled async rejection"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-29
assignee: ""
tags: [crash, whatsapp]
---

# WhatsAppChannelHost NaN timeout and unhandled async rejection

## Description

Multiple HIGH issues in `WhatsAppChannelHost.ts`:

1. **Line 570-574**: `setTimeout` callback async but promise unhandled. Unhandled rejection can crash process.
2. **Line 93**: `parseInt()` can return `NaN` if env var non-numeric. All sessions time out instantly.

## Steps to Reproduce

1. Set WHATSAPP_SESSION_TIMEOUT_MS to a non-numeric value
2. Observe all sessions timing out immediately

## Expected Behavior

Timeout should be validated. Async setTimeout callbacks should be handled.

## Actual Behavior

NaN timeout. Unhandled promise rejections.

## Notes

File: `src/channels/whatsapp/WhatsAppChannelHost.ts`
