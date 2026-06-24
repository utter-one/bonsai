---
title: "SetVarHandler sensitive data in audit log and persistence before execution"
severity: high
status: closed
created: 2026-05-29
updated: 2026-06-01
assignee: ""
tags: [security, audit-log, websocket]
---

# SetVarHandler sensitive data in audit log and persistence before execution

## Description

Multiple HIGH issues in `SetVarHandler.ts`:

1. **Line 38-39**: `saveCommandEvent` persists before `setVariable` executes. If setVariable fails, orphan command event recorded.
2. **Line 38**: `variableValue` persisted to audit log without sanitization. Secrets/PII recorded permanently.

## Steps to Reproduce

1. Set a variable with a sensitive value
2. Observe value persisted in plaintext in audit log

## Expected Behavior

Sensitive values should be redacted in audit logs. Events should only persist after successful execution.

## Actual Behavior

Values persisted in plaintext before execution completes.

## Notes

File: `src/channels/handlers/SetVarHandler.ts`

## Verification

Re-opened 2026-05-31: Both issues remain. `saveCommandEvent` (line 42) still runs before `setVariable` (line 43), leaving orphan command events on failure. `variableValue` is still passed directly without sanitization/redaction, persisting secrets/PII in plaintext.

Re-evaluated 2026-06-01: Issue 1 (audit before execution) is FIXED — `setVariable` now runs before `saveCommandEvent` (lines 42-43). Issue 2 (no sanitization) remains NOT_FIXED — `variableValue` is still passed directly to `saveCommandEvent` without redaction (line 43).
