---
title: "TwilioMessagingCommunicationChannel empty config schema"
severity: high
status: closed
created: 2026-05-29
updated: 2026-06-01
assignee: ""
tags: [validation, twilio]
---

# TwilioMessagingCommunicationChannel empty config schema

## Description

`TwilioMessagingCommunicationChannel.ts` line 26: `getConfigSchema()` returns empty schema instead of provider config schema. Required fields are never validated.

## Steps to Reproduce

1. Configure Twilio messaging channel with missing required fields
2. Observe no validation errors

## Expected Behavior

Config schema should validate required provider fields.

## Actual Behavior

Empty schema accepts any configuration without validation.

## Notes

File: `src/channels/twilio-messaging/TwilioMessagingCommunicationChannel.ts`

## Verification

Re-opened 2026-05-31: Issue persists. Line 26 still returns `z.object({})`. The proper schema `twilioMessagingChannelProviderConfigSchema` exists in the provider but is never imported or used.
