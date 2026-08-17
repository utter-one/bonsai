---
title: "P1-02 — Error classification, CallLogger, MetricsRegistry, HeartbeatRegistry, MonitoringContext"
severity: proposal
status: open
created: 2026-08-17
updated: 2026-08-17
assignee: ""
tags: [monitoring, spec, phase-1]
---

# P1-02 — Error classification, CallLogger, MetricsRegistry, HeartbeatRegistry, MonitoringContext

- **Phase:** 1 — Instrumentation & health
- **Depends on:** P1-01
- **Blocks:** P1-03, P1-04, P1-05, P1-06, P1-07, P1-08, P1-09, P2-01, P4-01
- **Estimate:** 1.5 dev-days

## Objective

Build the five in-process building blocks everything else stands on (error classifier + four modules), all under a new `src/services/monitoring/` module. None of them may ever throw into a business code path — monitoring failures are logged and dropped.

## Scope

### New files
- `src/utils/errorClassification.ts`
- `src/services/monitoring/CallLogger.ts`
- `src/services/monitoring/MetricsRegistry.ts`
- `src/services/monitoring/HeartbeatRegistry.ts`
- `src/services/monitoring/MonitoringContext.ts`

### Modified files
- `src/server.ts` — start/stop the new singletons (start after secrets bootstrap; stop in the P1-09 shutdown hook — stub the stop call now)

## Implementation requirements

### `errorClassification.ts`
- `classifyThirdPartyError(err: unknown): { errorCode: ThirdPartyErrorCode; statusHttp?: number }` where `ThirdPartyErrorCode = 'auth' | 'rate_limited' | 'timeout' | 'server_error' | 'client_error' | 'network' | 'unknown'`.
- Classify by: HTTP status (401/403/404-with-key-semantics → `auth`; 429 → `rate_limited`; 5xx → `server_error`; other 4xx → `client_error`), SDK error shapes (OpenAI `APIError.status`, Anthropic, Twilio `TwilioRestApiError.statusCode`, FB Graph JSON `error.code`, AWS `__typeName`), Node network codes (`ETIMEDOUT`/`ECONNREFUSED`/`ECONNRESET`/`ENOTFOUND`/`EAI_AGAIN` → `network`; undici/fetch `TimeoutError` → `timeout`).
- Pure function, no I/O, fully unit-testable with fixture errors.

### `CallLogger.ts` (`@singleton`)
- `record(entry: ProviderCallEntry): void` — fire-and-forget; entry = all `provider_call_logs` columns minus id/created_at (see P1-01).
- In-memory bounded buffer (default 10_000 entries; env `MONITORING_CALL_LOG_BUFFER_SIZE`); flush every 5 s **or** at 200 entries (whichever first) as a single batched multi-row `INSERT`.
- Flush failure: keep buffered entries (bounded — drop oldest with a pino error), never throw, never block. Expose `lastFlushError?: Error` + `bufferSize` for the health snapshot (P1-05).
- Read `MonitoringContext` (below) automatically for `projectId`/`conversationId`/`operation` when not set explicitly on the entry.
- `flushNow(): Promise<void>` for graceful shutdown (P1-09).

