---
title: "P1-08 — Read-only MonitoringController endpoints + `SYSTEM_MONITORING` permission"
severity: proposal
status: resolved
created: 2026-08-17
updated: 2026-08-19
assignee: ""
tags: [monitoring, spec, phase-1]
---

# P1-08 — Read-only MonitoringController endpoints + `SYSTEM_MONITORING` permission

- **Phase:** 1 — Instrumentation & health
- **Depends on:** P1-01 (tables), P1-02 (registry snapshot), P1-05 (health data), P1-06 (config service for retentionDays)
- **Blocks:** P2-04, P4-04
- **Estimate:** 1 dev-day

## Objective

Expose the Phase-1 data through the API in house style: six read-only endpoints under `/api/monitoring/*`, the new `system:monitoring` permission, and full OpenAPI docs. (Write endpoints land in P2-03; alerts/fallbacks endpoints in P2-03/P3-06.)

## Scope

### New files
- `src/http/controllers/MonitoringController.ts`
- `src/http/contracts/monitoring.ts` (extend if P1-06 already created it)

### Modified files
- `src/permissions.ts` — `SYSTEM_MONITORING: 'system:monitoring'`; grant to `super_admin` role (read for all roles? **No** — super_admin only in P1; role matrix finalized in P2-04)
- `src/server.ts` — `container.resolve(MonitoringController).registerRoutes(app)`
- `src/swagger.ts` (or wherever `getOpenAPIPaths` aggregates) — include the new controller

## Implementation requirements

Controller = `@singleton()`, `static getOpenAPIPaths(): RouteConfig[]`, `registerRoutes(router)`, `checkPermissions(req, [PERMISSIONS.SYSTEM_MONITORING])` at the start of every handler, `asyncHandler` wrappers, one-line loggers, services do the queries with `requirePermission(context, ...)` (defense in depth per AGENTS.md).

| Endpoint | Behavior |
|---|---|
| `GET /api/monitoring/health` | `HealthCheckService.getSnapshot()` — `{ checkedAt, checks: [{ name, status, latencyMs?, detail? }] }` |
| `GET /api/monitoring/health/history` | `listParamsSchema` (offset/limit/textSearch/orderBy/filters) + dedicated `check` (check name) and `status` filters over `health_checks`, newest first, paginated `{ items, total }` |
| `GET /api/monitoring/providers` | Per provider row: `{ id, name, providerType, apiType, probeStatus (from snapshot), rolling: { windowMinutes: 15, calls, okRate, p95DurationMs, topErrorCodes[] } }` — rolling from `provider_call_logs` |
| `GET /api/monitoring/provider-calls` | `listParamsSchema` + filters: `providerId`, `providerType`, `apiType`, `model`, `projectId`, `conversationId`, `ok` (bool), `errorCode`, `statusHttp`, `durationMs`, `fallbackProviderId`, `createdAt` (date range via the standard `filters[createdAt][op]=between&filters[createdAt][value][0]=…&filters[createdAt][value][1]=…` operators) + `textSearch` over operation/model/providerId/conversationId; returns rows with `metrics` (variant streaming fields) |
| `GET /api/monitoring/provider-stats` | Query: `from`, `to` (required, span ≤ 14 days), `groupBy: 'hour' | 'day'` (default hour), optional `providerId`, `operation`. One row per (bucket, providerId, operation). **All row values are recomputed from `provider_call_logs` over the window** (count/sum/min/max/stalled/rtf + `percentile_cont` percentiles, same expressions as the P1-06 rollup CTEs) — see Soundness review finding 1: the stats table cannot merge percentiles at either granularity and lacks the live partial hour. The hourly rollup stays the P2-01 rule surface. |
| `GET /api/monitoring/metrics` | Generic time series over `metric_samples` (PROPOSAL §3.6): query `name` (required), optional `labels` (exact-match jsonb filter), `from`/`to` (required), `step` (bucket granularity: `1m`/`15m`/`1h`, default `15m`) → `[{ bucket, count, sum, min, max }]` per label-set, oldest first. This is the JSON history surface P4-01's out-of-scope note points to; the Prometheus text format stays Phase 4 (`/metrics`, different route/auth). |

Contracts: every schema `.describe()`d, reusable sub-schemas get `.openapi('Name')` **before** `.optional()`/`.nullable()` (house rule). Response models named `*MonitoringResponse`/`*MonitoringListResponse`.

## Acceptance criteria

