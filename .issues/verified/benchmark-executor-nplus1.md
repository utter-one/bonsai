---
title: "BenchmarkExecutorService N+1 queries and race conditions"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-31
assignee: ""
tags: [performance, race-condition]
---

# BenchmarkExecutorService N+1 queries and race conditions

## Description

Multiple HIGH issues in `BenchmarkExecutorService.ts`:

1. **Line 116**: No `orderBy` on pending run selection. Race condition across processes.
2. **Line 124**: No `orderBy` on config selection. Non-deterministic order.
3. **Line 147-151**: N+1 query. 2 queries per config. Should batch.

## Steps to Reproduce

1. Run benchmark with multiple configs
2. Observe N+1 query pattern

## Expected Behavior

Deterministic ordering. Batched queries.

## Actual Behavior

Race conditions. N+1 queries.

## Notes

File: `src/services/BenchmarkExecutorService.ts`

## Resolution

1. **Line 116 — Race condition**: Added `orderBy(asc(benchmarkRuns.createdAt))` so the oldest pending run is always selected first across competing processes or concurrent polls.
2. **Line 124 — Non-deterministic config order**: Added `orderBy(asc(benchmarkConfigs.createdAt))` so configs execute in deterministic creation order every run.
3. **Lines 147-151 — N+1 queries**: Replaced per-config `findFirst` lookups (2 per config) with two batched IN-clause queries. Provider configs and providers are fetched once, indexed into maps, and passed down to `processConfigExecution`. Missing configs/providers are logged and skipped instead of throwing mid-run.
