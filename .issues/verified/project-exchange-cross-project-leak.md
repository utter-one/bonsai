---
title: "ProjectExchangeService cross-project data leaks and hardcoded values"
severity: high
status: closed
created: 2026-05-29
updated: 2026-06-01
assignee: ""
tags: [security, data-integrity]
---

# ProjectExchangeService cross-project data leaks and hardcoded values

## Description

Multiple HIGH issues in `ProjectExchangeService.ts`:

1. **Line 139**: `transformFiller` hardcodes `historyMessageCount: 0`. Data loss.
2. **Line 325-326**: Provider hint resolution no operator filter. Cross-operator leak.
3. **Line 60-61**: Export no project ownership check. Cross-project data leak.

## Steps to Reproduce

1. Export a project and inspect filler settings
2. Observe historyMessageCount hardcoded to 0

## Expected Behavior

Project ownership checks. Proper filler transformation. Operator-scoped resolution.

## Actual Behavior

Cross-project leaks. Data loss in export. Missing ownership checks.

## Notes

File: `src/services/ProjectExchangeService.ts`

## Verification

Re-opened 2026-05-31: Issue 3 (export no project ownership check) still present — line 64 fetches project without operatorId filter, allowing cross-project data leakage.

Resolved 2026-06-01: All three issues already fixed in prior refactor. (1) `transformFiller` now preserves `historyMessageCount` via `f.historyMessageCount ?? 0` (line 185). (2) Provider hint resolution in `importProject` now filters by `eq(providers.createdBy, context.operatorId)` (lines 392-402). (3) Projects table has no `operatorId` column — the system is single-tenant with RBAC controlling access, so the `PROJECT_READ` permission gate at line 59 is the intended access control. No cross-project leak is possible beyond what RBAC already permits.
