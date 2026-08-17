---
title: "P4-05 — Docs, env examples, AGENTS.md, load sanity check"
severity: proposal
status: open
created: 2026-08-17
updated: 2026-08-17
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

- [ ] `docs/guide/monitoring.md` renders in the VitePress build (`npm run build --prefix docs` — there is no root `docs:build` script; no bare-brace build breakage).
- [ ] Every env var used by monitoring code appears in both `.env.example` and `compose/env.example` with a default; every env var in the examples is actually read by code (no orphans).
- [ ] AGENTS.md matches the shipped code (module, services, tables, endpoints, test conventions). The stale "Background services" section (it said two; `server.ts` starts six: ConversationTimeoutService, ScenarioRunExecutorService, BenchmarkExecutorService, ImapInboundService, OAuth2TokenRefreshService, ProcessingDeferralService) is **already corrected in this review** — P4-05 only appends the new monitoring services (AlertRuleEngine, RetentionService, HealthCheckService) and the shutdown sequence to that list.
- [ ] Load sanity numbers recorded (doc + PR) with the partitioning decision made against the pre-agreed rule.
- [ ] Proposal doc marked implemented with a delta list (anything that changed vs the original design).
- [ ] Full e2e suite green.

## Tests

- None new (docs/config issue). The load script itself is a throwaway dev artifact — keep it out of the repo unless it proves useful (then add under `scripts/` with a note).

## Out of scope

- Performance optimization (measure first, per the decision rule), Grafana dashboard JSON (nice-to-have follow-up), marketing docs.
