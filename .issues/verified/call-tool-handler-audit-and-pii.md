---
title: "CallToolHandler audit log persistence before execution and PII leakage"
severity: high
status: closed
created: 2026-05-29
updated: 2026-06-01
assignee: ""
tags: [security, audit-log, websocket]
---

# CallToolHandler audit log persistence before execution and PII leakage

## Description

Multiple HIGH issues in `CallToolHandler.ts`:

1. **Line 38-39**: `saveCommandEvent` runs before `callTool`. If save succeeds but callTool fails, event is persisted as issued though tool never executed.
2. **Line 38**: `message.parameters` logged in full to `saveCommandEvent`. May contain credentials/PII persisted without redaction.
3. **Line 39**: `runner.callTool()` returns `Promise<any>`. Handler assigns entire result as `result`, bypassing type safety.
4. **Line 51-62**: Catch block swallows `NotFoundError` and `InvalidOperationError`, converting them to generic `success: false` response.

## Steps to Reproduce

1. Call a tool with sensitive parameters
2. Observe parameters persisted in plaintext in audit log

## Expected Behavior

Audit events should only persist after successful execution. Sensitive parameters should be redacted. Typed return values.

## Actual Behavior

Parameters persisted before execution. No redaction. Untyped return values.

## Notes

File: `src/channels/handlers/CallToolHandler.ts`

## Verification

Re-opened 2026-05-31: All 4 issues persist: (1) `saveCommandEvent` runs before `callTool`, (2) `message.parameters` passed without redaction, (3) no type narrowing on `callTool` result, (4) catch block converts all errors to generic `success: false` response.

Re-evaluated 2026-06-01: Issue 1 (audit before execution) is FIXED — `callTool` now runs before `saveCommandEvent` (lines 38-39). Issues 2-4 remain NOT_FIXED: (2) `message.parameters` still passed without redaction (line 39), (3) no type narrowing on `callTool` result (returns `Promise<any>`, assigned directly to response), (4) catch block still converts all errors to generic `success: false` response (lines 51-62).
