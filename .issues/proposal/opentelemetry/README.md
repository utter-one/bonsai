---
title: "OpenTelemetry Integration — Feasibility Report & Plan"
severity: proposal
status: open
created: 2026-08-21
updated: 2026-08-21
assignee: ""
tags: [monitoring, opentelemetry, spec, index]
---

# OpenTelemetry Integration — Feasibility Report & Plan

Feasibility assessment for adding [OpenTelemetry (OTel)](https://opentelemetry.io) to the monitoring
stack shipped on branch `advanced-monitoring` (24 specs, all resolved/closed — see
`MONITORING-SPECS-AUDIT-REPORT.md` in `../monitoring/`). All ecosystem facts below were verified
against npm/GitHub on **2026-08-21**.

## Verdict

**Feasible — with one important recommendation.** Adding OTel is technically unblocked: the JS SDK
supports our runtime (Node 24 ≥ `>=20.6.0` requirement), Express 5 is supported by
`instrumentation-express` since 0.62.0, our `openai ^6.15.0` client is covered by
`instrumentation-openai` ≥ 0.19.0, and everything runs in-process — consistent with the project's
zero-new-infrastructure constraint (an OTLP collector is an optional operator-side choice, exactly
like the existing token-gated `/metrics` scrape).

**The one caveat:** *auto*-instrumentation under `tsx`/ESM has documented loader-hook conflicts
(partial instrumentation reported with tsx-like loaders). The plan therefore makes **manual
instrumentation at the seams we already instrument** (P1-03's provider-call recorder, request-outcome
middleware, ConversationRunner) the primary path, and demotes auto-instrumentation (http/express/pg)
to an optional Phase-0 spike. No architectural blocker; no change to existing surfaces is required.

**Recommended scope (what OTel adds that we do not have today):**

1. **Distributed tracing** — the real gap. We have per-call rows (`provider_call_logs`) and
   aggregates (metrics), but no per-turn span tree. OTel gives: one trace per conversation turn
   (HTTP/WS entry → context transform → LLM/classifier/tool spans → TTS/ASR), per-phase timing
   (TTFT, chunk cadence, finish) as span attributes/events, W3C `traceparent` propagation for
   clients, and export to any standard backend (Grafana Tempo, Honeycomb, Datadog, …).
2. **GenAI semantic conventions** — our LLM/ASR/TTS spans can adopt the emerging GenAI span
   conventions (`gen_ai.inference.client` et al.), making traces readable by standard GenAI tooling.
   Note these conventions are in flux (moved to a dedicated repo in 2026, stability *development*) —
   see §6 Risk 2.
3. **Log correlation** — `trace_id`/`span_id` in every pino line (additive to the existing
   `X-Request-Id`), so a slow turn found in traces drills into logs in one click.
4. **OTLP metrics export (optional, later phase)** — mirror the existing metric registry to OTel
   instruments for OTLP push; the in-memory registry + Postgres history + alert engine stay the
   source of truth (see §3 Option C / Phase 3).

**What OTel does NOT replace:** the Postgres-backed history (`provider_call_logs`, `metric_samples`,
`health_checks`, `alert_events`, `fallback_events`), the alert rule engine (reads in-memory snapshots
+ Postgres windows — an OTel-native rule engine does not exist in the JS ecosystem), the
token-gated Prometheus `/metrics` endpoint, or the failover/circuit-breaker machinery.

## 1. What we have today (constraint surface)

All of the following is implemented, tested (unit 886 / e2e 1049 / integration 35 green), and must
keep working unchanged:

| Surface | Implementation | Relevance to OTel |
|---|---|---|
| In-memory metric registry | `MetricsRegistry` (`src/services/monitoring/MetricsRegistry.ts`) — closed registry `METRIC_CONFIGS`, counters/gauges/histograms, cardinality guards, 60 s delta flush to `metric_samples` | The alert engine and `/metrics` read this. OTel metrics (if added) must **mirror**, not replace. |
| Prometheus scrape | `GET /metrics` (`src/http/middleware/metricsEndpoint.ts`, registered `src/server.ts:191` before auth) | Stays. OTel's `exporter-prometheus` would be a *second*, redundant pull surface — not needed. |
| Alert rule engine | `AlertRuleEngine` — 21 rules, anti-flap state machine, in-memory delta ring (`WINDOWED_COUNTERS`), Postgres windows | Unchanged. No OTel-native JS rule engine exists; do not attempt to port rules to OTel. |
| Row-level call history | `CallLogger` → `provider_call_logs` (16 flat columns + `metrics` jsonb), recorded through the single sync seam `ProviderCallRecorder.record()` (`src/services/monitoring/ProviderCallRecorder.ts`) | This seam is where OTel spans attach (§4). |
| Streaming phase measurement | `StreamStats` per call (TTFT, chunks, chunk gaps, RTF, final latency, finish reason, tokens) | Maps 1:1 to GenAI span attributes (`gen_ai.response.time_to_first_chunk`, usage, finish reasons). |
| Health checks + heartbeats | `HealthCheckService` (60 s) + `HeartbeatRegistry`, `GET /health/ready` | Unchanged. (OTel has no equivalent product surface.) |
| Error classification | `src/utils/errorClassification.ts` → `THIRD_PARTY_ERROR_CODES` | Source for span `error.type` attributes — reuse, don't re-derive. |
| Request outcome + requestId | `requestOutcomeMiddleware` (`src/server.ts:196`), `X-Request-Id`, pino redaction | Extend with a server span + trace context; keep `X-Request-Id` (additive `traceparent`/`trace_id`). |
| Graceful shutdown | `src/utils/shutdown.ts` — ordered: services → connections → monitoring buffer flush (bounded) → `endPool()` | OTel `TracerProvider.shutdown()` / `MeterProvider.forceFlush()` slot in before buffer flush (spans need no DB). |
| Test hermeticity | `tests/setup.ts` pins env (`MONITORING_HEALTH_PROBES=off`, rate limits, silent logs); no external infra | OTel must be a **no-op by default in tests** (`OTEL_ENABLED=false`); the OTel SDK's global no-op providers make this free. |

Runtime facts: Node 24.x, ESM (`"type": "module"`), tsx 4.21 (dev + prod start), Express 5.2.1,
pino 10, tsyringe DI, `openai ^6.15.0` plus Anthropic/Mistral/Google/AWS/Azure/soniox/twilio SDKs.

## 2. Ecosystem state (verified 2026-08-21 via npm + GitHub)

| Package | Version | Note |
|---|---|---|
| `@opentelemetry/api` | 1.9.1 | Stable API layer — the only dep business code imports. |
| `@opentelemetry/sdk-trace-node` / `sdk-metrics` / `resources` | 2.10.0 | 2.x line; engines `^18.19.0 \|\| >=20.6.0` → **Node 24 OK**. |
| `@opentelemetry/sdk-node` (umbrella) | 0.221.0 | Still 0.x (experimental umbrella); same Node engines. |
| `@opentelemetry/exporter-trace-otlp-http` / `-metrics-otlp-http` | 0.221.0 | HTTP/protobuf OTLP push; endpoint via `OTEL_EXPORTER_OTLP_ENDPOINT`. |
| `@opentelemetry/exporter-prometheus` | 0.221.0 | "experimental package under active development" — starts its own HTTP server; **not needed** (we have `/metrics`). |
| `@opentelemetry/instrumentation-express` | 0.69.0 | **Express 5 support since 0.62.0** (2026-03-25). |
| `@opentelemetry/instrumentation-http` / `-fetch` / `-dns` | 0.221.0 / 0.221.0 / 0.64.0 | Core HTTP/DNS coverage (optional under tsx — §8 Risk 1). |
| `@opentelemetry/instrumentation-pg` | 0.73.0 | Drizzle runs on pg — pg spans optional (DB is already covered by health checks + `db-down` rule). |
| `@opentelemetry/instrumentation-openai` | 0.19.0 | Supports `openai >=4.19.0 <7` → **our v6 client covered**; covers only the `openai` package (not Anthropic/Mistral/etc. — those get manual spans). |
| `@opentelemetry/semantic-conventions` | 1.43.0 | **Exports zero `GEN_AI_*` constants** — they were moved out of the main semconv repo (verified by inspecting the package). GenAI attribute names must be string constants (§8 Risk 2). |
| GenAI semantic conventions | repo `open-telemetry/semantic-conventions-genai` | Dedicated repo (2026). Core span `gen_ai.inference.client` (name: `{gen_ai.operation.name} {gen_ai.request.model}`), required `gen_ai.provider.name` + `gen_ai.operation.name`; recommended `gen_ai.request.model`, `gen_ai.usage.input/output_tokens` (+cache/reasoning variants), `gen_ai.response.finish_reasons`, **`gen_ai.response.time_to_first_chunk` (streaming)**, `gen_ai.request.stream`, `gen_ai.conversation.id`; plus `embeddings`, `retrieval`, `invoke_agent`, `execute_tool`, `invoke_workflow`, `plan` spans; provider refinements for OpenAI/Anthropic/Bedrock/Azure. **Stability: development** — all of it. No official JS package published yet (npm 404). |

Other verified facts:

- **Exemplars (metric↔trace correlation) are NOT supported by the JS metrics SDK**
  (spec-compliance matrix: `-`). Correlation strategy: shared low-cardinality attributes
  (e.g. `conversation_id`) on both metrics and spans, not exemplars.
- **ESM auto-instrumentation** requires loader hooks (`--experimental-loader=@opentelemetry/instrumentation/hook.mjs`
  / `module.register`); tsx-compatible loaders have reported **partial instrumentation**
  (dd-trace-js issue #5882, OTel issue #4553 class of problem). Manual instrumentation avoids the loader entirely.
- Bootstrap pattern for ESM: `node --import ./telemetry.js` (registers providers before app code runs) —
  or in-app init at `createApp()` start (simpler for us; loses only pre-`createApp` spans, which we have none of).

## 3. Options considered

| Option | Description | Verdict |
|---|---|---|
| **A. Traces-only, manual instrumentation** (recommended v1) | OTel TracerProvider + OTLP/HTTP exporter; manual spans at existing seams (HTTP entry, conversation turn, provider calls w/ GenAI attrs, channel sends); log correlation; no metrics changes. | ✅ **Recommended.** Smallest delta, biggest value (the span tree), zero risk to alerting/history, no dual metric maintenance. |
| **B. OTel replaces our metrics stack** | Port `METRIC_CONFIGS` to OTel instruments, alert engine reads OTel views/delta rings. | ❌ Rejected. The alert engine's windowed-counter delta ring + Postgres windows are product surface; JS OTel has no rule engine, no exemplars, and the closed-registry cardinality guards would have to be re-implemented. High cost, no functional gain. |
| **C. A + metrics bridge** (recommended v2, optional) | After traces prove out: mirror `METRIC_CONFIGS` as OTel instruments (single definition source → two sinks), OTLP metrics push for backends that want it. | ✅ Defer to Phase 3. Keep the in-memory registry authoritative; OTel gets a mirror. Dual-write is the only design that respects both surfaces. |
| **D. Auto-instrumentation only** (`auto-instrumentations-node`, zero code) | One dep + `--import` bootstrap; spans for http/express/pg/dns/openai out of the box. | ⚠️ Only as a Phase-0 spike. tsx/ESM loader conflicts make coverage unreliable; we'd miss the high-value app spans (turn lifecycle, GenAI phases) that auto-instrumentation can't see anyway. |

## 4. Phased plan

Phases are independently shippable and each maps to one spec in this folder. Total estimate:
**~6–8 dev-days** (Phase 0 spike included), with Phase 3 optional.

### Phase 0 — tsx/ESM spike (go/no-go, ~0.5 day, throwaway)

Throwaway script + a disposable OTLP collector (docker `otel/opentelemetry-collector`) to prove,
in our exact runtime (`tsx src/index.ts`, ESM, Node 24):

1. In-app `NodeTracerProvider` init at `createApp()` + `BatchSpanProcessor` +
   `OTLPTraceExporter` exports a synthetic span end-to-end.
2. **Stretch:** whether `--experimental-loader=@opentelemetry/instrumentation/hook.mjs` +
   `instrumentation-http`/`instrumentation-express` actually produces spans **under tsx** (if yes,
   Phase 2 may use them for the HTTP layer; if partial/absent, manual spans — the plan works either way).
3. Overhead sanity: span volume per conversation turn, memory delta with `BatchSpanProcessor`
   defaults (512 maxQueueSize / 5 s schedule).

Exit criteria recorded in the spike notes; spike code deleted (house pattern: throwaway scripts are
removed after results are recorded, cf. P4-05 load sanity).

### Phase 1 — SDK bootstrap (`OTEL-01`)

- New module `src/services/monitoring/otel/`:
  - `telemetrySetup.ts` — reads env, builds `Resource` (service.name = `bonsai-backend`,
    service.version from package.json, `OTEL_RESOURCE_ATTRIBUTES` passthrough), `TracerProvider`
    (`BatchSpanProcessor` + `OTLPTraceExporter`, protocol/endpoint/headers from standard `OTEL_*`
    env), optional `MeterProvider` (Phase 3) — all behind `OTEL_ENABLED` (default `false`).
  - `TelemetryService` (`@singleton`) — `start()`/`stop()`; exposes `tracer(name)` + `isTracing()`;
    when disabled, returns the global **no-op** tracer (zero allocation in hot paths beyond one
    cached object; verified in a unit test asserting no exporter activity when disabled).
  - `genaiAttrs.ts` — string constants for the GenAI attribute names we use, **pinned to
    semantic-conventions-genai revision (date-stamped comment)**; single place for renames.
- Wiring: `server.ts` starts it next to `MetricsRegistry`/`CallLogger` (line ~415); `src/index.ts`
  shutdown sequence calls `stop()` (→ `provider.shutdown()`, bounded 5 s like the other flushes)
  **before** monitoring buffer flush (spans need no DB) — new slot in `src/utils/shutdown.ts`.
- Env (both `.env.example` + `compose/env.example`, documented in `docs/guide/monitoring.md` new §10):
  `OTEL_ENABLED` (bool, default `false`), `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`,
  `OTEL_TRACES_SAMPLER`/`OTEL_TRACES_SAMPLER_ARG` (default `parentbased_always_on`),
  `OTEL_RESOURCE_ATTRIBUTES`, `OTEL_SERVICE_NAME` (default `bonsai-backend`),
  `OTEL_SPAN_STREAM_EVENTS` (bool, default `false` — streaming chunk events, §6 Risk 4).
- `tests/setup.ts`: `OTEL_ENABLED=false` (hermetic invariant); unit test: enabled-in-test mode with an
  in-memory span exporter produces expected spans; disabled mode produces none.
- Docs: AGENTS.md background-services + env sections; proposal README + operator guide updated.
- **DoD:** gates green; startup logs one line when enabled (endpoint + sampler), none when disabled.

### Phase 2 — Tracing (`OTEL-02`) — the value phase

Manual spans at the seams we already instrument (reuse `requestId`/`MonitoringContext` plumbing):

1. **HTTP server span** — in `requestOutcomeMiddleware`: start span per request
   (name `METHOD {route_group}`, attributes `http.request.method`, `url.path` (templated, not raw —
   cardinality), `http.response.status_code`, `request_id`; status from outcome; `error.type` from
   the classifier for 5xx). Inbound `traceparent` honored automatically by the context extractor.
   If the Phase-0 spike proved `instrumentation-express` works under tsx, use it instead and keep
   `requestOutcome` for the metrics side (dedupe: exactly one server span per request, asserted in e2e).
2. **Conversation turn span** — `ConversationRunner` turn lifecycle: span per processed user input
   (`conversation.turn`, attributes: conversation/project/stage ids, channel); children: context
   transform, classifier, each LLM call, tool execution (`gen_ai.execute_tool` naming), TTS/ASR.
   This is the span tree that doesn't exist today.
3. **Provider call spans** — at the `ProviderCallRecorder.record()` seam (or the call sites feeding
   it, where phase data exists): LLM → `gen_ai.inference.client` shape (`{operation} {model}` name,
   `gen_ai.provider.name`, `gen_ai.operation.name`, request/response model, `gen_ai.request.stream`,
   **`gen_ai.response.time_to_first_chunk` = TTFT**, input/output/cache/reasoning tokens,
   `gen_ai.response.finish_reasons`, `gen_ai.conversation.id`, `error.type` from
   `errorClassification` on failure); TTS/ASR/storage/channel → internal/client spans with
   `operation` + `error.type`. Failover steps (P3-03/04) become child spans → the trace shows
   primary-failed → fallback-served inline (mirrors `fallback_events`).
4. **Streaming chunk events** (opt-in, `OTEL_SPAN_STREAM_EVENTS=true`): span events
   `gen_ai.content.chunk` with index + gap ms, capped (max N events per span, default 32,
   last-chunk summary event always). Default off (event volume on long streams).
5. **WebSocket sessions** (optional stretch): one span per WS session for the voice/text WS paths,
   linked (not parented) to the HTTP turn spans that trigger work — keeps trace graphs readable.

Rules: spans never throw into business paths (wrap like the recorder); span attributes reuse the
existing low-cardinality discipline (no ids beyond the documented ones, no prompt/response content —
GenAI content attributes are **opt-in and default off**); all span creation is a no-op when
`OTEL_ENABLED=false` (one branch at the seam).

Tests: unit with an in-memory `SpanExporter` (turn span tree shape, GenAI attrs, error status,
failover child spans, no-op when disabled); e2e: full conversation against the test app with an
in-memory exporter registered via the DI seam → assert the tree; hermetic (no collector in CI).

### Phase 3 — Metrics bridge (optional, `OTEL-03`)

Only if an OTLP metrics consumer is actually needed:

- Single definition source: generate OTel instruments from `METRIC_CONFIGS` at `TelemetryService`
  startup (counters/gauges/histograms, same buckets) — one config, two sinks.
- `MetricsRegistry` gains an optional OTel mirror (injected at construction; the in-memory path is
  untouched and stays authoritative for the alert engine + `metric_samples` flush).
- OTLP metrics push via `PeriodicExportingMetricReader` (60 s, aligned with the existing flush).
- Documented caveat: JS SDK has **no exemplars** — metric↔trace correlation is via shared attributes
  (`conversation_id` is not a metric label today; correlation happens in the backend over span
  attributes + the same time window, or via the `provider_call_logs` rows as the join table).

### Phase 4 — Log correlation (`OTEL-04`)

- pino: add `trace_id`/`span_id` (from OTel context, W3C hex) to every log line via a pino mixin —
  additive to the existing `requestId`; redaction untouched. When OTel is disabled the fields are
  absent (no empty-string noise).
- Outbound: where the transport allows and the provider respects it, inject `traceparent` into
  provider HTTP calls (OpenAI/Anthropic ignore it upstream; it still helps when a proxy sits in
  between). Default: **inbound ingest only** (W3C from clients), outbound injection optional via
  `OTEL_PROPAGATE_OUTBOUND` (default `false`).
- Docs: operator guide §10 + the frontend contract doc (new response headers: `traceparent` on
  responses when enabled).

## 5. Invariants — what stays untouched

- Postgres remains the only **state** store; OTel is in-process. An OTLP collector is operator-side
  infra, optional, exactly like the Prometheus scrape today.
- `MetricsRegistry`, `metric_samples`, the alert engine + its 21 rules, `provider_call_logs`,
  health checks, failover/circuit breakers, retention, RBAC: **all unchanged** (Option B rejected).
- `GET /metrics` (Prometheus text, token-gated) stays; no second OTel pull endpoint.
- Test hermeticity: `OTEL_ENABLED=false` in `tests/setup.ts`; CI never runs a collector.
- `X-Request-Id` stays (trace context is additive, not a replacement).

## 6. Risks & mitigations

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **tsx/ESM auto-instrumentation unreliability** (documented loader-hook conflicts; partial spans) | Medium | Manual instrumentation is the primary path (avoids loaders entirely); auto-instrumentation only if the Phase-0 spike proves it in our exact runtime. |
| 2 | **GenAI semconv in flux** — moved to a dedicated repo in 2026, stability *development*, no official JS package, recent renames (`gen_ai.system` → `gen_ai.provider.name`) | Medium | All attribute names centralized in `genaiAttrs.ts`, pinned to a dated semconv revision; we adopt *shape* (span names, key attrs) not a hard dependency; backends (Grafana/Honeycomb) still read raw attribute strings. Revisit pin when a stable release + JS package land. |
| 3 | **No exemplars in JS SDK** — can't link a histogram sample to a trace natively | Low | Correlation via shared attributes + time window + `provider_call_logs` join; documented in operator guide. |
| 4 | **Span/event volume** on long streaming conversations (thousands of chunks) | Medium | `OTEL_SPAN_STREAM_EVENTS` default off; capped event count when on; `BatchSpanProcessor` defaults + `OTEL_TRACES_SAMPLER` (head-based) for scale; span attribute cardinality follows the existing label discipline. |
| 5 | **Dual metric maintenance** (Phase 3) | Low | Instruments generated from `METRIC_CONFIGS` — one definition source; in-memory registry stays authoritative. |
| 6 | **Shutdown ordering** (span export racing process exit) | Low | `TelemetryService.stop()` in the existing bounded-flush slot (5 s cap, same pattern as `CallLogger.settled()`); spans are fire-and-forget after the cap (same at-most-once posture as alert notifications). |
| 7 | **0.x experimental packages** (`sdk-node`, exporters at 0.221.0) — breaking changes possible | Low | Pin exact versions in `package.json` (no `^` for OTel 0.x deps); upgrade deliberately. We import `sdk-trace-node`/`api` (2.x/1.x stable) directly — `sdk-node` umbrella is **not** required. |

## 7. Open questions (decisions needed before Phase 1)

1. **Target backend?** (Grafana Stack/Tempo, Honeycomb, Datadog, self-hosted collector, or none-yet —
   OTLP is backend-agnostic, but the spike's collector choice and the operator guide examples depend
   on it. Default assumption: self-hosted `otel/opentelemetry-collector` via the existing compose setup.)
2. **Sampling strategy at scale** — 100 % at current volume is fine; do we want a default
   `parentbased_traceidratio` (e.g. 0.1) for production instead of always-on?
3. **Phase 3 (metrics bridge) — now or never?** This report recommends *defer until a consumer asks*.
4. **Outbound `traceparent` injection** — on by default or opt-in (this report: opt-in).

## 8. Spec index

| ID | File | Summary |
|---|---|---|
| OTEL-01 | `OTEL-01-sdk-bootstrap.md` | TelemetryService + env + shutdown wiring + no-op default + in-memory span exporter test seam |
| OTEL-02 | `OTEL-02-tracing.md` | HTTP + turn + provider-call (GenAI) + channel spans, streaming events, failover children |
| OTEL-03 | `OTEL-03-metrics-bridge.md` | *Optional* METRIC_CONFIGS → OTel instruments mirror + OTLP push |
| OTEL-04 | `OTEL-04-log-correlation.md` | pino trace_id/span_id mixin, inbound traceparent, outbound injection (opt-in), response header |

Dependencies: `OTEL-01` ← (none); `OTEL-02` ← `OTEL-01`; `OTEL-03` ← `OTEL-01`; `OTEL-04` ← `OTEL-01`
(02/03/04 are parallel once 01 lands). Phase 0 spike precedes all and is not itself a spec
(throwaway, results recorded here).