### `MetricsRegistry.ts` (`@singleton`)
- API: `inc(name, labels?, value = 1)`, `setGauge(name, labels, value)`, `observe(name, labels, value)` (histograms use fixed per-metric bucket configs defined in one place).
- In-memory current state (counters with labels, gauges, histogram bucket counts) — this is also the read surface for the rule engine (P2-01) and the Prometheus exporter (P4-01): expose `snapshot(): MetricsSnapshot`.
- Every 60 s: flush deltas to `metric_samples` (batched insert, same failure policy as CallLogger).
- Label cardinality guard (two layers):
   - **Key allowlist:** label keys must come from a known set — `provider_id`, `provider_type`, `project_id` (used by `ai_turn_ttft_ms`), `operation`, `model`, `ok`, `error_code`, `scope`, `key_type`, `method`, `route_group`, `status_class`, `service`, `check`, `direction` (in/out — added by P1-03 for the Twilio voice media counters) — unknown keys: pino warn + drop. (Fix applied during implementation analysis: `provider_type`/`model`/`ok` were missing from the original list but are used by the proposal's own metrics — `provider_calls_total{provider_id, provider_type, operation, ok, error_code}`, `oauth_refresh_total{provider_id, ok}`, streaming histograms labeled by `model` — so the original list would have silently dropped them and broken downstream rules.)
   - **Series cap:** max 50 distinct label-sets per metric (pino warn + drop beyond), overridable per metric in the one-place bucket/series config: `ai_turn_ttft_ms` declares `maxSeries: 500` (it is intentionally labeled by `project_id` — the per-project histogram the proposal requires). `api_requests_total` / `api_request_duration_ms` are additionally capped at 200 distinct `route_group` values, with overflow normalized to `other` (bounded by the route count; the app registers 152 route patterns — cap raised 100 → 200 in P1-04 after the first-come-first-served cap was found to bucket ~50 real routes into `other`; ~150–300 routes × a handful of status classes still fits the `metric_samples` row budget at current scale).
- **Cardinality decisions (fixed during implementation analysis — keep in sync with `METRIC_CONFIGS` in `MetricsRegistry.ts`):**
   - **Closed metric registry** — metric names live in the one-place config map; unknown name → pino warn + drop (prevents typo'd metrics silently bloating `metric_samples`). A new metric in a later issue = one config line.
   - **Per-metric `maxSeries` overrides** — default 50 fits global metrics only; the design's per-provider/per-route metrics exceed it, so the config declares: `provider_calls_total` / `provider_call_duration_ms` = 2000, `api_requests_total` / `api_request_duration_ms` = 4000, streaming histograms = 1000, circuit/fallback per-provider metrics = 500 (`fallbacks_executed_total` = 1000, it is labeled by provider pairs). P1-03 adds the Twilio voice media entries to the same map: `active_voice_media_streams` (gauge), `voice_media_bytes_total` (counter), `voice_media_max_frame_gap_ms` (histogram, buckets 50…6400 ms).
   - **`messages_found` deliberately NOT in the allowlist** — PROPOSAL §3.2b's `imap_poll_total{provider_id, ok, messages_found}` would be an unbounded label; the metric records as `{provider_id, ok}` (P1-05's `imap-poll-failing` rule only reads `ok=false`); message counts live in the call-log `metrics.messagesFound` jsonb.
   - **Histogram → `metric_samples` row encoding** — one row per (series, flush) carrying the window aggregate `(count, sum, min, max)`; bucket distribution stays in-process only. The rule engine (P2-01) and Prometheus (P4-01) read the **live snapshot** for percentiles; historical percentiles are recomputed from raw `provider_call_logs` (same decision as P1-08's `provider-stats` groupBy=day). Matches the `metric_samples` schema and the P1-08 `/metrics` endpoint contract `[{ bucket, count, sum, min, max }]` exactly. Counters flush as deltas (`count`=Δ, `sum`=Δsum, min/max null); gauges write `(count=1, sum=value, min=max=value)` only when the value changed; histograms write `(Δcount, Δsum, windowMin, windowMax)` when Δcount > 0.
- `flushNow(): Promise<void>`.

### `HeartbeatRegistry.ts` (`@singleton`)
- `tick(service: string): void`, `lastRun(service): number | undefined`, `recordError(service): void`, `errorCount(service): number`, `staleServices(maxAgeMs): string[]`.
- `tick()` also sets the `background_service_last_run_ts{service}` gauge on `MetricsRegistry` (PROPOSAL §3.2b heartbeat metric) — one dependency, no new call sites.

### `MonitoringContext.ts`
- `AsyncLocalStorage`-based: `run<T>(ctx: { projectId?, conversationId?, stageId?, operation? }, fn): T` + `current(): MonitoringContextData | undefined`.
- Purpose: let instrumentation in provider bases (which don't know the conversation) read business context set by `ConversationRunner` / channel hosts (P1-03) without changing provider interfaces.

## Acceptance criteria

- [ ] All five modules exist, are `@injectable()`/`@singleton()` where applicable, and are started from `server.ts`.
- [ ] `CallLogger.record()` from a synchronous business path never throws and never awaits (callers don't see a promise).
- [ ] Buffer overflow drops oldest entries and logs exactly one pino error per flush failure.
- [ ] Metric flush writes rows to `metric_samples` verified in a unit/e2e test.

## Tests

- **Unit:**
  - classifier: fixture errors for each family (OpenAI 401/429/500, Twilio 400/401/429, FB Graph auth error, AWS, `ECONNREFUSED`, fetch timeout, unknown) → expected `errorCode`.
  - CallLogger: batching (flush at 200), bounded buffer under overflow, flush-failure retention, `flushNow` drains.
  - MetricsRegistry: inc/observe/setGauge math, label allowlist + cardinality guard, flush produces correct `metric_samples` rows.
  - HeartbeatRegistry: tick/staleness/error counting.
  - MonitoringContext: nested `run()` scoping.

## Out of scope

- Wiring real call sites (P1-03), any HTTP surface (P1-08), circuit breaker integration (P3-01 — designed as a CallLogger hook so it can subscribe to outcomes later).
