---
title: "AuditService missing RequestContext and crash on empty results"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-31
assignee: ""
tags: [security, crash, audit]
---

# AuditService missing RequestContext and crash on empty results

## Description

Multiple HIGH issues in `AuditService.ts`:

1. **Line 56**: `auditLog[0]` crashes if `.returning()` returns empty array. FIXED: added length guard with error throw.
2. **Lines 33/80/108/138**: No `RequestContext` parameter. FALSE POSITIVE: AuditService is a low-level logging utility called exclusively by other services that already enforce permissions via RequestContext. All callers pass `context.operatorId` as `userId`. Adding RequestContext would be redundant — the audit service is a system-level mechanism, not a REST-exposed endpoint.

## Steps to Reproduce

1. Call audit method where `.returning()` returns empty array
2. Observe crash on array index access

## Expected Behavior

Array access should be guarded. All service methods should accept RequestContext.

## Actual Behavior

Crash on empty results. Missing context bypasses security pattern.

## Notes

File: `src/services/AuditService.ts`
