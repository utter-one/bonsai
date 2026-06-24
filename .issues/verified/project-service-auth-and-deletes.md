---
title: "ProjectService missing auth checks and N+1 deletes"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-30
assignee: ""
tags: [security, performance]
---

# ProjectService missing auth checks and N+1 deletes

## Description

Multiple HIGH issues in `ProjectService.ts`:

1. **Line 176**: `updateData` writes fields without falling back to existing values. `undefined` overwrites with NULL.
2. **Lines 212-325**: `deleteProject` fetches all records into memory, deletes one-by-one. N DELETE queries.
3. **Lines 69/91/431**: `getProjectById`, `listProjects`, `getProjectAuditLogs` have no auth checks.

## Steps to Reproduce

1. Call getProjectById without proper permissions
2. Observe no permission enforcement

## Expected Behavior

Auth checks on all operations. Batch deletes. Partial updates.

## Actual Behavior

Missing auth. N+1 deletes. NULL overwrites.

## Notes

File: `src/services/ProjectService.ts`
