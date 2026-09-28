# Spec: Health-Check-Derived Metrics

Status: **spec** (proposed, ready for implementation)
Scope: Bonsai backend — two new `MetricsRegistry` metrics published by `HealthCheckService`
Date: 2026-09-01
Related: `specs/PROPOSAL-production-monitoring.md` (design history), `specs/monitoring/` (P1-02 MetricsRegistry, P1-05 HealthCheckService, P1-05b probes, P4-01 Prometheus endpoint), `specs/SPEC-status-page-v1.md` (health-checks consumer)

---

## 1. Context & goal

`HealthCheckService` already computes, on every 60 s cycle (1 s in the test env), a
`status` (`ok | degraded | down | unknown`) + `latencyMs` for every check — `db`,
`process`, `service_heartbeat:<name>` and `provider:<id>` — and persists all of it to
`health_checks`. But only the `db_pool_*`, `rss_bytes` and `event_loop_lag_*` gauges
are published to `MetricsRegistry`; the per-check status and latency never leave the
service as metrics.

Consequences today:

- **Dashboards have no first-class health-trend view.** `GET /metrics` (Prometheus)
  and `GET /api/monitoring/metrics` (series over `metric_samples`) can show DB pool
  pressure and memory, but not "provider X was down for 20 minutes" or "probe latency
  p95" — those questions require ad-hoc aggregation of raw `health_checks` rows.
- **The alert engine's delta ring** (windowed counter reads) has no health-check
  series to work from, even though it already reads the health snapshot directly.

Goal: publish two new metrics from the check cycle so **all existing consumers**
(Prometheus exporter, `metric_samples` series endpoint, alert-engine delta ring) get
health-check trends with **zero consumer-side changes**.

## 2. Fixed decisions

| # | Decision | Value |
|---|---|---|
| 1 | Registry stays **closed** | New metrics are code additions to `METRIC_CONFIGS` / `METRIC_DESCRIPTIONS`. No user-defined custom-metric surface — that would defeat the cardinality guard (PROPOSAL §3.2b). |
| 2 | DB changes | **None.** `metric_samples` exists; the registry's 60 s flush persists the new series automatically. |
| 3 | API/contract changes | **None.** `GET /api/monitoring/metrics` is a generic `name` + label-set query; `GET /metrics` renders any snapshot metric. |
| 4 | New alert rules | **Not in v1.** Every health failure mode already has a dedicated rule fed by the health snapshot (`db-down`, `service-stalled`, `provider-down` probe branch). The metrics serve dashboards/trends; a rule can be added later if needed. |
| 5 | Status encoding | `health_check_status` gauge: `0=ok, 1=degraded, 2=down, 3=unknown`. `unknown` **is** published so the series exists for never-active/inferred checks. |
| 6 | Label strategy | Never the raw check name for providers (`provider:<id>` is unbounded). Providers use `provider_id` + `provider_type`; heartbeats use `service`; all label keys already exist in `ALLOWED_LABEL_KEYS`. |
| 7 | Failure counter | **No `health_check_failures_total` in v1.** Gauge history in `metric_samples` already answers "how long/often was X down". Add later only if a windowed counter read in the alert engine becomes desirable. |
| 8 | Existing per-check gauges | `db_pool_*`, `rss_bytes`, `event_loop_lag_*` publication stays in the check methods, untouched. |

## 3. Metric definitions

### 3.1 `health_check_status` (gauge)

Latest status of each check, encoded `0=ok, 1=degraded, 2=down, 3=unknown`.

| Check family | Labels | Cardinality |
|---|---|---|
| `db` | `{ check: 'db' }` | 1 series |
| `process` | `{ check: 'process' }` | 1 series |
| `service_heartbeat:<name>` | `{ check: 'service_heartbeat', service: <name> }` | ~9 known services (+ dynamic heartbeats, bounded) |
| `provider:<id>` | `{ check: 'provider', provider_id: <id>, provider_type: <type> }` | 1 per configured provider |

`maxSeries: 500` (same cap as the `circuit_breaker_state` precedent); overflow drops
new label-sets with the registry's warn-once behaviour. Gauges flush only on value
change → one `metric_samples` row per transition per series.

### 3.2 `health_check_latency_ms` (histogram)

Buckets (ms): `[5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]` — top bucket
matches `CHECK_TIMEOUT_MS` (10 s). Same label strategy as §3.1. `maxSeries: 500`.

Observed **only when `latencyMs` is defined**: the db ping and real provider probes.
Inferred provider checks and service heartbeats carry no latency → no observations
(the series simply does not exist for them, which is the correct semantics).

### 3.3 Cardinality & volume analysis

- Total added series: `providers × 2 + heartbeats × 2 + 4` — hundreds at most,
  identical in shape to the already-registered `circuit_breaker_state`/
  `circuit_opens_total` provider-labelled metrics.
- Flush volume: negligible. Status gauges flush on transition only (a healthy system
  flips rarely); the latency histogram flushes at most once per 60 s bucket per
  observed series (db every cycle; probes only when the cooldown allows).
- Worst case (provider deleted): stale series lingers in memory until restart and in
  `metric_samples` until retention purges it (90 d). Accepted — identical to the
  existing circuit-breaker metrics' behaviour; the series cap bounds blow-up.

## 4. Design

All changes in `src/services/monitoring/` — no wiring, routing, or DI changes.

### 4.1 `MetricsRegistry.ts`

Add to `METRIC_CONFIGS`:

