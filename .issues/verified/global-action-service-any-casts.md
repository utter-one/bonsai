---
title: "GlobalActionService any casts and missing permissions"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-29
assignee: ""
tags: [type-safety, security]
---

# GlobalActionService any casts and missing permissions

## Description

Multiple HIGH issues in `GlobalActionService.ts`:

1. **Line 178**: `updatePayload` typed as `any`.
2. **Line 269**: Three `as any` casts bypass type safety. Type mismatch should be resolved.
3. **Line 282**: `getGlobalActionAuditLogs` returns `any[]`.

## Steps to Reproduce

1. Inspect update payload type at compile time
2. Observe `any` type, no type safety

## Expected Behavior

Typed update payloads. Proper return types for audit logs.

## Actual Behavior

`any` casts bypass type checking. Untyped audit log returns.

## Notes

File: `src/services/GlobalActionService.ts`
