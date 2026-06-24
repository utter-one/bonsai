---
title: "TwilioMessagingChannelHost NaN timeout and race conditions"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-29
assignee: ""
tags: [crash, race-condition, twilio]
---

# TwilioMessagingChannelHost NaN timeout and race conditions

## Description

Multiple HIGH issues in `TwilioMessagingChannelHost.ts`:

1. **Line 65**: `parseInt` on `TWILIO_MESSAGING_SESSION_TIMEOUT_MS` can produce `NaN`. All sessions time out instantly.
2. **Lines 231-235**: Race condition — `dispatch(startMsg)` async but `dispatchTextInput` runs immediately after. First message silently dropped.
3. **Lines 254-348**: `handleOutgoingMessage` has no rate limiting. Unlimited outgoing messages possible.

## Steps to Reproduce

1. Set TWILIO_MESSAGING_SESSION_TIMEOUT_MS to a non-numeric value
2. Observe all sessions timing out immediately

## Expected Behavior

Timeout should be validated. Message dispatch should be sequential. Rate limiting on outgoing messages.

## Actual Behavior

NaN timeout. Race condition drops messages. No rate limiting.

## Notes

File: `src/channels/twilio-messaging/TwilioMessagingChannelHost.ts`
