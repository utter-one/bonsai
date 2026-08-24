---
title: "P1-05 — HealthCheckService, `/health/ready`, background-service heartbeats"
severity: proposal
status: resolved
created: 2026-08-17
updated: 2026-08-19
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
- `src/services/monitoring/HeartbeatRegistry.ts` — additive extension: `tick(service, intervalMs?)`, `declareInterval(service, ms)`, `serviceStates(now?)` (per-service declared interval + 3× threshold; P1-02's `tick`/`staleServices`/`errorCount` API stays intact)
- `src/services/monitoring/ProviderCallRecorder.ts` — new `getHeartbeatRegistry()` accessor (NOOP fallback, same pattern as `getMetricsRegistry`) for the plain-class IMAP session; `resetMonitoringAccessorsForTests()` extended
- `src/http/middleware/requestOutcome.ts` — `/health/ready` added to `SKIPPED_PATHS` (P1-04)
- `tests/setup.ts` — `MONITORING_HEALTH_INTERVAL_MS=1000` and `MONITORING_HEALTH_PROBES=off` in the test env (probe hygiene, see soundness review #8)
- The six background services — one-line `HeartbeatRegistry.tick('<name>')` at loop start + `recordError('<name>')` in loop-level catch blocks:
  - `ConversationTimeoutService` (60 s cron), `ProcessingDeferralService` (15 s cron), `ScenarioRunExecutorService` (30 s poll), `BenchmarkExecutorService` (30 s poll), `OAuth2TokenRefreshService` (5 min poll) — each declares its effective interval at tick time and the staleness threshold is 3× that declared value
  - `ImapInboundService` is different (soundness review #3): the per-provider poll loop lives in the plain (non-DI) `ImapMailboxSession`, so the session calls `getHeartbeatRegistry()?.tick('imap-inbound')` and the DI service declares the **minimum** active session interval via `declareInterval()` on session start/stop. `recordError` goes in the session poll catch (accessor) + the service's `discoverAndStart` catch
  - `recordError` is added to **loop-level** catches only (the service's own unhandled failure), not per-item catches (one conversation/run/provider failing does not mean the loop is unhealthy)

## Implementation requirements

### Check registry
Each check = `{ name, run(): Promise<HealthCheckResult> }` where `HealthCheckResult = { status: 'ok' | 'degraded' | 'down' | 'unknown', latencyMs?, detail? }`. A check throwing → `{ status: 'down', detail: message }`.

| Check name | Logic |
|---|---|
| `db` | `SELECT 1` → ok; latency = ping time; **degraded** when pg pool `waiting > 0` (pool stats via the existing `getPoolRef()` export in `src/db/index.ts`). The check's `detail` carries `{ poolTotal, poolIdle, poolWaiting }`, and it publishes the `db_pool_total` / `db_pool_idle` / `db_pool_waiting` gauges each cycle (the `db-pool-saturated` rule reads the ratio from the health snapshot) |
| `provider:{id}` | per row in `providers` table (all 6 `provider_type` values: `asr, tts, llm, embeddings, storage, channel`): **llm** → `init()` + `enumerateModels()` probe (fixed to `models` in P1-05; P1-06's `probeSettings.llmProbe` later makes this config-driven — see soundness review #1); **storage** → `list('', 1)` probe (same gates); **asr / tts** → zero-cost `ping()` probe (P1-05b addendum — 10 of 13 providers have a free liveness endpoint; Azure ASR/TTS + Cartesia TTS have no `ping()` and fall through to inference); **channel / embeddings** → status *inferred* from `provider_call_logs`: ≥1 success in last 30 min → `ok`; else ≥1 failure in last 30 min → `degraded`; else any row in last 24 h → `unknown` (stale activity); no rows in 24 h → `unknown` (detail distinguishes). Probed providers: probe success → `ok`; probe failure → `degraded` (detail: error + consecutive probe-failure count); probe skipped (cooldown / recent success) → inference rules apply |
| `service_heartbeat:{name}` | `HeartbeatRegistry.serviceStates()` (per-service declared interval, threshold 3×): never ticked → `unknown` (a service with no work — e.g. IMAP with zero providers — must not read as down); stale → `down`; else `ok`. Detail includes last-run age, threshold, cumulative error count |
| `process` | ok; **degraded** when RSS > `MONITORING_MEMORY_THRESHOLD_MB` (default 1536) or event-loop lag p95 (perf_hooks `monitorEventLoopDelay`) > 250 ms; detail carries uptime, rss, heapUsed. **Every cycle** this check publishes the gauges the P2-01 rules read: `rss_bytes` (the `high-memory` rule) and `event_loop_lag_p95_ms` — the p95 over an in-memory 60 s window of delay samples kept by this check (the `event-loop-lag` rule) |

### Probe policy (cost control)
- Cooldown: max 1 probe per provider per 10 min; skip probe entirely when `provider_call_logs` shows a success within the last 10 min.
- Global switch: `MONITORING_HEALTH_PROBES` env var (`on`/`off`, default `on`) — when `off`, all providers use the call-log inference rules only (reserved vocabulary matches P1-06's `probeSettings.llmProbe: 'models' | 'one_token' | 'off'`). Test env sets it to `off` (soundness review #8).
- Probe failures are recorded as normal call-log rows (`operation='llm.models'` etc.) — they feed the same alerting as real traffic. The service also tracks **consecutive probe failures per provider** in memory (`getProbeFailures(providerId): number`, reset on success) — the `provider-down` rule's probe branch (P2-01) consumes it.
- `enumerateModels()` is free on essentially all LLM providers; paid 1-token probes stay out of scope (open question Q4 in the proposal — config hook is reserved in `probeSettings`).

### Loop + persistence
- Lifecycle per house convention: `start()` called from `server.ts` (after the other background services), `stop()` cancels the interval — `stop()` is the hook P1-09's shutdown sequence calls.
- Every 60 s (env `MONITORING_HEALTH_INTERVAL_MS`, default 60000; **tests use 1000**) via `setInterval` (sub-minute-capable, unlike node-cron): run all checks concurrently with a per-check 10 s timeout (`Promise.race`; the underlying probe is not cancellable — it finishes in the background and records its own call-log row; the check reports `down` + detail `timeout`), batch-insert results into `health_checks`, update the in-memory snapshot. Health-check row ids: `generateId('hchk')` (house pattern per `clgl_`/`msmp_`).
- The loop itself is guarded like house background services (`isProcessing` flag, catch-and-log) and registers its own heartbeat (`service_heartbeat:health-checks`, declared interval = the health interval) so its own death is detectable — i.e. **7** heartbeat checks total (6 services + itself).
- `getSnapshot(): { checkedAt: Date | null, checks: HealthCheckResult[] }` (`checkedAt` null before the first completed cycle) — consumed by P1-08 and the rule engine.

### Readiness endpoint
- `GET /health/ready`: real `SELECT 1` with 3 s timeout → 200 `{ status: 'ready' }` / 503 `{ status: 'unavailable', reason }`. Unauthenticated, registered before auth/rate-limit middleware (same as `/health`).
- `GET /health` is **unchanged** (static liveness).

## Acceptance criteria

- [x] `/health/ready` returns 200 in normal operation and 503 when the DB is unreachable (unit-level test with stubbed ping; e2e asserts 200). **Evidence:** e2e `health-check.test.ts` asserts 200 `{status:'ready'}`; unit `checkReady()` test asserts `{ready:false, reason}` on stubbed ping failure and on 3 s timeout; `server.ts` maps `ready:false` → 503 `{status:'unavailable', reason}`.
- [x] After ≥2 check cycles (test env interval 1 s), `health_checks` contains rows for `db`, `process`, every provider in the DB, and all 7 heartbeats (6 services + `health-checks` itself). **Evidence:** e2e test sleeps 2.5 s (2+ cycles at 1 s) after reset and asserts `db`, `process`, all 7 `service_heartbeat:*` rows (≥2 `db` rows, pool gauges in `detail`); a created provider yields `provider:{id}` rows with `{inferred:true}`.
- [x] Killing a background loop in a test (e.g. not calling tick) flips `service_heartbeat:{name}` to `down` after the staleness threshold (unit-level, synthetic clock). **Evidence:** unit test ticks `svc-c` with 100 ms interval, waits 350 ms (> 3× threshold), full cycle → `service_heartbeat:svc-c` = `down`; never-ticked `imap-inbound` → `unknown` (`{reason:'never ticked'}`), not down.
- [x] Provider probe respects cooldown (second cycle within 10 min does not call `enumerateModels` again) and skips on recent success (unit-level with stubbed factories — no network). **Evidence:** unit tests with stubbed `LlmProviderFactory`/`StorageProviderFactory`: probe called exactly once across two cycles; recent-success call stats skip the probe entirely; probe failure → `degraded` + `consecutiveProbeFailures` 1→2, reset to 0 on success.
- [x] Full e2e suite green with `MONITORING_HEALTH_INTERVAL_MS=1000` + `MONITORING_HEALTH_PROBES=off` set in `tests/setup.ts` (verify no flakiness from the 1 s loop — batched inserts, single flight, zero probe traffic in tests). **Evidence:** both vars set in `tests/setup.ts`; full gate run: build 0 errors, unit 583/583, e2e 940/940.

## Implementation (2026-08-17)

- New `src/services/monitoring/HealthCheckService.ts` (`@singleton`): `start()`/`stop()`, `runNow()` (test/manual hook), `getSnapshot()`, `getProbeFailures(providerId)`, `checkReady()` (single flight + 3 s race). Check cycle: `db` (SELECT 1 + pool gauges, waiting > 0 → degraded), `process` (RSS vs `MONITORING_MEMORY_THRESHOLD_MB` default 1536 MB + event-loop-lag p95 vs 250 ms; also publishes `event_loop_lag_max_ms` for burst-sensitive rules — p95 misses isolated stalls, histogram reset per cycle), 7+ heartbeats (known-service list ∪ ticked names), one `provider:{id}` per provider (probed llm/storage or inferred). 10 s per-check timeout backstop; batched `health_checks` insert (id prefix `hchk`).
- `HeartbeatRegistry` extended additively: `tick(service, intervalMs?)`, `declareInterval(service, ms)`, `serviceStates(now?)` (default declared interval 60 s, threshold 3×); P1-02 API untouched.
- `getHeartbeatRegistry()` accessor in `ProviderCallRecorder.ts` (NOOP/null fallback) for the non-DI `ImapMailboxSession` poll loop.
- Six background services tick + `recordError` in loop-level catches; `ImapInboundService` declares the min active session interval.
- `server.ts`: `GET /health/ready` registered after `/health` (bypasses all middleware); service started with the other background services. `/health/ready` added to `requestOutcome.ts` `SKIPPED_PATHS`.
- New tests: `tests/unit/monitoring/p1-05-health-check.test.ts` (16 tests) + `tests/e2e/health-check.test.ts` (4 tests).

## Tests

- **Unit:** each check function with stubbed deps (db up/down, pool waiting, provider inference from synthetic call logs, probe cooldown + recent-success skip + probe-failure mapping with stubbed factories, heartbeat staleness, process thresholds, `checkReady` up/down). Implemented: `tests/unit/monitoring/p1-05-health-check.test.ts` — `HealthCheckService` seams stubbed via protected overrides (`pingDb`, `getPoolStats`, `fetchProviders`, `fetchRecentCallStats`, `persistResults`), fake factories passed to the constructor, `runNow()` drives cycles.
- **E2E:** rows appear in `health_checks` (db, process, 7 heartbeats, a created provider); snapshot shape; `/health` unchanged + `/health/ready` 200. Implemented: `tests/e2e/health-check.test.ts`.

## Out of scope

- Alerting on check results (P2-01), the `/api/monitoring/health` endpoint (P1-08), active provider failover (Phase 3).

## Soundness review (2026-08-17)

Findings from verifying this spec against the codebase before implementation (all reconciled into the spec above):

1. **`monitoring_config.probeSettings` is P1-06's territory.** The original check table referenced `probeSettings.llmProbe`, but this issue does not depend on P1-06 (unimplemented) and the probe-policy section never defined the config. **Resolution:** P1-05 hard-codes the probe to `enumerateModels()` (the proposal's `models` default) with a 10-min cooldown + recent-success skip, plus a `MONITORING_HEALTH_PROBES` env switch (`on`/`off`, default `on`) whose vocabulary matches P1-06's reserved `probeSettings.llmProbe` enum. P1-06 later replaces the env/hard-coded values with config-driven `probeSettings` (one small wiring change in P1-06's scope). No frontmatter dependency added.
2. **`embeddings` provider type was missing from the check table.** `providers.provider_type` is a 6-value enum (`asr, tts, llm, embeddings, storage, channel` — `src/http/contracts/provider.ts`); the spec covered five. `embeddings` joins the call-log-inference column (no embeddings provider implementations exist in this codebase — reserved type).
3. **The IMAP loop lives in a plain (non-DI) class.** `ImapInboundService` has no loop of its own — each provider's poll loop is in `ImapMailboxSession` (plain class, 20-arg constructor, not tsyringe), so "one-line `tick()` at loop start" cannot be injected there. **Resolution:** the session calls a new `getHeartbeatRegistry()` accessor (NOOP fallback, same pattern as `getMetricsRegistry`/`getProviderCallRecorder` in `ProviderCallRecorder.ts`) with `tick('imap-inbound')` (no interval); the DI `ImapInboundService` tracks active session intervals and calls `declareInterval('imap-inbound', min)` on `startSession`/`stopSession`. Last-declared-min-wins is safe: if the fastest session dies, staleness fires at 3× its interval before a slower session's tick re-declares.
4. **Per-service intervals need a registry extension.** P1-02's `staleServices(maxAgeMs, now)` takes a single global threshold, but the six services run at 60 s / 15 s / 30 s / 30 s / 5 min / per-provider-intervals. **Resolution:** additive `HeartbeatRegistry` extension — `tick(service, intervalMs?)`, `declareInterval(service, ms)`, and `serviceStates(now?)` returning per-service `{ lastRun, ageMs, declaredIntervalMs (default 60 s), thresholdMs (3×), stale, errorCount }`. Never-ticked services are excluded → the heartbeat check reports `unknown`, not `down` (IMAP with zero configured providers must not read as down). P1-02's pinned API (`tick(name)`, `staleServices`, `lastRun`, `recordError`, `errorCount`) stays intact.
5. **`/health/ready` must be added to P1-04's skip list.** `requestOutcome.ts`'s `SKIPPED_PATHS` is exactly `{/health, /metrics}`; the new readiness path would otherwise be counted/logged as probe traffic. Added.
6. **Provider inference needed a complete rule set.** The original wording left a gap (provider that last called 2 h ago was neither "success in 30 min" nor "no calls yet"). Full ruleset now specified: success ≤30 min → `ok`; else failure ≤30 min → `degraded`; else any row ≤24 h → `unknown` (stale activity); else `unknown` (no recent activity). Probed providers map probe success → `ok`, probe failure → `degraded` (consecutive count in detail), skipped probe → inference rules. Consecutive probe failures stay in memory via `getProbeFailures(providerId)` (reset on success) for P2-01's `provider-down` probe branch.
7. **Event-loop lag window mechanics.** `perf_hooks.monitorEventLoopDelay()` is a cumulative histogram; the "60 s window" is implemented by `reset()`-ing the histogram at the end of each cycle, so p95 covers the last cycle (≈ interval; 1 s in tests). p95 via `histogram.percentile(95)` — the histogram values are **nanoseconds** (nodejs.org/api/perf_hooks.html; ms = /1e6, see finding 11) — NaN-guarded (empty histogram → 0).
8. **Test-env probe hygiene.** E2E suites create providers with fake configs (e.g. `apiType: 'anthropic'` + fake key); live probes would send real outbound requests (401 to the real API) and add network dependency to the e2e run. **Resolution:** `tests/setup.ts` sets `MONITORING_HEALTH_PROBES=off` (inference-only in tests — zero probe traffic) and `MONITORING_HEALTH_INTERVAL_MS=1000`. Probe behaviour (cooldown, recent-success skip, failure mapping) is covered at unit level with stubbed factories — deterministic, no network.
9. **`/health/ready` single flight + timeout.** A `SELECT 1` on a down DB hangs (pg pool has no default connect timeout), so the 3 s `Promise.race` is essential; an in-flight guard keeps readiness probes from piling up under sustained outage. The underlying query is not cancellable and drains when the pool recovers.
10. **Probe path needs `init()`.** `LlmProviderFactory.createProviderForEnumeration()` returns an *uninitialised* instance (documented "without validation or init"); several providers' `enumerateModels()` silently fall back to static model lists when the client is absent — a probe against an uninitialised instance would not verify the connection. **Resolution:** the LLM probe runs `createProviderForEnumeration(provider)` → `init()` (client construction only, no network) → `enumerateModels()`. The P1-03 wrapper records the `llm.models` row (provider identity is stamped in `instantiateProvider`). Storage probe: `createProvider(provider, {})` (factory calls `init()` internally) → `list('', 1)`; `StorageSettings = Record<string, unknown>` so `{}` is valid.
11. **Event-loop lag unit bug — `monitorEventLoopDelay` values are ns, not µs (field-reported, 2026-08-18).** The `process` check reported `degraded` on an idle production machine with `eventLoopLagP95Ms` pinned at ~20,000–47,000 "ms" across every cycle since startup. Root cause: `readEventLoopLagP95Ms()` divided `percentile(95)` by 1000 assuming µs, but Node's `monitorEventLoopDelay` histogram returns **nanoseconds** (nodejs.org/api/perf_hooks.html states ns explicitly; independently confirmed by nodejs/node#34661's 30 s spin-block reporting `max: 30014` ms after /1e6, and by a local 5 s spin-block probe on Node v24 returning raw ≈ 5.0e9). The reported "ms" was really µs — a healthy ~20 ms p95 read as 20,000 "ms" — and the 250 ms threshold effectively became 250 µs, so **any** healthy process degraded. **Fix:** divide by 1e6. Unit-regression tests pin the magnitude from both sides: a deterministic 300 ms spin-block must report ~300 ms (the old /1000 would report ~300,000; a µs misread ~0.3) — unit: `process check: event-loop lag p95 is real ms`, e2e: persisted `eventLoopLagP95Ms` < 1000 on a healthy test machine. Same bug class as elastic/kibana#116778. Known limitation (nodejs/node#34661): a single long block yields one coalesced sample, so p95 measures *sustained* lag fragmentation rather than any single stall — acceptable for a process-health check; burst sensitivity belongs in P2-01 rules (`forMinutes` over the gauge). Follow-up (same window, no status impact): `event_loop_lag_max_ms` gauge + `eventLoopLagMaxMs` detail field published alongside p95 so a P2-01 rule can alert on isolated stalls (max ≥ p95 by construction; unit- and e2e-tested with the same magnitude guards).