- [x] All six endpoints appear in Swagger UI (`/api-docs`) with correct schemas and 200/400/401/403 responses documented (no 404 — all six are collection-level endpoints, none by-id). — `MonitoringController.getOpenAPIPaths()` + 16 schemas registered in `src/swagger.ts`; `npm run build` (cli:generate) regenerated `cli/bundled/openapi.json` with the six paths.
- [x] Unauthenticated request → 401; authenticated non-super-admin → 403; super_admin → 200 with data. — e2e RBAC block loops all six endpoints (401 unauthed, 403 `viewer`, 200 super_admin).
- [x] Pagination + filtering behave per house conventions (verified against fixtures inserted in `beforeEach`). — health/history: pagination, status/check/checkName/createdAt-between filters; provider-calls: providerId/ok/errorCode filters + textSearch over operation/model/conversationId.
- [x] `provider-stats` returns correct aggregates for a synthetic dataset (cross-checked with a hand-written SQL in the test). — 6-row synthetic dataset across two hours: per-bucket count/sum/min/max, TTFT p50/p95/p99 (2500/3850/3970 via percentile_cont interpolation), stalled + RTF>1 counts, groupBy=day merge, providerId/operation filters, 400s (missing params, inverted window, >14-day span, bad groupBy).
- [x] Existing 636 e2e tests green. — Full gates after P1-08: `npm run build` 0, `npm run test:unit` 613 passing, `npm run test:e2e` 969 passing (949 + 20 new), `npm run test:integration` 35 passing.

## Tests

- **E2E** (`tests/e2e/monitoring-endpoints.test.ts`, 20 tests): RBAC loops (401/403/200 × 6 endpoints); health snapshot shape + persisted check names; health/history pagination + status/check/checkName/between filters; providers rolling window (hand-computed p95/okRate/topErrorCodes + inferred probe status after a 1-second health cycle) and empty-window case; provider-calls pagination/filters/textSearch/metrics-jsonb; provider-stats hourly + daily + filters + 400 windows; metrics series grouping, 1m/15m steps, exact label matching, 400 windows.

## Out of scope

- `GET/PUT /api/monitoring/config` (P2-03), alerts endpoints (P2-03), fallback events (P3-06), `GET /metrics` Prometheus text (P4-01 — different format/auth, separate route registered before the auth middleware).

## Soundness review (2026-08-17)

Findings from verifying this spec against the codebase before implementation (reconciled into the spec above):

1. **`provider-stats` recomputes everything from `provider_call_logs`, not the hourly rollup.** `provider_call_stats_hourly`'s PK includes `ok` + `errorCode`, so every (hour, provider, operation) spans multiple stats rows — and `percentile_cont` values cannot be merged across those sub-rows. The spec already conceded raw-log recomputation for `groupBy=day`; the same non-merge problem applies to `hour` (the response has no ok/errorCode dimension), and the **live partial hour** has no stats row at all (the rollup runs at the top of the hour for the previous hour), so a stats-driven row would be null for the current bucket. Decision: one query over the raw logs for the window — count/sum/min/max/stalled/rtf + the same percentile expressions as the P1-06 rollup CTEs (`ttftMs`/`maxChunkGapMs` via `metrics->>`, non-NULL-filtered CTEs) — one shape for both granularities, always correct. The window is bounded (`to - from ≤ 14 days`, else `ValidationError` → 400) to keep the raw scan cheap. `provider_call_stats_hourly` remains the P2-01 rule surface for long windows.
2. **No 404 on any of the six endpoints** — all are collection-level (no by-id routes). Acceptance criterion corrected: documented responses are 200/400/401/403.
3. **`super_admin` needs no role-matrix edit.** `ROLES.super_admin.permissions` is `Object.values(PERMISSIONS)` — adding `SYSTEM_MONITORING` to `PERMISSIONS` grants it automatically. viewer/developer/support/content_manager keep their explicit lists (no monitoring) → 403 in P1; P2-04 finalizes the matrix.
4. **`health/history` filter fields:** both `check` (spec wording) and `checkName` (house camelCase consistency with the response field) are accepted in the filter columnMap; `status` as spec. Default ordering `desc(createdAt)` (newest first). `latencyMs` is also filterable/orderable.
5. **`/providers` rolling window is computed entirely in SQL** (`created_at >= now() - interval '15 minutes'` — no JS Date parameters, P1-06 TZ lesson). `probeStatus` joins the in-memory `HealthCheckService.getSnapshot()` by check name `provider:<id>`; `null` when the snapshot has no check for the provider yet (e.g. provider added since the last cycle). `topErrorCodes` = up to 3 `[code, count]` pairs for failed calls in the window, count desc.
6. **`ok` filter on `provider-calls`:** plain boolean filter value → `eq` via `buildFilterCondition` (works); `errorCode` is NULL on success in the raw table (the rollup COALESCEs to 'none' — the raw endpoint filters explicit codes only). `textSearch` covers operation, model, providerId, conversationId.
7. **Dual-module-graph (P1-04 lesson):** e2e fixtures are inserted via direct `db` import (established pattern — the test-world `db` module instance connects to the same Postgres container). RBAC agents via the `createOperatorWithRole` + login pattern from `tests/e2e/rbac.test.ts`.
8. **`/metrics` time series:** `labels` query param is an object (`labels[provider_id]=...`, qs `allowDots`) → **exact** jsonb match (`labels = $::jsonb`); bucketing via epoch arithmetic (`to_timestamp((extract(epoch from bucket) / step)::bigint * step)`) since `date_trunc` has no 1m/15m granularity; series grouped by `labels::text`, points oldest first. Encoding is generic (counters=delta, gauges=(1,v,v,v), histograms=(Δc,Δs,min,max) per sample) — the consumer knows the metric kind from the registry; the endpoint just buckets/sums.
9. **Contracts extend `src/http/contracts/monitoring.ts`** (created by P1-06 for the config schema) — the spec's "extend if P1-06 already created it" branch. New response schemas are registered in `src/swagger.ts` (the aggregation point) alongside the controller's `registerPath` loop.
10. **`listParamsSchema.groupBy` (generic list grouping) is ignored** on `provider-calls`/`health-history` (same as every other house list endpoint); `provider-stats` uses its own dedicated query schema with `groupBy: 'hour' | 'day'` — different concept, different endpoint, no conflict.

