---
title: "P1-04 — Request-outcome logging, requestId, API request metrics, pino redaction"
severity: proposal
status: open
created: 2026-08-17
updated: 2026-08-17
assignee: ""
tags: [monitoring, spec, phase-1]
---

# P1-04 — Request-outcome logging, requestId, API request metrics, pino redaction

- **Phase:** 1 — Instrumentation & health
- **Depends on:** P1-02
- **Blocks:** P2-01 (5xx/429 rules consume `api_requests_total`)
- **Estimate:** 0.5 dev-day

## Objective

Make API traffic observable: every request gets a `requestId`, an outcome log line (status, duration, operator), request metrics, and secrets stop appearing in logs.

## Scope

### New files
- `src/http/middleware/requestOutcome.ts`

### Modified files
- `src/server.ts` — register middleware (after `requestContextMiddleware`, before rate limiter so limiter rejections are also counted) + pino `redact` config
- `src/utils/logger.ts` — add `redact: { paths: ['req.headers.authorization', 'res.headers.authorization'], censor: '[REDACTED]' }`
- `src/http/middleware/errorHandler.ts` — include `req.id` in the unhandled-error log line

## Implementation requirements

1. **requestId**: generate uuid at the start of the request (honor an inbound `X-Request-Id` header if present), store on `req.id`, echo it in the `X-Request-Id` response header.
2. **Outcome log** on `res.on('finish')`: `{ requestId, method, route, status, durationMs, operatorId? }` — level: `error` for 5xx (with route + status), `warn` for 4xx, `debug` for 2xx/3xx (keeps stdout clean; incoming-request log line at info stays as-is and gains `requestId`).
3. **Metrics** via `MetricsRegistry`:
   - `api_requests_total{method, route_group, status_class}` — `route_group` = normalized express route pattern (e.g. `/api/conversations/:id`) falling back to first two path segments to keep cardinality bounded; `status_class` = `2xx|3xx|4xx|5xx`.
   - `api_request_duration_ms{method, route_group}` histogram.
4. **Skip** `/health`, `/health/ready` (registered before this middleware anyway) and `/metrics` (Phase 4, P4-01 — registered before this middleware; skipped by an explicit path check so the requirement holds even before P4-01 lands) — no metrics or logs for probe/scrape traffic.
5. **Pino redaction** of `Authorization` (request + response headers) in all log lines.

## Acceptance criteria

- [ ] Every API response carries `X-Request-Id`; log lines for the same request share it (incoming + outcome + errors).
- [ ] 5xx responses produce an `error`-level outcome line; `api_requests_total` and duration histogram increments verifiable via `MetricsRegistry.snapshot()` in tests.
- [ ] No `Bearer ...` token appears anywhere in logged output (add a unit/e2e assertion that greps captured logs for a known test token).
- [ ] Existing 636 e2e tests green.

## Tests

- **E2E:** make a request with `authed()`, assert `X-Request-Id` present and stable; drive a 500 (e.g. nonexistent route behind auth that throws — use an existing error path) and assert outcome log + metric; assert redaction with a captured pino stream.
- **Unit:** route_group normalization table.

## Out of scope

- Distributed tracing (no OpenTelemetry in this phase), per-operator quota accounting (that's the rate limiter's job, P1-07).
