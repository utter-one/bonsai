---
title: "Twilio Voice webhook signature validation silently bypassed"
severity: critical
status: open
created: 2026-05-29
updated: 2026-05-31
assignee: ""
tags: [security, webhook, twilio]
---

# Twilio Voice webhook signature validation silently bypassed

## Description

Twilio request signature validation failure is silently ignored at line 259-262 of `TwilioVoiceChannelHost.ts`. Any unsigned request proceeds as if valid, exposing the webhook to unauthorized access. Additionally, request signature validation is disabled entirely (lines 258-263), leaving the webhook unauthenticated.

## Steps to Reproduce

1. Send an unsigned HTTP request to the Twilio Voice webhook endpoint
2. Request proceeds without signature verification

## Expected Behavior

Unsigned or invalid requests should be rejected with a 403 response.

## Actual Behavior

Validation failure is silently ignored; unsigned requests are processed normally.

## Notes

File: `src/channels/twilio-voice/TwilioVoiceChannelHost.ts`
Related HIGH issues in same file: `req.body` cast bypass (line 257), invalid Twilio track value (line 301), raw API key in TwiML Parameter (lines 302-307).

## Verification

Re-opened 2026-05-31: Issue persists. At TwilioVoiceChannelHost.ts:260-264, signature validation runs but the 403 rejection is commented out. Invalid or unsigned requests log a warning but continue processing.