Service layer: single `MonitoringService extends BaseService` in `src/services/monitoring/` with all six read methods (each starts with `this.requirePermission(context, PERMISSIONS.SYSTEM_MONITORING)` — defense in depth per AGENTS.md); it injects `HealthCheckService` for the snapshot (no circular dependency — HealthCheckService does not inject it).

## Implementation (2026-08-17)

Files:

- `src/permissions.ts` — `SYSTEM_MONITORING: 'system:monitoring'` added to the System permissions (super_admin inherits it via `Object.values(PERMISSIONS)`).
- `src/http/contracts/monitoring.ts` — P1-08 endpoint schemas appended (health snapshot/history, providers overview, call logs list, stats query/response, metric series query/response) with the named OpenAPI components.
- `src/services/monitoring/MonitoringService.ts` (new) — six read methods; `listParamsSchema` house pattern (columnMap/buildFilterCondition/buildTextSearchCondition/buildOrderBy/countRows/normalizeListLimit) for the two list endpoints; raw-SQL aggregation for `/providers` rolling window, `provider-stats` (base/main_agg/ttft_agg/gap_agg CTEs mirroring the P1-06 rollup) and `/metrics` (CTE + epoch bucketing); `assertWindow` (non-empty, ≤14 days) for both windowed endpoints; responses validated through the contract schemas.
- `src/http/controllers/MonitoringController.ts` (new) — `@singleton()`, `getOpenAPIPaths()` + `registerRoutes()`, `checkPermissions(req, [PERMISSIONS.SYSTEM_MONITORING])` in every handler, `asyncHandler` wrappers.
- `src/server.ts` — controller registered after AuditController (authenticated section, inside the rate limiter).
- `src/swagger.ts` — 16 monitoring schemas + 6 paths registered.
- `tests/e2e/monitoring-endpoints.test.ts` (new, 20 tests).

Implementation findings (pitfalls hit and fixed during implementation — kept for P2-03 and future raw-SQL work):

1. **Postgres `ORDER BY` alias collision (42803):** an output alias with the same name as a source column (`bucket`) makes `ORDER BY bucket` resolve to the **source column**, which is not in the GROUP BY → error. Use a distinct alias (`bucket_epoch`).
2. **Parameterized GROUP BY expressions are not identity-proven:** repeating `((extract(epoch from bucket) / $1)::bigint) * $2` in both SELECT and GROUP BY fails in prepared statements because `$1` and the GROUP-BY-side parameter are opaque to the planner. Compute the expression once in a CTE and GROUP BY the CTE column. (The `provider-stats` CTE structure was already safe: the `date_trunc(${granularity}, …)` parameter lives only in the `base` CTE.)
3. **pg returns `bigint` columns as strings** — `COUNT(*)::bigint` / `SUM(...)::bigint` must be `Number()`-coerced in JS before Zod validation (the e2e caught this as a 400 with `expected number, received string`).
4. **`HealthCheckResult.latencyMs`/`detail` are optional (undefined), not null**, for unmeasured checks (service heartbeats, inferences) — the health item schema must be `.nullable().optional()`; JSON serialization then drops absent fields entirely.
5. **`percentile_cont` is float arithmetic** — hand-computed expected values (e.g. 3850) come back as 3849.9999…; assert with `closeTo(…, 1e-6)`.
6. **`between` filters from query params** use the house `filters[field][op]=between&filters[field][value][0]=…&filters[field][value][1]=…` form (qs parses the `value` array); `filters[field][between]=a,b` fails Zod (object without `op`).
7. **Test-env provider status is inferred** (`MONITORING_HEALTH_PROBES=off`): a provider with a recent successful call log flips its `provider:<id>` check to `ok` within one 1-second cycle — asserted in the e2e; no probe traffic contaminates the `provider_call_logs` fixtures.

Gates: `npm run build` 0, unit 613, e2e 969 (949 + 20), integration 35.
