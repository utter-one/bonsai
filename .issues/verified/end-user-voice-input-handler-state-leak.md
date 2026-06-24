---
title: "EndUserVoiceInputHandler leaks internal state to client"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-29
assignee: ""
tags: [security, information-disclosure, websocket]
---

# EndUserVoiceInputHandler leaks internal state to client

## Description

`EndUserVoiceInputHandler.ts` line 42: Error messages leak internal state to client. Runner exposes conversation status and inputTurnId values in error responses.

## Steps to Reproduce

1. Trigger an error during end user voice input
2. Observe internal state values in error response

## Expected Behavior

Error messages should not expose internal implementation details.

## Actual Behavior

Conversation status and inputTurnId values are sent to the client in error messages.

## Notes

File: `src/channels/handlers/EndUserVoiceInputHandler.ts`
