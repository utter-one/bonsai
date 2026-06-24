---
title: "IssueService missing context and permission checks"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-30
assignee: ""
tags: [security]
---

# IssueService missing context and permission checks

## Description

Multiple HIGH issues in `IssueService.ts`:

1. **Line 240**: `getIssueAuditLogs` missing `context` and permission check.
2. **Line 60**: `getIssueById` missing `context` and permission check. Defense-in-depth violation.
3. **Line 83**: `listIssues` missing `context` and permission check.

## Steps to Reproduce

1. Call getIssueById without proper permissions
2. Observe no permission enforcement

## Expected Behavior

Context and permission checks on all operations.

## Actual Behavior

Missing context and permissions on read and audit operations.

## Notes

File: `src/services/IssueService.ts`
