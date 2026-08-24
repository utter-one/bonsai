---
title: "Partition provider_call_logs (and metric_samples) for scale"
severity: medium
status: open
created: 2026-08-21
updated: 2026-08-21
assignee: ""
tags: [performance, monitoring, database, scale]
---

# Partition provider_call_logs (and metric_samples) for scale

- **Filed by:** P4-05 load sanity check (pre-agreed decision rule triggered)
- **Related:** `.issues/proposal/monitoring/P4-05-docs-env-load-sanity.md`

## Context

P4-05 ran a scripted burst through the real `CallLogger` (100 conversations × 3 provider calls — LLM/TTS/ASR — over 60 s) against a testcontainer instance, then projected 100× and measured the exact `RetentionService` hourly rollup with `EXPLAIN (ANALYZE, BUFFERS)`:

| Metric | Value |
|---|---|
| Burst rate | 4.54 rows/s = ~16,357 rows/h |
| 1× projection | ~392,579 rows/day (~35 M rows at the default 90 d retention) |
| 100× one-hour bucket | 1,635,744 rows |
| 100× daily projection | ~39,257,857 rows/day |
| Hourly rollup at 100× (worst case: whole table in-window → seq scan + disk spill) | **5,371 ms** |
| Buffer behavior at burst | peak 27 pending (threshold 200, cap 10,000), flushes on the 5 s timer, max inter-flush gap 5,006 ms, 0 dropped |

**Pre-agreed decision rule (P4-05):** projected daily rows (100×) > 5 M **or** rollup at 100× > 5 s → file a partitioning follow-up. **Both conditions are met** (39.3 M > 5 M; 5.37 s > 5 s).

## Why it matters

- The rollup's window scan (`created_at >= X AND created_at < X+1h`) is index-backed (`idx_provider_call_logs_created_at`) while the window is a small slice of the table; at 100× with ~39 M rows/day the 90 d table approaches 3.5 B rows and even indexed scans + the `percentile_cont` sorts spill to disk (observed `temp read=125,941 written=105,204` 8 kB pages in the worst-case plan).
- The daily retention purge is a big-DELETE with its own vacuum cost at that scale.
- `metric_samples` has the same growth shape (60 s buckets × registered series) and would need the same treatment if it becomes the hot table.

## Proposed work

1. Decide the partitioning scheme: `provider_call_logs` (and `metric_samples`) by `created_at` — monthly (or weekly) ranges, native Postgres declarative partitioning or `pg_partman`; keep the existing indexes per partition.
2. Migration strategy: create the partitioned parent, backfill, swap (or `CREATE TABLE ... PARTITION OF` in place where possible); the Drizzle migrator does not manage partitions — a hand-written SQL migration + retention-service adjustment.
3. Point the `RetentionService` purge at partitions (`DROP`/`DETACH` expired partitions instead of `DELETE`) — turns the daily purge into a metadata operation.
4. Re-run the P4-05 load script at 100× against the partitioned table; target: hourly rollup < 5 s with the table 100× larger than the window.
5. Document the revisit trigger in `docs/guide/monitoring.md` §8.

## Out of scope

- Performance work below the 100× projection (the spec for P4-05 was "measure first, not optimize first" — at 1× the current single-table design is fine, verified by P4-04's EXPLAIN evidence).
- Sharding / moving time series out of Postgres (revisit only if partitioning is insufficient).

## Acceptance criteria

- [ ] `provider_call_logs` partitioned by time; existing indexes functional per partition
- [ ] Hourly rollup < 5 s at 100× volume with the table ≫ the window (measured, not estimated)
- [ ] Retention purge uses partition drop/detach; e2e retention suite green
- [ ] Drizzle migration committed alongside schema notes in `AGENTS.md`
- [ ] `docs/guide/monitoring.md` §8 updated with the new retention mechanism
