---
title: "OTEL-04 — Log correlation: pino trace_id/span_id, inbound traceparent, outbound injection (opt-in)"
severity: proposal
status: open
created: 2026-08-21
updated: 2026-08-21
assignee: ""
tags: [monitoring, opentelemetry, spec, phase-4]
---

# OTEL-04 — Log correlation

- **Phase:** 4 — Log correlation
- **Depends on:** OTEL-01 (works with or without OTEL-02; trace ids only exist once spans do)
- **Blocks:** (none)
- **Estimate:** 1 dev-day

## Objective

Correlate pino logs with traces: every log line inside a span context carries W3C `trace_id` /
`span_id`; inbound W3C `traceparent` from clients is honored (automatic once server spans exist);
outbound `traceparent` injection into provider HTTP calls is **opt-in** (default off — most
providers ignore it upstream; it helps when a proxy sits in between). Existing `X-Request-Id` and
pino redaction stay untouched.

## Scope

### Modified files
- `src/utils/logger.ts` — pino `mixin` (or `customLevels` base): adds `trace_id`/`span_id`
  (128-bit/64-bit lowercase hex from `@opentelemetry/api` `tracecontext`) **only when a valid span
  context is active**; fields absent otherwise (no empty-string noise when OTel is disabled).
  Redaction paths unchanged (the new fields are ids, not secrets).
- `src/http/middleware/requestOutcome.ts` (or `telemetrySetup.ts`) — ensure the HTTP server span's
  context is active for the request scope (so all downstream pino lines in request handlers inherit
  the ids); response header `traceparent` set when a span is active (frontend contract doc updated).
- Provider HTTP call sites (optional outbound injection, `OTEL_PROPAGATE_OUTBOUND`, default `false`)
  — inject `traceparent` into outbound provider HTTP headers where the transport allows.
- `tests/setup.ts` — no env change needed (disabled by default); one test boots enabled.
- `docs/guide/monitoring-api.md` — new response header `traceparent` (when OTel enabled);
  `docs/guide/monitoring.md` §10 — log correlation section.

## Acceptance criteria

- [ ] Disabled (test default): log lines contain no `trace_id`/`span_id` keys at all (asserted in
      the existing request-outcome e2e — field absence, not empty strings).
- [ ] Enabled + in-memory exporter: a request's pino lines inside the handler carry `trace_id`
      equal to the exported server span's trace id, and `span_id` matches the active span
      (asserted by capturing pino output in an e2e suite with a writable-stream destination).
- [ ] Inbound `traceparent` header on a request is continued: exported span's trace id equals the
      inbound one (context propagation, no custom code required — asserted).
- [ ] Response carries `traceparent` when enabled; absent when disabled.
- [ ] `OTEL_PROPAGATE_OUTBOUND=true`: outbound provider HTTP calls include a `traceparent` header
      (asserted with a mock provider server); default `false` → no header.
- [ ] Redaction behavior unchanged (existing redaction tests green).
- [ ] Gates green: build, unit, e2e.

## Tests

- **Unit** (`tests/unit/monitoring/otel/otel-log-correlation.test.ts`): mixin output with/without
  active context (valid hex shapes, absent keys when none).
- **E2E** (`tests/e2e/otel-log-correlation.test.ts`): enabled boot with in-memory exporter +
  captured pino stream → trace id parity (request line ↔ span), inbound continuation, response
  header; outbound injection on/off.

## Out of scope

- Structured log *export* via OTel logs SDK (the JS logs API is still maturing; pino stays the
  logger — a separate future issue if wanted), log sampling, changing `X-Request-Id` semantics.
