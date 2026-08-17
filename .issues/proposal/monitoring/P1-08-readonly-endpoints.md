---
title: "P1-08 — Read-only MonitoringController endpoints + `SYSTEM_MONITORING` permission"
severity: proposal
status: open
created: 2026-08-17
updated: 2026-08-17
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
| `GET /api/monitoring/provider-calls` | `listParamsSchema` + filters: `providerId`, `providerType`, `ok` (bool), `errorCode`, `conversationId`, `operation` + standard `filters[createdAt][between]` date range; returns rows with `metrics` (variant streaming fields) |
| `GET /api/monitoring/provider-stats` | Query: `from`, `to`, `groupBy: 'hour' | 'day'` (default hour), optional `providerId`, `operation`; aggregates `provider_call_stats_hourly` (day = sum over hours, percentiles recomputed via `percentile_cont` over the raw rows for that window when `groupBy=day` — **decision: recompute**, it's one CTE) |
| `GET /api/monitoring/metrics` | Generic time series over `metric_samples` (PROPOSAL §3.6): query `name` (required), optional `labels` (exact-match jsonb filter), `from`/`to` (required), `step` (bucket granularity: `1m`/`15m`/`1h`, default `15m`) → `[{ bucket, count, sum, min, max }]` per label-set, oldest first. This is the JSON history surface P4-01's out-of-scope note points to; the Prometheus text format stays Phase 4 (`/metrics`, different route/auth). |

Contracts: every schema `.describe()`d, reusable sub-schemas get `.openapi('Name')` **before** `.optional()`/`.nullable()` (house rule). Response models named `*MonitoringResponse`/`*MonitoringListResponse`.

## Acceptance criteria

- [ ] All six endpoints appear in Swagger UI (`/api-docs`) with correct schemas and 200/400/403/404 responses documented.
- [ ] Unauthenticated request → 401; authenticated non-super-admin → 403; super_admin → 200 with data.
- [ ] Pagination + filtering behave per house conventions (verified against fixtures inserted in `beforeEach`).
- [ ] `provider-stats` returns correct aggregates for a synthetic dataset (cross-checked with a hand-written SQL in the test).
- [ ] Existing 636 e2e tests green.

## Tests

- **E2E** (`tests/e2e/monitoring.test.ts`): per endpoint — 200 + shape with fixtures, 400 on bad params (invalid `groupBy`, bad filter op), 403 for `viewer`/`developer`/`support`/`content_manager` roles, 401 unauthed; pagination `offset/limit` boundaries; `orderBy=-createdAt` ordering.

## Out of scope

- `GET/PUT /api/monitoring/config` (P2-03), alerts endpoints (P2-03), fallback events (P3-06), `GET /metrics` Prometheus text (P4-01 — different format/auth, separate route registered before the auth middleware).
