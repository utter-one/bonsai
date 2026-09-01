---
title: "P4-01 — `GET /metrics` Prometheus exposition + token gate"
severity: proposal
status: resolved
created: 2026-08-17
updated: 2026-08-20
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

- [x] No env → 404 on `/metrics`.
- [x] Env set → 401 without/wrong token (warn-throttled), 200 + `text/plain` exposition with correct token.
- [x] Exposition parses with a Prometheus text-format parser — implemented as **hand-verified fixtures** per the spec's stated choice (no new dep).
- [x] `/metrics` traffic does not appear in `api_requests_total`, does not hit the API rate limiter, and does not appear in request outcome logs (e2e asserts the `api_requests_total` delta is 0).
- [x] Existing suite green (gates: unit 886, e2e 1049, tsc clean, build clean — see implementation notes).

## Tests

- **Unit:** exposition rendering (counters/gauges/histograms, escaping, sorting, HELP/TYPE lines), token gate logic (404/401/200), warn throttling.
- **E2E:** the three gate outcomes via supertest (env set per-test in a dedicated suite file).

## Out of scope

- Running a Prometheus server (user's infra), service discovery/scrape config docs beyond a one-liner in P4-05, `metric_samples`-backed historical queries here (that's the API, P1-08).

## Implementation notes (2026-08-20)

1. **Handler location:** `src/http/middleware/metricsEndpoint.ts` exports `createMetricsHandler()`; `server.ts` registers `app.get('/metrics', ...)` directly after `/health/ready`, before `requestOutcomeMiddleware` — so it bypasses auth, rate limiting, outcome metrics and logs by route order (not by skip list).
2. **`SKIPPED_PATHS` already contained `/metrics`** (P1-04 reserved it) — no change needed there.
3. **Descriptions:** `MetricConfig` gained an optional `description` field; the actual descriptions live in a new exported `METRIC_DESCRIPTIONS` map in `MetricsRegistry.ts` (alongside `METRIC_CONFIGS`), covering all 33 registered metrics. The exporter falls back: `METRIC_CONFIGS[name].description` → `METRIC_DESCRIPTIONS[name]` → process-metric descriptions → 'No description available.'
4. **Histograms:** registry buckets are **non-cumulative** per `(prev, bound]` with a final `+Inf` slot; the exporter accumulates them into Prometheus cumulative `le` buckets plus `_sum`/`_count`.
5. **Process gauges** (`process_uptime_seconds`, `process_resident_memory_bytes`) are injected at render time from `process.uptime()` / `process.memoryUsage().rss` — not stored in the registry.
6. **Token check:** length-guarded `crypto.timingSafeEqual`; `Bearer` scheme matched case-insensitively. Token read from `process.env` per request.
7. **Content-Type:** Express re-serializes the header (parameters come back as `text/plain; charset=utf-8; version=0.0.4` — order differs, parameter set identical). Prometheus scrapers parse parameters order-insensitively; e2e asserts type + both parameters, not the exact string.
8. **Throttle:** `AuthFailureThrottle` is a fixed-window limiter (10/min default) with an injectable clock; unit-tested standalone.
9. **No OpenAPI entry** — like `/health`, `/metrics` is not an API route.
10. **Tests:** 14 unit (`tests/unit/monitoring/p4-01-metrics-endpoint.test.ts` — rendering incl. cumulative buckets/escaping/sanitization/sorting, gate outcomes via stub req/res, throttle) + 5 e2e (`tests/e2e/metrics-endpoint.test.ts` — the three gate outcomes + structural determinism + `api_requests_total` delta = 0).
11. **Gates:** unit 886, e2e 1049, tsc clean, build clean.
