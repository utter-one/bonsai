---
title: "P3-06 — `fallback_events` endpoint + failover alert rules"
severity: proposal
status: open
created: 2026-08-17
updated: 2026-08-17
assignee: ""
tags: [monitoring, spec, phase-3]
---

# P3-06 — `fallback_events` endpoint + failover alert rules

- **Phase:** 3 — Failover
- **Depends on:** P3-03, P3-04, P3-05 (event producers), P2-01 (rule engine)
- **Blocks:** P4-04
- **Estimate:** 0.5 dev-day

## Objective

Close the loop on Phase 3: the fallback history is queryable through the API, and the failover-signal rules are live against real Phase-3 data: `provider-chain-exhausted` (**new**, added here) plus `provider-auth-failed` and `fallback-active` — both already ship in P2-01's 20-rule default set (their Phase-3 data sources were inert until now); P3-06 verifies their per-provider scoping and adds chain-naming context to their messages.

## Scope

### Modified files
- `src/http/controllers/MonitoringController.ts` — new route
- `src/http/contracts/monitoring.ts` — schemas
- `src/services/monitoring/AlertEvents.ts` — one new default rule (`provider-chain-exhausted`) + message-context upgrades for the two existing Phase-3-dependent rules

## Implementation requirements

### `GET /api/monitoring/fallback-events`
- `listParamsSchema` + dedicated filters: `providerId`, `fallbackProviderId`, `providerType`, `success` (bool), `operation`; standard `createdAt` range filter; newest first; `{ items, total }`.
- Permission `system:monitoring` (same as the rest), service-level `requirePermission`.

### New default rules (added to the P2-01 rule set, same state machine)
| id | severity | condition |
|---|---|---|
| `provider-chain-exhausted` **NEW** | critical | ≥1 increment of `provider_chain_exhausted_total{provider_id}` in 5 min (metric is the source of truth; `fallback_events` rows in the window are used only for chain-naming context) |
| `provider-auth-failed` (existing, P2-01) | critical | ≥1 call-log row `error_code='auth'` for a provider in 5 min (deliberately NOT counted by the breaker — P3-01; this rule is the only reaction) |
| `fallback-active` (existing, P2-01) | info | ≥1 `fallback_events` row for a provider in 10 min (early signal — usually precedes `provider-down`; keep it `info` so it notifies but doesn't page) |
- Scope: per provider id (same per-provider evaluation pattern as `provider-down`).
- `provider-chain-exhausted` message names the primary provider and the full chain tried (from the fallback_events rows in the window).

## Acceptance criteria

- [ ] Endpoint returns fallback events with all filters + pagination per house conventions; 403/401 as with the rest of `/api/monitoring`.
- [ ] Unit: `provider-chain-exhausted` fires with synthetic metric increments and stays quiet below threshold; per-provider scoping regression for `provider-auth-failed` (provider A's auth failure does not alert provider B) and `fallback-active` (rows for A don't trigger B).
- [ ] E2E: synthetic `fallback_events` rows + a forced exhausted-chain scenario (two bogus providers, P3-03 e2e fixture) → `provider-chain-exhausted` alert event appears in `alert_events` with the chain named in the message.
- [ ] Existing suite green.

## Tests

- **E2E:** endpoint (fixtures + filters + RBAC), rule firing via synthetic data (engine test env: 1 s interval, tiny windows).
- **Unit:** `provider-chain-exhausted` with boundary data (exactly 1 increment, 0 increments, multi-provider windows) + per-provider scoping regression for the two existing rules.

## Out of scope

- Fallback analytics/dashboards (Console, P4-04), per-fallback SLA reporting.
