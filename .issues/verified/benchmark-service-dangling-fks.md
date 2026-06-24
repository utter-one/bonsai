---
title: "BenchmarkService dangling FKs and orphaned configs"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-31
assignee: ""
tags: [data-integrity, resource-leak]
---

# BenchmarkService dangling FKs and orphaned configs

## Description

Multiple HIGH issues in `BenchmarkService.ts`:

1. **Line 234-243**: `createConfig` doesn't validate `providerConfigId`. Dangling FK.
2. **Line 87-95**: `deleteSuite` doesn't delete/check `benchmarkConfigs`. Orphaned configs.
3. **Line 93-94**: Delete before `refreshSuiteSchedule`. Cron race.

## Steps to Reproduce

1. Create a benchmark config with invalid providerConfigId
2. Observe dangling foreign key

## Expected Behavior

FK validation. Cascade deletes. Proper operation ordering.

## Actual Behavior

Dangling FKs. Orphaned configs. Cron race on delete.

## Notes

File: `src/services/BenchmarkService.ts`

## Resolution

1. **Line 234-243 — `createConfig` dangling FK**: Added `getProviderConfigOrThrow(input.providerConfigId)` before the insert, so a missing provider config throws a proper `NotFoundError` instead of a raw DB constraint error. Also added the same validation in `updateConfig` when `providerConfigId` is changed.
2. **Line 87-95 — `deleteSuite` orphaned configs**: Added a check for existing configs before deleting the suite. If any configs exist, a `ConflictError` is raised requiring the user to delete them first. This prevents silent cascade deletes that could lose benchmark data.
3. **Line 93-94 — Cron race on delete**: Moved `refreshSuiteSchedule` (cron cancellation) before the DB delete. This ensures the cron job is cancelled before the suite row is removed, preventing a race where the cron fires and tries to create a run for a non-existent suite.
