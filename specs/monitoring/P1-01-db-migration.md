---
title: "P1-01 — Monitoring DB migration (7 tables + `providers.fallbacks`)"
severity: proposal
status: resolved
created: 2026-08-17
updated: 2026-08-19
assignee: ""
tags: [monitoring, spec, phase-1]
---

# P1-01 — Monitoring DB migration (7 tables + `providers.fallbacks`)

- **Phase:** 1 — Instrumentation & health
- **Depends on:** —
- **Blocks:** P1-02, P1-05, P1-06, P1-08, P3-02
- **Estimate:** 0.5 dev-day

## Objective

Create the persistence layer for all monitoring data (call logs, health history, alerts, fallback events, metric samples, config) in a single migration, plus the `providers.fallbacks` column consumed in Phase 3 — so no later phase needs a schema migration for *monitoring tables* (the only later migration is P4-03's `webhook_failures` table — its own small migration, numbered at `db:generate` time; P3-05 needs **no** migration, its fallback is a per-request parameter).

## Scope

### Modified files
- `src/db/schema.ts` — 7 new tables + 1 column
- `drizzle/0068_*.sql` — generated
- `tests/utils.ts` — **add the 6 new tables to `resetDatabase()` TRUNCATE list** (currently 37 tables; `monitoring_config` excluded, like `operators`, so config survives resets)

### New files
- none

## Implementation requirements

Follow `src/db/schema.ts` conventions exactly (text ids, `defaultNow()`, explicit named indexes). Tables per PROPOSAL §3.5:

1. `provider_call_logs` — `id text pk`, `provider_id`, `provider_type`, `api_type`, `operation`, `model`, `project_id`, `conversation_id`, `ok bool`, `error_code`, `status_http`, `duration_ms int`, `error_text` (≤1KB), `fallback_provider_id`, `created_at` + **`metrics jsonb`** (nullable) holding the variant-specific streaming/ASR/TTS phase fields as a sparse object (TS type `CallMetrics` in `schema.ts`): LLM — `ttftMs`, `chunksCount`, `maxChunkGapMs`, `finishReason`, `tokensPrompt`, `tokensCompletion`, `errorPhase` (`'setup' | 'mid_stream'`); TTS — `audioBytesOut`, `audioDurationMs` (+ `canceled` boolean on barge-in); ASR — `setupMs`, `timeToFirstPartialMs`, `eosToFinalMs`, `partialsCount`, `finalsCount`, `sessionAudioMs`; channels/storage — `bytesIn`, `bytesOut` (payload sizes); IMAP — `messagesFound`. Rationale: a row is one variant (per `providerType`+`operation`), so flat columns would be ~9–13 NULLs per row; nothing index-seeks these fields — they're only batch-aggregated in window scans (P1-06 rollup, P2-01 rule query, extracted via `->>`), and new streaming fields can be added without a migration. Core columns stay flat: they are filtered/indexed and `error_code` feeds the stats-table PK.
   Indexes: `(created_at)`, `(provider_id, created_at)`, `(project_id, created_at)`, `(conversation_id)`.
2. `provider_call_stats_hourly` — `hour_bucket timestamp`, `provider_id`, `operation`, `ok bool notNull`, `error_code text notNull default 'none'` (PK members must be non-NULL; the P1-06 rollup `COALESCE`s a NULL `error_code` → `'none'`), `count bigint`, `sum_duration_ms bigint`, `min_duration_ms int`, `max_duration_ms int`, `p95_duration_ms double`, `p50_ttft_ms double`, `p95_ttft_ms double`, `p99_ttft_ms double`, `p95_max_chunk_gap_ms double`, `stalled_count int`, `rtf_over_1_count int`. PK `(hour_bucket, provider_id, operation, ok, error_code)`.
3. `health_checks` — `id text pk`, `check_name`, `status` (`ok|degraded|down|unknown`), `latency_ms int`, `detail jsonb`, `created_at`. Indexes: `(check_name, created_at)`, `(created_at)`.
4. `alert_events` — `id text pk`, `rule_id`, `scope_key`, `scope jsonb`, `severity` (`info|warning|critical`), `status` (`firing|resolved`), `message`, `context jsonb`, `notifications jsonb`, `fired_at`, `resolved_at timestamp`, `acked_at timestamp`, `acked_by text`. Indexes: `(fired_at)`, `(scope_key, status)`, `(rule_id, fired_at)`.
5. `fallback_events` — `id text pk`, `provider_id`, `fallback_provider_id`, `provider_type`, `operation`, `reason`, `project_id`, `conversation_id`, `success bool`, `created_at`. Indexes: `(created_at)`, `(provider_id, created_at)`.
6. `metric_samples` — `id text pk` (jsonb `labels` cannot participate in a PK), `bucket timestamp`, `name`, `labels jsonb`, `count bigint`, `sum double`, `min double`, `max double`, `created_at`. Indexes: `(name, bucket)`, `(bucket)`.
7. `monitoring_config` — `id text pk default 'global'`, `config jsonb notNull`, `version int notNull default 1`, `updated_at`.
8. `providers` — add `fallbacks jsonb notNull default '[]'` (`{ providerId: string; settings?: Record<string, unknown> }[]`).

## Acceptance criteria

- [ ] `npm run db:generate` produces exactly one new migration; reviewed SQL matches the spec above.
- [ ] `npm run db:migrate` applies cleanly on a fresh database.
- [ ] `npm run build` green; full e2e suite green (purely additive — no behavior change).
- [ ] `resetDatabase()` truncates all new tables (except `monitoring_config`) between tests.

## Tests

- e2e: existing suite unchanged and green (this is the verification). No new endpoint tests — tables are exercised by later issues.

## Out of scope

- Data writes (P1-02+), retention jobs (P1-06), `webhook_failures` table (P4-03 — its own migration, next free number).
