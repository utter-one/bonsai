---
title: "OTEL-02 — Tracing: HTTP, conversation turn, provider calls (GenAI conventions), channels"
severity: proposal
status: open
created: 2026-08-21
updated: 2026-08-21
assignee: ""
tags: [monitoring, opentelemetry, spec, phase-2]
---

# OTEL-02 — Tracing

- **Phase:** 2 — Tracing (the value phase)
- **Depends on:** OTEL-01
- **Blocks:** (none — OTEL-03/04 are parallel)
- **Estimate:** 3 dev-days

## Objective

Give every conversation turn a span tree, using manual instrumentation at the seams we already
instrument (P1-03's `ProviderCallRecorder` path, `requestOutcomeMiddleware`, `ConversationRunner`),
following the GenAI semantic conventions (`semantic-conventions-genai`, revision pinned in
`genaiAttrs.ts`) for LLM spans. Spans are additive: the row-level `provider_call_logs` and metric
recording at the same seams are untouched.

## Scope

### New files
- `src/services/monitoring/otel/spans.ts` — span factories:
  - `httpServerSpan(req, routeGroup)` — `METHOD {route_group}`; attributes: `http.request.method`,
    `url.path` (route template — never raw id paths), `http.response.status_code` (set at outcome),
    `request_id`, `error.type` (from `errorClassification` for 5xx); W3C `traceparent` inbound
    ingestion is automatic via the propagator.
  - `turnSpan(conversation)` — `conversation.turn`; attributes: `conversation_id`, `project_id`,
    `stage_id`, `channel` (ws/webrtc/twilio/telegram/whatsapp/email); kind INTERNAL.
  - `llmCallSpan(providerId, providerType, model, { streaming, ttftMs, tokens, finishReason, usageCache, usageReasoning })`
    — GenAI `inference.client` shape: name `{operation} {model}`; required `gen_ai.provider.name`
    (set at span creation) + `gen_ai.operation.name` (`chat` | `classify`); `gen_ai.request.model`,
    `gen_ai.request.stream`, `gen_ai.response.time_to_first_chunk` (= TTFT, ms),
    `gen_ai.usage.input_tokens` / `output_tokens` / `cache_read.input_tokens` /
    `reasoning.output_tokens`, `gen_ai.response.finish_reasons`, `gen_ai.conversation.id`,
    `provider_id`, `ok`, `error.type` on failure.
  - `providerCallSpan(operation, providerId, { ok, errorCode, durationMs, extra })` — TTS/ASR/
    storage/channel operations (internal/client spans, `operation` + `error.type`).
  - `toolSpan(toolName, toolCallId, ok, errorType)` — `execute_tool {tool.name}` shape.
  - All factories: no-op when `TelemetryService.isTracing()` is false (single guard), never throw
    into business paths (wrap like `ProviderCallRecorder`), attribute cardinality follows the
    existing label discipline (ids limited to the documented set; **no prompt/response content** —
    GenAI content attributes opt-in and default off).

### Modified files
- `src/http/middleware/requestOutcome.ts` — start/end the HTTP server span at the existing
  outcome point (one span per request — if Phase 0 proved `instrumentation-express` under tsx,
  this file instead *reuses* the auto span and only adds `request_id`; decision recorded at
  implementation time, e2e asserts exactly one server span).
- `src/services/live/ConversationRunner.ts` — turn span around user-input processing; children:
  context transform, classifier, LLM calls, tool executions.
- Provider bases (`LlmProviderBase`, `TtsProviderBase`, `AsrProviderBase`, `StorageProviderBase`,
  channel send paths) — span around the existing `ProviderCallRecorder.record()` call sites,
  reusing the data already collected there (TTFT from `StreamStats`, tokens, finish reason).
- Failover wrappers (`FailoverLlmProvider`, `FailoverTtsProvider`, `FailoverAsrProvider`,
  `FailoverStorageProvider`) — one parent span per attempt chain; each step a child; the failed
  primary child carries `error.type` → the trace shows primary-failed → fallback-served (mirrors
  `fallback_events` rows).
- `src/services/monitoring/otel/telemetrySetup.ts` — `OTEL_SPAN_STREAM_EVENTS` (default `false`):
  when on, streaming LLM/TTS/ASR spans emit capped `chunk` span events (index + gap ms; max 32
  events + a final summary event) from the existing `StreamStats` callback seams.

## Acceptance criteria

- [ ] Disabled (`OTEL_ENABLED=false`, test default): zero spans produced; full e2e suite green with
      no behavior change (the regression net).
- [ ] Enabled + in-memory exporter: a completed conversation turn produces a tree — HTTP server
      span → `conversation.turn` → LLM span(s) with correct GenAI attributes (name, provider,
      model, `gen_ai.request.stream=true` for streaming, TTFT value matches the `provider_call_logs`
      row's `ttftMs`, token counts match, finish reason matches) — asserted in one e2e test.
- [ ] Failed LLM call: span status ERROR + `error.type` from `errorClassification` (401 → `auth`,
      429 → `rate_limited`, …); a failover turn shows the failed-primary child + fallback child.
- [ ] Exactly one HTTP server span per request (no duplicate spans if auto-instrumentation is on).
- [ ] Span attributes contain no high-cardinality or sensitive values: no raw prompt/response text,
      no unbounded ids (asserted by scanning exported span attribute keys against an allowlist in
      the unit test).
- [ ] Streaming events off by default (no `chunk` events in the default-mode e2e); when on, capped
      at 32 + summary (unit test with a synthetic 100-chunk stream).
- [ ] Spans never throw: a failing exporter (stubbed) does not affect the conversation outcome.
- [ ] Gates green: build, unit, e2e.

## Tests

- **Unit** (`tests/unit/monitoring/otel/otel-spans.test.ts`): each factory's attributes/status with
  a stubbed tracer; no-op mode; attribute allowlist scan; streaming-event cap; failover child shape.
- **E2E** (`tests/e2e/otel-tracing.test.ts`): register an in-memory span exporter through the
  OTEL-01 test seam; run one full conversation (mock LLM, as in the P1-03 integration harness) →
  assert the tree + GenAI attributes + error/failover cases; assert no spans leak across
  `resetDatabase()` runs (per-request isolation).

## Out of scope

- Metrics (OTEL-03), log correlation (OTEL-04), WS session spans (optional stretch — file a follow-up
  if wanted), outbound `traceparent` injection (OTEL-04, opt-in).
