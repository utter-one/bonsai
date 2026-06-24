---
title: "AuthHandler swallows errors and violates type contracts"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-29
assignee: ""
tags: [security, error-handling, websocket]
---

# AuthHandler swallows errors and violates type contracts

## Description

Multiple HIGH issues in `AuthHandler.ts`:

1. **Line 102-106**: Catch block swallows all errors and returns misleading "Invalid API key". Project-not-found or infrastructure errors should not be reported as auth failure.
2. **Line 88**: `message.sessionSettings` is optional but `setSessionProjectAndSettings` requires it. `undefined` passed, violating type contract.

## Steps to Reproduce

1. Trigger a database error during auth flow
2. Observe "Invalid API key" response instead of actual error

## Expected Behavior

Different error types should produce distinct responses. Required parameters should not receive undefined.

## Actual Behavior

All errors collapse into "Invalid API key". Required parameters may receive undefined.

## Notes

File: `src/channels/handlers/AuthHandler.ts`
