---
title: "ClassifierService missing permission checks and extra DB queries"
severity: high
status: closed
created: 2026-05-29
updated: 2026-06-01
assignee: ""
tags: [security, performance]
---

# ClassifierService missing permission checks and extra DB queries

## Description

Multiple HIGH issues in `ClassifierService.ts`:

1. **Lines 63/279**: `getClassifierById` and `getClassifierAuditLogs` have no permission checks.
2. **Lines 73/140**: Separate `isProjectActive()` query adds extra round-trip per read.

## Steps to Reproduce

1. Call getClassifierById without proper permissions
2. Observe no permission enforcement

## Expected Behavior

Permission checks on all read operations. Combined queries for active status.

## Actual Behavior

Missing permission checks. Extra DB round-trips.

## Notes

File: `src/services/ClassifierService.ts`

## Verification

Re-opened 2026-05-31: None of the reported issues are fixed. `getClassifierById` (line 63) and `getClassifierAuditLogs` (line 279) still lack `context` parameter and `requirePermission()` calls. `isProjectActive()` extra DB query still present at lines 73 and 140.
