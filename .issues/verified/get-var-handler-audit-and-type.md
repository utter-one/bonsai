---
title: "GetVarHandler audit log before execution and type inconsistency"
severity: high
status: closed
created: 2026-05-29
updated: 2026-06-01
assignee: ""
tags: [audit-log, websocket]
---

# GetVarHandler audit log before execution and type inconsistency

## Description

Multiple HIGH issues in `GetVarHandler.ts`:

1. **Line 38-39**: If `saveCommandEvent` succeeds but `getVariable` fails, command event is persisted though operation didn't complete.
2. **Line 41**: Response `type` is `'get_var'`, inconsistent with siblings using `*_result` for responses.

## Steps to Reproduce

1. Get a variable where `saveCommandEvent` succeeds but `getVariable` fails
2. Observe command event persisted despite operation failure

## Expected Behavior

Audit events should only persist after successful execution. Response type naming should be consistent.

## Actual Behavior

Command event persisted before execution completes. Inconsistent response type naming.

## Notes

File: `src/channels/handlers/GetVarHandler.ts`

## Verification

Re-opened 2026-05-31: Issue 1 (audit before execution) still unresolved - `saveCommandEvent` at line 42 runs before `getVariable` at line 43, persisting orphan command events on failure. Issue 2 (response type naming) is actually a false positive - naming is consistent across all sibling handlers.
