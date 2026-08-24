---
title: "P4-05 — Docs, env examples, AGENTS.md, load sanity check"
severity: proposal
status: resolved
created: 2026-08-17
updated: 2026-08-21
assignee: ""
tags: [monitoring, spec, phase-4]
---

# P4-05 — Docs, env examples, AGENTS.md, load sanity check

- **Phase:** 4 — Polish
- **Depends on:** everything (last issue)
- **Blocks:** —
- **Estimate:** 1 dev-day

## Objective

Ship the knowledge: operator-facing documentation, complete env examples, repo-agent instructions updated, and an honest load sanity check that validates the "hourly rollups are enough" assumption before production traffic arrives.

## Scope

### New files
- `docs/guide/monitoring.md` — the main operator guide (VitePress)

### Modified files
- `.env.example`, `compose/env.example` — all new env vars
- `AGENTS.md` — Architecture + Test Infrastructure sections updated (new module, new tables, new services, new endpoints, test conventions for monitoring tests)
- `PROPOSAL-production-monitoring.md` — mark as implemented (status header + any deltas discovered during implementation)

## Implementation requirements

### `docs/guide/monitoring.md` (VitePress — **no bare `{{ }}` outside fenced code blocks**; wrap in `<code v-pre>` per AGENTS.md)
Sections:
1. **Overview** — what is monitored, where data lives (all Postgres, no new infra), data-flow diagram (call sites → CallLogger/MetricsRegistry → tables → rule engine → notifiers).
2. **Health** — `/health` vs `/health/ready` semantics, the check registry (db, providers, heartbeats, process), probe policy + cost, how to read `GET /api/monitoring/health`.
3. **Alerting** — the full default rule table (id/severity/condition/threshold), state machine (hysteresis, cooldown, auto-resolve), notifiers (webhook payload sample, email/telegram/sms setup: which channel provider to point at), config via API + env fallbacks.
4. **Failover** — fallback chain configuration (provider API example payload), the setup-vs-mid-stream boundary (what fails over, what doesn't — with the mid-stream limitation called out explicitly), circuit breaker behavior + restart semantics, outbound channel fallback, webhook dead-letter + replay (incl. the idempotency caveat).
5. **Streaming metrics** — what TTFT / maxChunkGap / RTF / eosToFinal mean, the `ai_turn_ttft_ms` waterfall, the alert thresholds and how to tune them, why raw token counts live in call logs (not metric labels).
6. **429 monitoring** — the three rules (api/auth/provider), the hashed-key detail, what each one means operationally (brute force vs noisy client vs quota).
7. **API reference** — pointer to `/api-docs` (Swagger) for the `/api/monitoring/*` routes; `/metrics` setup (token, Prometheus scrape config one-liner).
8. **Retention & storage** — defaults (90 d), what is never purged, how to change, the partitioning revisit trigger.
9. **Operational runbooks** (short): "provider is down — what to do", "alert is firing — how to read context + ack", "webhook dead-letter — when to replay vs discard".

### Env examples
Every new var, documented with default + one-line purpose: `MONITORING_METRICS_TOKEN`, `MONITORING_HEALTH_INTERVAL_MS`, `MONITORING_CALL_LOG_BUFFER_SIZE`, `MONITORING_MEMORY_THRESHOLD_MB`, `MONITORING_RETENTION_DAYS`, `MONITORING_WEBHOOK_URL`, `MONITORING_EMAIL_PROVIDER_ID`, `SHUTDOWN_GRACE_MS`.

### AGENTS.md updates
- Architecture table: `src/services/monitoring/` row; new `MonitoringController`.
- Background services list: `AlertRuleEngine` (1/min), `RetentionService` (hourly/daily cron), `HealthCheckService` (60 s), shutdown sequence.
- Test infra: new tables in `resetDatabase()`, test env vars (`MONITORING_HEALTH_INTERVAL_MS=1000`, engine interval override), fake-provider double pattern for failover tests.

### Load sanity check (documented, not optimized)
- Script a burst (e.g. 100 mock conversations with LLM+TTS+ASR calls against a local instance with the test fake providers) → measure: call-log row rate, flush cadence, buffer behavior, hourly rollup query time via `EXPLAIN ANALYZE` at that volume × 100 (worst-case projection).
- Record results in the doc (§8) + this issue's PR description. **Decision rule (pre-agreed):** if projected daily rows > 5M or rollup > 5 s at 100×, file a partitioning follow-up issue; otherwise document "revisit at X×".

## Acceptance criteria

- [x] `docs/guide/monitoring.md` renders in the VitePress build (`npm run build --prefix docs` — there is no root `docs:build` script; no bare-brace build breakage). — VitePress build green; no bare `{{ }}` outside fenced code blocks (awk check clean).
- [x] Every env var used by monitoring code appears in both `.env.example` and `compose/env.example` with a default; every env var in the examples is actually read by code (no orphans). — 11 vars in both files (see implementation note 2/3); all read by code (9 via `process.env`, `MONITORING_METRICS_TOKEN` via `metricsEndpoint.ts` constant, `SHUTDOWN_GRACE_MS` via `parseEnvInt` in `src/index.ts`).
- [x] AGENTS.md matches the shipped code (module, services, tables, endpoints, test conventions). The stale "Background services" section (it said two; `server.ts` starts six: ConversationTimeoutService, ScenarioRunExecutorService, BenchmarkExecutorService, ImapInboundService, OAuth2TokenRefreshService, ProcessingDeferralService) is **already corrected in this review** — P4-05 only appends the new monitoring services (AlertRuleEngine, RetentionService, HealthCheckService) and the shutdown sequence to that list. — AGENTS.md now lists all nine background services incl. the three monitoring ones + the P1-09 Graceful Shutdown section; `src/services/monitoring/` rows added; monitoring test conventions block added; controller count 45.
- [x] Load sanity numbers recorded (doc + PR) with the partitioning decision made against the pre-agreed rule. — Numbers in doc §8; **decision rule triggered** (both arms) → follow-up filed: `.issues/medium/provider-call-logs-partitioning.md`.
- [x] Proposal doc marked implemented with a delta list (anything that changed vs the original design). — Status header flipped; §7 "Implementation status & deltas" added (open-question answers + 10 deltas).
- [x] Full e2e suite green. — run after all P4-05 changes.

## Implementation notes (2026-08-21)

1. **§4/§9 scope adjustment (user decision 2026-08-20):** P3-05 (outbound channel fallback) and P4-03 (webhook dead-letter) were **closed as out of v1 scope** after/before implementation. The spec's original §4 ("outbound channel fallback, webhook dead-letter + replay") and §9 ("webhook dead-letter — when to replay vs discard") requirements were therefore replaced with: §4 "Not in v1 (deliberately closed)" subsection documenting both closures + what still exists (channel providers are instrumented/alerted; outbound alert-webhook delivery trail in `alert_events.notifications`), and §9 runbook "Did my alert get delivered?" covering the delivery-trail audit instead of dead-letter replay.
2. **Env var inventory (spec list corrected):** `MONITORING_EMAIL_TO` was missing from the spec's list — it is read by the first-boot email-notifier seed (both `MONITORING_EMAIL_PROVIDER_ID` + `MONITORING_EMAIL_TO` are required together) and is documented in both example files. Also added (not in the spec's list): `MONITORING_HEALTH_PROBES` (hard kill switch, P1-05b) and `MONITORING_ALERT_ENGINE_INTERVAL_MS` (env override for the engine tick). Full set of 11: `MONITORING_METRICS_TOKEN`, `MONITORING_HEALTH_INTERVAL_MS`, `MONITORING_HEALTH_PROBES`, `MONITORING_ALERT_ENGINE_INTERVAL_MS`, `MONITORING_CALL_LOG_BUFFER_SIZE`, `MONITORING_MEMORY_THRESHOLD_MB`, `MONITORING_WEBHOOK_URL`, `MONITORING_EMAIL_PROVIDER_ID`, `MONITORING_EMAIL_TO`, `MONITORING_RETENTION_DAYS`, `SHUTDOWN_GRACE_MS`.
3. **Deliberately NOT documented:** `METRIC_FLUSH_INTERVAL_MS` — it is a hardcoded constant in `MetricsRegistry.ts` (60 s), **not** an env var; putting it in the examples would create an orphan (violates the no-orphans AC).
4. **Load sanity results (throwaway script `tests/tmp-p405-load.ts`, deleted after run):** Phase A — 100 conversations × 3 provider calls (LLM/TTS/ASR) through the real `CallLogger` over 60 s: 300 rows, 4.54 rows/s, buffer peak 27 (threshold 200, cap 10,000), 11 flushes on the 5 s timer, max inter-flush gap 5.0 s, 0 dropped. Phase B — 100× projection: one hour bucket = 1,635,744 rows bulk-inserted, `ANALYZE`, then `EXPLAIN (ANALYZE, BUFFERS)` of the exact `RetentionService` rollup SQL: **execution time 5,371 ms** (seq scan of the whole in-window table + disk-spilled `percentile_cont` sorts — the literal worst case, whole table inside the 1 h window; with realistic spread over the 90 d retention the window is a small indexed slice). 100× daily projection: **39,257,857 rows/day**.
5. **Decision rule outcome: TRIGGERED — both arms** (39.3 M > 5 M daily rows AND 5.37 s > 5 s rollup) → partitioning follow-up filed as `.issues/medium/provider-call-logs-partitioning.md` (time partitioning, partition-based purge, re-measure at 100×). Doc §8 records the numbers + the practical revisit trigger (≈100× current volume).
6. **Extraction gotcha hit (script-level):** node-postgres EXPLAIN results key plan lines under `QUERY PLAN`, not `?column?` — the throwaway script's parser needed the former.
7. **Docs:** `docs/guide/monitoring.md` (9 sections per spec, with the §4/§9 adjustments above) + sidebar entry under Operations (alongside the P4-04 frontend contract `monitoring-api.md`). No bare `{{ }}` outside fenced code blocks; no links out of the docs root (the partitioning issue is referenced as plain code text, per the VitePress dead-link rule).
8. **Proposal:** status header flipped to implemented; new §7 records the §6 open-question answers as shipped + 10 deltas (P3-05 closure, P4-03 closure, hybrid schema, ChannelNotifier consolidation, P1-05b probes, rule-catalog endpoint, /health/ready + heartbeats, changeGauge rename, partitioning follow-up, at-most-once delivery decision).

## Tests

- None new (docs/config issue). The load script itself is a throwaway dev artifact — keep it out of the repo unless it proves useful (then add under `scripts/` with a note).

## Out of scope

- Performance optimization (measure first, per the decision rule), Grafana dashboard JSON (nice-to-have follow-up), marketing docs.
