---
title: "P4-01 — `GET /metrics` Prometheus exposition + token gate"
severity: proposal
status: open
created: 2026-08-17
updated: 2026-08-17
assignee: ""
tags: [monitoring, spec, phase-4]
---

# P4-01 — `GET /metrics` Prometheus exposition + token gate

- **Phase:** 4 — Polish
- **Depends on:** P1-02 (`MetricsRegistry.snapshot()`)
- **Blocks:** — (independent)
- **Estimate:** 0.5 dev-day

## Objective

Optional external observability hook: standard Prometheus text format from the in-memory registry, so a Grafana scrape can run with zero new infrastructure. Disabled by default; enabling it requires an explicit token.

## Scope

### New files
- `src/http/middleware/metricsEndpoint.ts` (or a small `MetricsController`)

### Modified files
- `src/server.ts` — register `GET /metrics` **before** the auth/rate-limit middleware (same placement as `/health` — it is not an API route, must not burn rate-limit budget or JWT)
- `.env.example`, `compose/env.example` — `MONITORING_METRICS_TOKEN`

## Implementation requirements

- Token gate: request header `Authorization: Bearer <MONITORING_METRICS_TOKEN>`. The token is read from `process.env` **per request** (not cached at startup) — allows rotation without restart and lets the e2e suite toggle the gate per-test without a second app instance.
  - env unset/empty → route **404** (endpoint effectively disabled; do not reveal it exists).
  - env set + missing/wrong token → **401** `{ error: 'unauthorized' }` (one pino warn per failure, rate-limited to avoid log flooding — reuse a simple in-memory throttle: max 10 warn logs/min).
- Exposition format (from `MetricsRegistry.snapshot()`):
  - counters: `# TYPE <name> counter` + one line per label-set.
  - gauges: `# TYPE <name> gauge`.
  - histograms: emit cumulative buckets `<name>_bucket{le="..."} <c>` + `<name>_sum` + `<name>_count` (standard Prometheus histogram semantics; `le="+Inf"` line included).
  - Metric/label names sanitized to `[a-zA-Z_:][a-zA-Z0-9_:]*` (registry already uses snake_case; label values escaped per spec: `\`, `"`, newline).
  - `# HELP` lines from a name→description map (define alongside the bucket configs in the registry, P1-02 territory — add the descriptions there if missing).
  - Always include `process_uptime_seconds`, `process_resident_memory_bytes` (gauges the registry already tracks or trivially added from `process`).
- Content-Type: `text/plain; version=0.0.4; charset=utf-8`.
- Response must be deterministic for the same snapshot (sorted names/labels) — testable.

## Acceptance criteria

- [ ] No env → 404 on `/metrics`.
- [ ] Env set → 401 without/wrong token (warn-throttled), 200 + `text/plain` exposition with correct token.
- [ ] Exposition parses with a Prometheus text-format parser (unit test with a reference parser, e.g. `prom-parse`, or hand-verified fixtures — **spec: hand-verified fixtures** to avoid a new dep; CI check via fixtures).
- [ ] `/metrics` traffic does not appear in `api_requests_total`, does not hit the API rate limiter, and does not appear in request outcome logs.
- [ ] Existing suite green.

## Tests

- **Unit:** exposition rendering (counters/gauges/histograms, escaping, sorting, HELP/TYPE lines), token gate logic (404/401/200), warn throttling.
- **E2E:** the three gate outcomes via supertest (env set per-test in a dedicated suite file).

## Out of scope

- Running a Prometheus server (user's infra), service discovery/scrape config docs beyond a one-liner in P4-05, `metric_samples`-backed historical queries here (that's the API, P1-08).
