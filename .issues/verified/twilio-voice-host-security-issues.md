---
title: "TwilioVoiceChannelHost security vulnerabilities and API key exposure"
severity: high
status: closed
created: 2026-05-29
updated: 2026-05-29
assignee: ""
tags: [security, twilio]
---

# TwilioVoiceChannelHost security vulnerabilities and API key exposure

## Description

Multiple HIGH issues in `TwilioVoiceChannelHost.ts`:

1. **Line 257**: `req.body` cast to `Record<string, string>` but Twilio sends form-encoded. `req.body` may be unparsed, causing silent validation bypass.
2. **Line 301**: `track: 'inbound_track'` not valid Twilio track value. Defaults to bidirectional, sending outbound audio unnecessarily.
3. **Line 302-307**: Raw API key transmitted as TwiML `<Parameter>` — exposed to Twilio infrastructure and logs.

## Steps to Reproduce

1. Send a Twilio voice request and inspect the TwiML response
2. Observe API key in TwiML Parameter tag

## Expected Behavior

API key should not be transmitted in TwiML. Valid track values. Proper body parsing.

## Actual Behavior

API key exposed. Invalid track value. Body parsing issues.

## Notes

File: `src/channels/twilio-voice/TwilioVoiceChannelHost.ts`
