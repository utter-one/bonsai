---
title: "SendUserTextInputHandler raw error message sent to client"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-29
assignee: ""
tags: [security, information-disclosure, websocket]
---

# SendUserTextInputHandler raw error message sent to client

## Description

`SendUserTextInputHandler.ts` line 63: Raw internal `error.message` sent directly to client. Can leak implementation details.

## Steps to Reproduce

1. Trigger an error during user text input
2. Observe raw error message in response

## Expected Behavior

Error messages should be sanitized before sending to client.

## Actual Behavior

Raw internal error message sent directly to client.

## Notes

File: `src/channels/handlers/SendUserTextInputHandler.ts`
