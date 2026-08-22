---
title: "OTEL-03 — Metrics bridge: METRIC_CONFIGS → OTel instruments mirror + OTLP push (optional)"
severity: proposal
status: open
created: 2026-08-21
updated: 2026-08-21
assignee: ""
tags: [monitoring, opentelemetry, spec, phase-3]
---

# OTEL-03 — Metrics bridge (optional — defer until an OTLP metrics consumer is needed)

- **Phase:** 3 — Metrics bridge
- **Depends on:** OTEL-01
- **Blocks:** (none)
- **Estimate:** 1.5 dev-days
- **Priority:** LOW — the feasibility report (`README.md`, §3 Option C / §7 Q3) recommends deferring
  until a backend wants OTLP metrics. The in-memory registry + `metric_samples` + alert engine +
  `/metrics` cover all current consumers.

## Objective

Mirror the existing metric registry into OTel instruments for OTLP push, **without** changing the
source of truth: the in-memory `MetricsRegistry` stays authoritative for the alert rule engine and
the 60 s `metric_samples` flush; OTel receives a mirror. One definition source (`METRIC_CONFIGS`)
drives both sinks — no parallel metric definition lists.

## Scope

### New files
- `src/services/monitoring/otel/otelMetrics.ts` — builds OTel instruments from `METRIC_CONFIGS`
  (counters/gauges/histograms, identical histogram buckets, unit/description from config);
  `PeriodicExportingMetricReader` (60 s, aligned with the registry flush, `OTEL_EXPORTER_OTLP_*`).

### Modified files
- `src/services/monitoring/MetricsRegistry.ts` — optional injected mirror (`setOtelMirror()`);
  `inc`/`setGauge`/`changeGauge`/`observe` forward after the in-memory update; mirror failures are
  swallowed (one pino error, never thrown into business paths).
- `src/services/monitoring/otel/TelemetryService.ts` — builds the `MeterProvider` when
  `OTEL_ENABLED=true` (+ sub-toggle `OTEL_METRICS_ENABLED`, default `false`); `stop()` includes a
  bounded `forceFlush()`.
- `.env.example`, `compose/env.example`, `docs/guide/monitoring.md` §10 — `OTEL_METRICS_ENABLED`.

## Acceptance criteria

- [ ] With mirror on: every `METRIC_CONFIGS` name exists as an OTel instrument with matching
      type/buckets/description (asserted by enumerating the meter); a unit test increments one
      counter and the in-memory OTLP reader produces the same value.
- [ ] In-memory path untouched: alert engine delta ring + `metric_samples` flush unchanged (existing
      P1-02/P2-01 tests green unmodified).
- [ ] Mirror failure (stubbed broken instrument) does not affect business paths or the in-memory
      values (unit test).
- [ ] Sub-toggle off → no `MeterProvider` constructed, zero metric export activity.
- [ ] Documented caveat in the operator guide: the JS SDK has no exemplars — metric↔trace
      correlation is via shared attributes/time window, not native links.
- [ ] Gates green: build, unit, e2e.

## Tests

- **Unit** (`tests/unit/monitoring/otel/otel-metrics-bridge.test.ts`): instrument enumeration vs
  `METRIC_CONFIGS`; value parity for counter/gauge/histogram; failure isolation; sub-toggle.

## Out of scope

- Replacing the registry or the alert engine (Option B — rejected in the report), `exporter-prometheus`
  (redundant with `/metrics`), OTel views/recorded measurements.
