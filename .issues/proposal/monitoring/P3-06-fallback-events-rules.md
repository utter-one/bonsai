---
title: "P3-06 — `fallback_events` endpoint + failover alert rules"
severity: proposal
status: open
created: 2026-08-17
updated: 2026-08-20
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

## Implementation notes (2026-08-20)

Implemented against the P3-03/P3-04 failover data (P3-05's channel-fallback events will simply appear in the same endpoint/rules once that lands — nothing here depends on it). Deviations and decisions from the spec above:

1. **`provider-chain-exhausted` severity = `critical`** (per the spec table). Chosen defaults where the spec was open: `minSamples: 0`, `forMinutes: 0` (exhaustion is the worst case — no sustainment delay), `resolveAfterGoodChecks: 3`, `cooldownMinutes: 10`, `maxUnresolvedHours: 12`.
2. **Engine wiring — two soundness fixes found in analysis** (`src/services/monitoring/AlertRuleEngine.ts`):
   - `provider_chain_exhausted_total` had to be added to the engine's `WINDOWED_COUNTERS` whitelist: the delta ring only samples whitelisted counters, so without this the rule's `windowSum` would always read 0 and the rule could never fire.
   - The counter's `provider_id`-labeled series are swept into the per-provider evaluation set (new `PROVIDER_ID_COUNTERS` const, shared by `assembleData` and `perProviderScopeParts`) alongside `oauth_refresh_total`/`imap_poll_total`. A chain exhaustion on a single-provider chain — or one where every step was circuit-open — leaves no `fallback_events` row and no breaker state, so the provider would otherwise never enter the evaluation set and the rule would silently skip it. The metric is the source of truth (incremented in `exhaustChain()`).
3. **Chain-naming context**: `queryFallbackCounts` now returns `{ providerId, count, fallbackIds }` — total row count (unchanged semantics for `fallback-active`) plus the ordered distinct fallback ids per primary, ordered by first appearance in the window (CTE: `min(created_at)` per `(provider_id, fallback_provider_id)`, `array_agg` over it). Carried into `EvaluationData.fallbackChains: Map<string, string[]>`; the fallback ids are also swept into the provider-name lookup so messages use names. Note: the fallback query window is `max(10 min, rule windows)` — for rule windows under 10 min the chain context can include fallbacks older than the rule window (context only, never affects firing).
4. **Message upgrades**: `fallback-active` appends ` — fallbacks used: X, Y`; `provider-auth-failed` appends ` — failover chain: A → B` only when the window has fallback events; both now include `context.failoverChain` (the primary id, plus fallback ids when known). `provider-chain-exhausted` message: `<label> exhausted its failover chain N time(s) in the last X min (chain: A → B → C) — all providers in the chain failed or were circuit-open`, with `context: { providerId, exhausted, windowMinutes, failoverChain }`.
5. **Endpoint filters are a superset of the spec's list**: `id`, `providerId`, `fallbackProviderId`, `providerType`, `operation`, `reason`, `projectId`, `conversationId`, `success`, `createdAt` (all house-convention filterable); text search over `providerId`, `fallbackProviderId`, `operation`, `reason`.
6. **Actual changed files** (superset of the spec's "Modified files"): `AlertEvents.ts`, `AlertRuleEngine.ts`, `contracts/monitoring.ts`, `MonitoringService.ts` (new `listFallbackEvents`), `MonitoringController.ts`, plus tests.
7. **Pinned tests updated on purpose**: the rule-catalog e2e pins the exact id set (20 → 21 rules, `per_provider` scope count 12 → 13); the P2-04 RBAC matrix gained `GET /api/monitoring/fallback-events`; the P2-01 unit harness's fake `queryFallbackCounts` returns the new row shape (empty `fallbackIds`).
8. **Tests**: 11 unit (`tests/unit/monitoring/p3-06-fallback-rules.test.ts` — catalog defaults, fire/below-threshold/aged-out/threshold, chain naming, per-provider scoping regressions for `provider-auth-failed` + `fallback-active`); 4 e2e (`tests/e2e/fallback-events-rules.test.ts` — 401, empty-page shape, seeded rows with filters/text-search/pagination, and a forced exhaustion through the app-world `FailoverLlmProvider` with two 401 mock endpoints → live engine fires `provider-chain-exhausted:p306_a` as `critical` with the chain named, while the transition row is served by the new endpoint).
