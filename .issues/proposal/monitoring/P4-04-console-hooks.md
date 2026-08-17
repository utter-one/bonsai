---
title: "P4-04 — Console monitoring page (cross-repo coordination)"
severity: proposal
status: open
created: 2026-08-17
updated: 2026-08-17
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
- [ ] All data available with ≤1 request per panel per poll (no client-side joining of >2 endpoints required).
- [ ] Pagination + filters support an infinite-scroll list (offset/limit + `createdAt` range).
- [ ] `GET /api/monitoring/providers` includes breaker state (P3-01) — if not merged by the time this runs, note the gap and add it.
- [ ] Polling cost: at 30 s cadence × 5 panels, the resulting query load is acceptable (rough estimate: ≤10 simple indexed queries/30 s — verify with `EXPLAIN` that each hits an index; if `provider-stats` day-grouping recomputation is slow, document the recommended cadence per panel: overview 30 s, providers 60 s, lists 60 s).
- [ ] No endpoint leaks more than its RBAC role allows (console operators who are `developer` with read access, if enabled in P2-04, see read-only data only).

If a gap is found (missing filter, missing field, missing endpoint): **file it as a follow-up issue in `.issues/` (P4-06+)** with the exact contract delta — do not silently expand this issue.

## Acceptance criteria

- [ ] Contract doc written with real response samples (captured from a running instance, redacted).
- [ ] Sufficiency checklist complete with results (each item ✅/gap-issued).
- [ ] Polling load estimate documented with the `EXPLAIN` evidence.
- [ ] Console repo receives the doc (link/PR reference recorded in this issue's PR description).

## Tests

- None in the backend repo (no backend code changes expected). If a gap-fix lands, it carries its own tests per its issue.

## Out of scope

- All UI work (separate repo), WebSocket push to the console (polling is sufficient; push would be a new channel feature), per-operator console preferences.
