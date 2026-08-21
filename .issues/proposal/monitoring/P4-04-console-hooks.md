---
title: "P4-04 — Console monitoring page (cross-repo coordination)"
severity: proposal
status: open
created: 2026-08-17
updated: 2026-08-20
assignee: ""
tags: [monitoring, spec, phase-4]
---

# P4-04 — Console monitoring page (cross-repo coordination)

- **Phase:** 4 — Polish
- **Depends on:** P1-08, P2-03, P3-06 (all backend endpoints exist)
- **Blocks:** —
- **Estimate:** 0.5 dev-day (backend side; the UI itself lives in the `bonsai-console` repo and is tracked there)

## Objective

Prove the backend API surface is sufficient for a Console monitoring page, and hand the console team an exact endpoint contract. The UI (charts, tables, polling) is a separate repo and out of scope for this codebase — this issue is the backend sufficiency check + contract doc.

## Scope

### New files
- `docs/guide/monitoring-api.md` (or a section in P4-05's `docs/guide/monitoring.md`) — the console-facing contract: every endpoint, its params, response shape, and the recommended poll cadence.

### Modified files
- none in backend code **unless** the sufficiency check finds gaps (see requirements)

## Implementation requirements

Proposed Console page layout (input to the check):
1. **Overview**: health snapshot (per-check status chips) + firing alerts list + circuit breaker states.
2. **Providers**: table with rolling 15-min ok-rate/p95/error codes + streaming percentiles (TTFT p50/p95/p99 from `provider-stats`), per-provider detail view (call-log list filtered by `providerId`).
3. **Alerts**: history table (severity, scope, notifications trail, ack state) + ack button + config editor (notifiers, rule toggles).
4. **Fallbacks**: fallback-events table (transitions, success/fail).
5. **Webhook failures**: dead-letter list + replay/discard buttons.

Sufficiency check — for each panel, verify against the live API (scripted or manual against a dev instance):
- [x] All data available with ≤1 request per panel per poll (no client-side joining of >2 endpoints required). **Result: pass.** Every widget is ≤1 request; the overview panel as a whole is 3 requests (`/health`, `/providers`, `/alerts?filters[status]=firing`) with no cross-endpoint row joining — breaker state and rolling stats are already embedded in `/providers`, probe status is embedded in `/health`.
- [x] Pagination + filters support an infinite-scroll list (offset/limit + `createdAt` range). **Result: pass.** House `ListParams` (offset/limit default 100, max 1000) + `createdAt`/`firedAt` filters + `textSearch` on calls/alerts/health-history.
- [x] `GET /api/monitoring/providers` includes breaker state (P3-01). **Result: pass.** `circuitBreaker: { state, failuresInWindow, lastStateChangeAt, opensInLast24h } | null` per provider row (P3-01 merged).
- [x] Polling cost at 30 s cadence × 5 panels. **Result: pass.** EXPLAIN (ANALYZE, BUFFERS) on a testcontainer with 3k call-log rows: all 15-min-window queries sub-millisecond to ~1 ms on the `provider_call_logs` composite indexes; the 24 h `day`-grouped worst case is 4.4 ms (seq scan over the window — retention bounds it). Recommended cadences documented in the contract doc (health 15–30 s, alerts 30 s, stats on-demand, prefer `/metrics` pre-aggregates for recurring sparklines).
- [x] No endpoint leaks more than its RBAC role allows. **Result: pass, with a deviation from the spec's assumption** — see implementation notes (P2-04 restricted monitoring to `super_admin` only, not `developer` read access).

Gap found: panel 5 (webhook dead-letter list + replay/discard buttons) is **not covered by the current API** — delivery *attempts* are auditable inside `alert_events.notifications` (`ok`/`detail` per attempt), but the dead-letter store + replay/discard is P4-03 (already filed; no new P4-06+ issue needed).

## Acceptance criteria

- [x] Contract doc written with real response samples (captured from a running instance, redacted). → `docs/guide/monitoring-api.md` (VitePress, sidebar: Operations; all 13 endpoints with captured redacted samples).
- [x] Sufficiency checklist complete with results (each item ✅/gap-issued). → above; one gap, already covered by open P4-03.
- [x] Polling load estimate documented with the `EXPLAIN` evidence. → contract doc §6 (measured plans + guidance).
- [ ] Console repo receives the doc (link/PR reference recorded in this issue's PR description). → **pending handover**: the doc is in this repo (`docs/guide/monitoring-api.md`, rendered at `/guide/monitoring-api`); hand it to the console team / reference it in the PR description when the branch goes to `dev`.

## Tests

- None in the backend repo (no backend code changes expected). If a gap-fix lands, it carries its own tests per its issue.

## Out of scope

- All UI work (separate repo), WebSocket push to the console (polling is sufficient; push would be a new channel feature), per-operator console preferences.

## Implementation notes (2026-08-20)

1. **Deliverable location**: `docs/guide/monitoring-api.md` (the spec's first-choice filename), added to the VitePress sidebar under **Operations** (`/guide/monitoring-api`). VitePress build green. The file is deliberately **not** named `monitoring.md` — that filename is reserved for P4-05's operator guide.
2. **RBAC deviation**: the check assumed "console operators who are `developer` with read access, if enabled in P2-04". P2-04 did **not** grant `system:monitoring` to any role except `super_admin` (it asserts the other four roles must not have it). Consequence documented in the contract doc: the Console must gate the whole monitoring section on the `super_admin` role — every endpoint, including config read, is 403 for all other roles.
3. **Window caps**: both `provider-stats` and `metrics` enforce a **14-day max span** (`400` "Window too large") and `to` > `from` — documented in the contract doc.
4. **Data freshness numbers** (verified in code, not guessed): call logs flush ≤5 s (`CallLogger`), metric samples ≤60 s (`METRIC_FLUSH_INTERVAL_MS`), health snapshot per cycle (default 60 s, `MONITORING_HEALTH_INTERVAL_MS`), alert engine 1 tick (default 1 min), fallback events real-time, breaker state in-memory (reset on restart).
5. **EXPLAIN methodology**: fixture script booted the real app + testcontainer, inserted 3,000 call-log rows (3 h) + 30 alerts + 50 fallback events + 100 health checks + 120 metric samples, ran `ANALYZE`, then `EXPLAIN (ANALYZE, BUFFERS)` on each endpoint's actual query shape. Seq scans on the small tables are a fixture artifact (planner-correct at 30–120 rows); the composite indexes covering each access pattern are verified in `drizzle/0068_lively_rage.sql`. Temp fixture/sample scripts were throwaway and deleted.
6. **Sample capture**: all 13 endpoints exercised against the booted app with fixtures; the first capture round caught two fixture bugs of its own (wrong `notifications` shape → 400, and `/providers` needing real `providers` rows) — the shipped samples are the corrected round (all 200).
7. **Spec-status convention**: left `open` — the last acceptance criterion (console-repo handover) is a cross-repo step that happens with the PR to `dev`.