```ts
// Health checks (per-check status + probe/db-ping latency; published by HealthCheckService)
health_check_status: { kind: 'gauge', maxSeries: 500 },
health_check_latency_ms: {
  kind: 'histogram',
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  maxSeries: 500,
},
```

Add matching one-line entries to `METRIC_DESCRIPTIONS` (these become the `# HELP`
text in the Prometheus exposition — state the 0/1/2/3 encoding in the status
description).

### 4.2 `HealthCheckService.ts`

1. Extend the private `HealthCheck` interface with
   `labels?: Record<string, unknown>` and set it at construction in
   `buildChecks()` (the provider object is in scope there — no name parsing):
   - `db` → `{ check: 'db' }`
   - `process` → `{ check: 'process' }`
   - heartbeat → `{ check: 'service_heartbeat', service: name }`
   - provider → `{ check: 'provider', provider_id: provider.id, provider_type: provider.providerType }`

2. New private `publishMetrics(results: HealthCheckResult[] & { labels? })` — a small
   status→code map (`ok→0, degraded→1, down→2, unknown→3`) and, per result:
   - `metricsRegistry.setGauge('health_check_status', labels, code)`
   - `metricsRegistry.observe('health_check_latency_ms', labels, latencyMs)` when
     `latencyMs` is defined.

3. Call `publishMetrics` inside `runCheckCycle()`'s try block, right after the
   snapshot update. The registry never throws (unknown names/labels are dropped with
   a warn-once), so publication cannot break the cycle.

Edge cases, by construction:

- Check timeout in `runCheckWithTimeout` → `status: 'down'`, no `latencyMs` →
  gauge `2`, no histogram observation. Correct.
- `unknown` (never-ticked heartbeat, no-call provider inference) → gauge `3`.
- Probes disabled (`MONITORING_HEALTH_PROBES=off`, test env) → provider series are
  published from inference only; no probe latency observations.

## 5. Consumers (verified — no changes required)

| Consumer | What it gets | Change |
|---|---|---|
| `GET /metrics` (Prometheus, P4-01) | Both series rendered generically (names are already valid Prometheus charset) | none |
| `GET /api/monitoring/metrics?name=health_check_status&labels[check]=provider&labels[provider_id]=…` | Per-check trend series over `metric_samples` | none |
| `AlertRuleEngine` delta ring | New counter/histogram series tracked automatically; available for a future `health-check-failing`-style rule | none (v1 adds no rule, §2.4) |
| `RetentionService` | `metric_samples` rows purged with the existing 90 d retention | none |

## 6. Tests

**Unit** (`tests/unit/monitoring/`):

- New suite (or extension of `p1-05-health-check.test.ts`) driving
  `runCheckCycle()` on the existing test subclass:
  - `health_check_status` series present for db / process / one heartbeat / one
    provider, with the exact label sets from §3.1 and correct encoded values.
  - `health_check_latency_ms` observed for the db check; **not** observed for a
    heartbeat or an inferred provider check.
  - `unknown` status publishes gauge `3`.
  - Check-timeout path publishes gauge `2` with no observation.

**E2E** (`tests/e2e/health-check.test.ts`):

- Test env ticks the loop every 1 s with `MONITORING_HEALTH_PROBES=off`. After
  ≥ 2 cycles:
  - `metric_samples` contains `health_check_status` rows for the exact
    `(name, labels)` series `{check:'db'}` / `{check:'process'}` /
    `{check:'service_heartbeat', service:'health-checks'}` — filter assertions to
    the exact series (in-memory metric state survives `resetDatabase()`).
  - `GET /api/monitoring/metrics?name=health_check_status&labels[check]=db`
    returns 200 with ≥ 1 series and points in-window.
- Keep the existing `fixture_probe` check-name convention for history fixtures
  (the live service ticks every second in tests).

**Prometheus rendering** (`p4-01-metrics-endpoint.test.ts`): optional — add one
snapshot case containing a `health_check_status` series to prove generic rendering
(HELP text from `METRIC_DESCRIPTIONS`, gauge value).

## 7. Docs

- `docs/guide/monitoring.md`: add both metrics to the "What is monitored" table and
  the metrics section — status encoding (0/1/2/3), label strategy, `maxSeries: 500`
  cap, and "latency observed only where a real measurement exists".
- `AGENTS.md`: extend the `HealthCheckService` bullet with the two published series.
- No `compose/` or `.env.example` changes (no new env vars).

## 8. Out of scope

- **User-defined / arbitrary metrics** (operator-configured expressions over health
  checks) — conflicts with the closed-registry cardinality guard by design.
- **`health_check_failures_total`** counter — revisit only if an alert rule needs
  windowed failure counts.
- **Saved health queries over `health_checks`** (e.g. "uptime % per provider / 24 h")
  — a separate product feature over the raw table, not a new metric kind.
- **New alert rules** on the new metrics — health failures are already covered by
  dedicated snapshot-fed rules.
- Renaming or moving the existing per-check gauge publications (§2.8).

## 9. Effort & risks

- **Effort:** ~1–2 dev-days including unit + e2e tests and docs. No migration, no
  contracts, no DI wiring, no shutdown changes (the P1-09 flush/settlement machinery
  handles the new series automatically).
- **Risks:**
  - Stale series for deleted providers — accepted, bounded (§3.3).
  - Test-env `metric_samples` volume — trivial (gauge-on-change, histogram only on
    db ping; probes off).
  - Prometheus exposition size — two extra metric names, negligible.
