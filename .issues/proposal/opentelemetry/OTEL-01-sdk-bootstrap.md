---
title: "OTEL-01 — OTel SDK bootstrap (TelemetryService, env, shutdown, no-op default)"
severity: proposal
status: open
created: 2026-08-21
updated: 2026-08-21
assignee: ""
tags: [monitoring, opentelemetry, spec, phase-1]
---

# OTEL-01 — OTel SDK bootstrap

Part of the OpenTelemetry integration proposal (see `README.md` in this folder for the feasibility
report, options analysis, and Phase-0 spike requirements).

- **Phase:** 1 — Bootstrap
- **Depends on:** none (Phase-0 spike results recommended first; spike is throwaway, not a dependency)
- **Blocks:** OTEL-02, OTEL-03, OTEL-04
- **Estimate:** 1 dev-day

## Objective

Initialize the OpenTelemetry SDK (trace provider first; meter provider slot for OTEL-03) behind a
`OTEL_ENABLED` flag that defaults to **off**, so production behavior is byte-identical until
explicitly configured. When disabled, all tracing calls go through the SDK's global no-op tracer —
zero exporter activity, no allocations in hot paths beyond one cached object.

## Scope

### New files
- `src/services/monitoring/otel/telemetrySetup.ts` — env-driven construction:
  - `Resource`: `service.name` (env `OTEL_SERVICE_NAME`, default `bonsai-backend`),
    `service.version` from package.json, `OTEL_RESOURCE_ATTRIBUTES` passthrough.
  - `NodeTracerProvider` + `BatchSpanProcessor` (defaults: 512 queue / 5 s) +
    `OTLPTraceExporter` (HTTP/protobuf; endpoint/headers/timeout from standard `OTEL_EXPORTER_OTLP_*`).
  - Sampler from `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` (default `parentbased_always_on`).
  - Imports `@opentelemetry/sdk-trace-node` + `@opentelemetry/exporter-trace-otlp-http` +
    `@opentelemetry/api` + `@opentelemetry/resources` **directly** (stable 2.x/1.x lines) —
    the 0.x `sdk-node` umbrella is NOT used (Risk 7 in README).
- `src/services/monitoring/otel/TelemetryService.ts` — `@singleton()`:
  - `start()` (idempotent; logs one pino line when enabled: endpoint + sampler + exporter kind),
  - `stop(): Promise<void>` — bounded (5 s) `provider.shutdown()`; never throws,
  - `tracer(scope: string): Tracer` (no-op tracer when disabled — cached),
  - `isTracing(): boolean`.
- `src/services/monitoring/otel/genaiAttrs.ts` — string constants for the GenAI attribute names used
  by OTEL-02 (`gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`,
  `gen_ai.request.stream`, `gen_ai.response.time_to_first_chunk`, `gen_ai.usage.input_tokens`,
  `gen_ai.usage.output_tokens`, `gen_ai.usage.cache_read.input_tokens`,
  `gen_ai.usage.reasoning.output_tokens`, `gen_ai.response.finish_reasons`, `gen_ai.conversation.id`,
  `gen_ai.tool.name`), with a date-stamped comment pinning the
  `semantic-conventions-genai` revision (README §6 Risk 2). The current
  `@opentelemetry/semantic-conventions@1.43.0` exports **no** `GEN_AI_*` constants — verified.

### Modified files
- `src/server.ts` — `container.resolve(TelemetryService).start()` next to `MetricsRegistry`/`CallLogger` (~line 415).
- `src/utils/shutdown.ts` — new slot: `TelemetryService.stop()` **before** the monitoring buffer flush
  (spans need no DB); same bounded-flush pattern as `CallLogger.settled()`.
- `src/index.ts` — pass the TelemetryService into the shutdown options.
- `tests/setup.ts` — `OTEL_ENABLED=false` (hermetic invariant).
- `.env.example` + `compose/env.example` — document: `OTEL_ENABLED`, `OTEL_SERVICE_NAME`,
  `OTEL_RESOURCE_ATTRIBUTES`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`,
  `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG`.
- `docs/guide/monitoring.md` — new §10 "OpenTelemetry" (what it is, how to enable, collector example,
  env table); `AGENTS.md` — background services + env sections; proposal `README.md` (this folder).

## Acceptance criteria

- [ ] `OTEL_ENABLED` unset/`false`: app boots identically, **zero** OTel exporter network activity
      (asserted: no outbound connections in a unit test with a stubbed exporter constructor),
      `tracer()` returns the global no-op tracer, no new pino lines at boot.
- [ ] `OTEL_ENABLED=true` + in-memory span exporter (test seam): a synthetic span is exported with
      correct resource attributes (`service.name`, `service.version`).
- [ ] `stop()` resolves within the 5 s bound even when the exporter hangs (stubbed slow export),
      never throws, and runs **before** `CallLogger` flush in the shutdown sequence (order asserted).
- [ ] `OTEL_RESOURCE_ATTRIBUTES` and sampler env vars are honored (unit tests with env override).
- [ ] Both env example files list the new vars with defaults; no orphan vars in code.
- [ ] Gates green: `npm run build`, `npm run test:unit`, `npm run test:e2e` (existing suites unaffected).

## Tests

- **Unit** (`tests/unit/monitoring/otel/otel-bootstrap.test.ts`): no-op behavior when disabled
  (no exporter constructed, cached no-op tracer); resource/sampler/env parsing; bounded shutdown
  with a hanging exporter; idempotent `start()`.
- **E2E**: boot with `OTEL_ENABLED=false` (default test env) — existing suite is the regression net;
  plus one suite asserting `GET /health` is unchanged and no `traceparent` response header when disabled.

## Out of scope

- Any spans (OTEL-02), metrics (OTEL-03), log correlation (OTEL-04), auto-instrumentation
  (Phase-0 spike decides; if adopted, it's a separate follow-up issue).
