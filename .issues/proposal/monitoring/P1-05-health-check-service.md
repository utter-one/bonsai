---
title: "P1-05 — HealthCheckService, `/health/ready`, background-service heartbeats"
severity: proposal
status: open
created: 2026-08-17
updated: 2026-08-17
assignee: ""
tags: [monitoring, spec, phase-1]
---

# P1-05 — HealthCheckService, `/health/ready`, background-service heartbeats

- **Phase:** 1 — Instrumentation & health
- **Depends on:** P1-01, P1-02, P1-03 (call-log-backed provider inference)
- **Blocks:** P1-08, P1-09, P2-01
- **Estimate:** 1 dev-day

## Objective

Replace the static `/health` illusion with real, persisted, per-check health: DB, every configured provider (probed or inferred), every background service (heartbeat), and process vitals — plus a Kubernetes/docker-ready readiness endpoint.

## Scope

### New files
- `src/services/monitoring/HealthCheckService.ts`

### Modified files
- `src/server.ts` — register `GET /health/ready` (before auth middleware, next to `/health`); start `HealthCheckService`
- The six background services — one-line `HeartbeatRegistry.tick('<name>')` at loop start + `recordError('<name>')` in existing catch blocks:
  - `ConversationTimeoutService` (60 s cron), `ProcessingDeferralService`, `ScenarioRunExecutorService`, `BenchmarkExecutorService`, `ImapInboundService`, `OAuth2TokenRefreshService` — each service's interval is env/config-driven (e.g. `config.imap.pollingIntervalMs`), so each service declares its effective interval at `start()` and the staleness threshold is 3× that declared value

## Implementation requirements

### Check registry
Each check = `{ name, run(): Promise<HealthCheckResult> }` where `HealthCheckResult = { status: 'ok' | 'degraded' | 'down' | 'unknown', latencyMs?, detail? }`. A check throwing → `{ status: 'down', detail: message }`.

| Check name | Logic |
|---|---|
| `db` | `SELECT 1` → ok; latency = ping time; **degraded** when pg pool `waiting > 0` (pool stats via the existing `getPoolRef()` export in `src/db/index.ts`). The check's `detail` carries `{ poolTotal, poolIdle, poolWaiting }`, and it publishes the `db_pool_total` / `db_pool_idle` / `db_pool_waiting` gauges each cycle (the `db-pool-saturated` rule reads the ratio from the health snapshot) |
| `provider:{id}` | per row in `providers` table, by type: **llm** → `enumerateModels()` probe (globally opt-in/opt-out via `monitoring_config.probeSettings.llmProbe` — default `models`, see below); **storage** → `list('', 1)`; **channel / asr / tts** → status *inferred* from `provider_call_logs` (ok if ≥1 success in last 30 min; `degraded` if only failures in window; `unknown` if no calls yet) |
| `service_heartbeat:{name}` | `HeartbeatRegistry.staleServices(3 × interval)` → down; detail includes last-run age |
| `process` | ok; **degraded** when RSS > `MONITORING_MEMORY_THRESHOLD_MB` (default 1536) or event-loop lag p95 (perf_hooks `monitorEventLoopDelay`) > 250 ms; detail carries uptime, rss, heapUsed. **Every cycle** this check publishes the gauges the P2-01 rules read: `rss_bytes` (the `high-memory` rule) and `event_loop_lag_p95_ms` — the p95 over an in-memory 60 s window of delay samples kept by this check (the `event-loop-lag` rule) |

### Probe policy (cost control)
- Cooldown: max 1 probe per provider per 10 min; skip probe entirely when `provider_call_logs` shows a success within the last 10 min.
- Probe failures are recorded as normal call-log rows (`operation='llm.models'` etc.) — they feed the same alerting as real traffic. The service also tracks **consecutive probe failures per provider** in memory (`getProbeFailures(providerId): number`, reset on success) — the `provider-down` rule's probe branch (P2-01) consumes it.
- `enumerateModels()` is free on essentially all LLM providers; paid 1-token probes stay out of scope (open question Q4 in the proposal — config hook is reserved in `probeSettings`).

### Loop + persistence
- Lifecycle per house convention: `start()` called from `server.ts` (after the other background services), `stop()` cancels the interval — `stop()` is the hook P1-09's shutdown sequence calls.
- Every 60 s (env `MONITORING_HEALTH_INTERVAL_MS`, default 60000; **tests use 1000**): run all checks concurrently with a per-check 10 s timeout, batch-insert results into `health_checks`, update the in-memory snapshot.
- The loop itself is guarded like house background services (`isProcessing` flag, catch-and-log) and registers its own heartbeat (`service_heartbeat:health-checks`) so its own death is detectable.
- `getSnapshot(): { checkedAt, checks: HealthCheckResult[] }` — consumed by P1-08 and the rule engine.

### Readiness endpoint
- `GET /health/ready`: real `SELECT 1` with 3 s timeout → 200 `{ status: 'ready' }` / 503 `{ status: 'unavailable', reason }`. Unauthenticated, registered before auth/rate-limit middleware (same as `/health`).
- `GET /health` is **unchanged** (static liveness).

## Acceptance criteria

- [ ] `/health/ready` returns 200 in normal operation and 503 when the DB is unreachable (unit-level test with stubbed db; e2e asserts 200).
- [ ] After ≥2 check cycles (test env interval 1 s), `health_checks` contains rows for `db`, every provider in the DB, all 6 services, and `process`.
- [ ] Killing a background loop in a test (e.g. not calling tick) flips `service_heartbeat:{name}` to `down` after the staleness threshold.
- [ ] Provider probe respects cooldown (second cycle within 10 min does not call `enumerateModels` again — assert via call-log row count).
- [ ] Full e2e suite green with `MONITORING_HEALTH_INTERVAL_MS=1000` set in `tests/setup.ts` (verify no flakiness from the 1 s loop — batched inserts, single flight).

## Tests

- **Unit:** each check function with stubbed deps (db up/down, pool waiting, provider inference from synthetic call logs, heartbeat staleness, process thresholds).
- **E2E:** rows appear in `health_checks`; snapshot shape; `/health/ready` 200; probe cooldown.

## Out of scope

- Alerting on check results (P2-01), the `/api/monitoring/health` endpoint (P1-08), active provider failover (Phase 3).
