---
title: "P2-01 — AlertRuleEngine: rules, state machine, default rules"
severity: proposal
status: open
created: 2026-08-17
updated: 2026-08-17
assignee: ""
tags: [monitoring, spec, phase-2]
---

# P2-01 — AlertRuleEngine: rules, state machine, default rules

- **Phase:** 2 — Alerting
- **Depends on:** P1-02 (metrics), P1-03 (call logs), P1-04 (`api_requests_total`), P1-05 (health snapshot), P1-07 (`rate_limit_rejections_total` + top-N keys)
- **Blocks:** P2-02, P2-03, P3-06
- **Estimate:** 1.5 dev-days

## Objective

A declarative rule engine that detects problems from the Phase-1 data (metric windows, health checks, rolling call logs, heartbeats, 429 counters), with hysteresis + cooldowns so alerts fire on sustained conditions and never flap.

## Scope

### New files
- `src/services/monitoring/AlertRuleEngine.ts`
- `src/services/monitoring/AlertEvents.ts` — rule model + zod schemas + default rules
- `src/services/monitoring/AlertEventPublisher.ts` — the seam between engine and notifiers (P2-02 implements the real dispatch; P2-01 ships a `LogAndPersistPublisher`)

### Modified files
- `src/server.ts` — start the engine
- `src/http/contracts/monitoring.ts` — rule schemas (shared with P1-06 config)

## Implementation requirements

### Rule model — evaluators in code, params in config

Rules are **not** a generic condition DSL. Several default rules from PROPOSAL §3.3 are OR-composites over heterogeneous sources (`provider-down` = error-rate **or** breaker-open **or** probe failures; `api-429-spike` = counter **or** ratio; `stream-stalls` = row fraction with a predicate) — a single `metric/comparator/threshold/window` schema cannot express those. So each default rule is a registered **evaluator** with an explicit, unit-tested implementation; `monitoring_config` only overrides *parameters* (thresholds, windows, minSamples, severity, `enabled`).

```ts
// AlertEvents.ts — one registered evaluator per rule id
type RuleParams = Record<string, unknown>;  // validated/ defaulted per rule by its own zod schema (all .describe()d)

interface RuleVerdict { met: boolean; message: string; context: Record<string, unknown>; }  // → alert_events.context

interface AlertRuleDef {
  id: string;                    // 'provider-down', 'api-429-spike', ...
  name: string;
  severity: 'info' | 'warning' | 'critical';   // default; config may override
  scope: 'global' | 'per_provider';
  defaultParams: Record<string, unknown>;
  forMinutes: number;            // sustainment before FIRING (default 2)
  resolveAfterGoodChecks: number; // consecutive good evaluations to auto-resolve (default 2)
  cooldownMinutes: number;       // min gap between re-fires of same key (default 15)
  maxUnresolvedHours: number;    // auto-resolve safety valve (default 6)
  enabled: boolean;              // default; monitoring_config.rules[id].enabled overrides
  evaluate(data: EvaluationData, providerId: string, params: RuleParams): RuleVerdict;
}
```

`EvaluationData` — assembled **once per engine pass** (one parameterized query per source). The engine takes data-provider functions via constructor injection — it must not read singletons directly for data (this is also what makes per-rule unit tests possible):

```ts
type EvaluationData = {
  now: number;
  metrics: MetricsSnapshot;                      // P1-02 (counters/gauges/histograms)
  health: HealthSnapshot;                        // P1-05 (incl. db check detail { poolTotal, poolIdle, poolWaiting })
  callLogs: Map<providerId, {                    // rolling windows per provider — ONE SQL per pass
    calls: number; errorRate: number; p95DurationMs: number;
    errorCounts: Record<string, number>;         // errorCode → count in window
    ttftP50Ms?: number; ttftP95Ms?: number; ttftP99Ms?: number;
    stalledFraction: number;                     // rows with metrics.maxChunkGapMs > 10000
    rtfOver1Fraction: number;                    // tts rows with duration_ms > metrics.audioDurationMs
    eosToFinalP95Ms?: number;
    midStreamErrorFraction: number;              // rows with metrics.errorPhase='mid_stream'
  }>;
  fallbackEventCounts: Map<providerId, number>;  // 10-min window over fallback_events
  rejections: { api: number; auth: number; topKeys: { hash: string; count: number }[] };  // P1-07
  breakers: Map<providerId, 'closed' | 'open' | 'half-open'>;  // P3-01 (empty until Phase 3 — inert branch)
  probeFailures: Map<providerId, number>;        // consecutive probe failures — P1-05
};
```

Per-provider rules (`scope: 'per_provider'`) evaluate once per providerId observed in `callLogs` ∪ `breakers` ∪ `probeFailures`; alert key = `ruleId:providerId`. Global rules evaluate once. When a 429 rule finds one key hash caused >50% of the window's rejections, the alert key becomes `ruleId:key:<hash>` (detail includes the hash) — the per-key scoping from PROPOSAL §3.3.

### Default rules (full set from PROPOSAL §3.3 tables — 20 rules: 15 general + 5 streaming, incl. `provider-auth-failed`; the 21st, `provider-chain-exhausted`, is added by P3-06)
`db-down`, `db-pool-saturated`, `provider-down`, `provider-degraded`, `provider-rate-limited`, `provider-auth-failed`, `service-stalled`, `api-5xx-spike`, `api-429-spike`, `auth-429-spike`, `oauth-refresh-failing`, `imap-poll-failing`, `high-memory`, `event-loop-lag`, `fallback-active`, `stream-slow-ttft`, `stream-stalls`, `tts-rtf-degraded`, `asr-final-latency`, `stream-abort-rate`.
Per-provider rules (`provider-*`) are evaluated per provider id from data at evaluation time — not pre-instantiated per provider.
Rule conditions (exact — each is one registered evaluator; params are the defaults shown in parentheses, overridable via `monitoring_config.rules[id]`):

- `provider-down` (critical) = **anyOf**: error rate = 100% over ≥5 calls in 10 min (`callLogs`) **or** breaker `open` (`breakers`) **or** ≥3 consecutive probe failures (`probeFailures`).
- `provider-degraded` (warning) = **anyOf**: error rate > 30% in 10 min (minSamples 10) **or** p95 duration > per-type threshold (LLM 20 s, ASR 2 s, TTS 5 s, channel 10 s).
- `provider-rate-limited` (warning) = `errorCounts['rate_limited']` ≥ 5 in 10 min. `provider-auth-failed` (critical) = `errorCounts['auth']` ≥ 1 in 5 min.
- `db-down` (critical) = `db` check down for 2 consecutive checks. `service-stalled` (warning) = `service_heartbeat:{name}` check down (the check encodes the 3×-interval staleness). `db-pool-saturated` (warning) = db detail `poolWaiting > 20% × poolTotal` for 5 min.
- `api-5xx-spike` (warning) = 5xx ratio of `api_requests_total` > 5% in 5 min (minSamples 20). `api-429-spike` (warning) = **anyOf** ≥20 `rate_limit_rejections_total{scope=api}` in 5 min **or** 429 ratio > 5% (minSamples 20) — per-key scoping as above. `auth-429-spike` (warning) = ≥5 auth rejections in 15 min.
- `oauth-refresh-failing` / `imap-poll-failing` (warning) = `oauth_refresh_total{ok=false}` ≥ 3 in 60 min / `imap_poll_total{ok=false}` ≥ 5 in 60 min.
- `high-memory` (warning) = `rss_bytes` gauge (published by P1-05's `process` check) > threshold (default 1.5 GB, env `MONITORING_MEMORY_THRESHOLD_MB`). `event-loop-lag` (warning) = `event_loop_lag_p95_ms` gauge (P1-05 keeps a 60 s in-memory delay-sample window and publishes the gauge each cycle) > 250 ms — the "5 min" semantics come from `forMinutes` sustainment (document this in the rule's message).
- `fallback-active` (info, per-provider) = ≥1 `fallback_events` row for that provider in 10 min — inert until Phase 3 writes rows (expected in Phases 1–2; P3-06 verifies per-provider scoping).
- Streaming (all per-provider): `stream-slow-ttft` (warning) = ttft p95 > 10 s (LLM) / 3 s (TTS, `ttftMs` key in `metrics`); `stream-stalls` (warning) = `stalledFraction` > 10%; `stream-abort-rate` (warning) = `midStreamErrorFraction` > 10%; `tts-rtf-degraded` (warning) = `rtfOver1Fraction` > 10%; `asr-final-latency` (info) = `eosToFinalP95Ms` > 10 s.

Implementation notes:
- `provider-*`/`stream-*` data comes from ONE rolling-window query per pass over `provider_call_logs` (per-provider aggregates incl. `percentile_cont`; variant fields extracted from the `metrics` jsonb via `->>`), not one query per rule.
- Config validation: P2-01 exports the rule registry and tightens the P1-06 config schema with a `refine` — unknown rule id in `rules` → 400 (P2-03's PUT picks this up automatically).

### State machine (per alert key = `ruleId:scopeKey`)
```
ok → pending    (condition true; recorded pendingSince)
pending → firing (true continuously for `forMinutes`)   → AlertEventPublisher.fire(event)
firing → resolved (condition false for `resolveAfterGoodChecks` consecutive evaluations, or maxUnresolvedHours) → publisher.resolve(event)
firing → firing (cooldown suppresses duplicate fire() calls while condition stays true)
```
- State kept in memory (process restart resets state — acceptable; the first evaluation after restart re-derives from windows). `alert_events` is the durable record.
- `publisher.fire()/resolve()` are invoked **without awaiting** from the evaluation pass (unhandled-rejection-safe by contract — publishers never throw), so a slow notifier can never stall the loop (P2-02's 15 s cap is internal to the publisher).
- Evaluation loop: node-cron every 1 min (env/config `alerting.engineIntervalMinutes`), `isProcessing` guard, all rules evaluated in one pass; a failing evaluation (DB down for call-log queries) must not crash the loop — log + skip rule (and note: if DB is down, `db-down` still fires from the health snapshot, which is in-memory).

### `AlertEventPublisher` (seam)
- Interface: `fire(event: AlertEvent): Promise<void>`, `resolve(event: AlertEvent): Promise<void>`.
- P2-01 implementation `LogAndPersistPublisher`: writes/updates `alert_events` row (firing: insert; resolved: update `status`+`resolved_at`; `notifications: []`), pino log at severity-appropriate level. P2-02 wraps this with notification dispatch.
- Event: `{ id, ruleId, scopeKey, scope, severity, message (rendered, human-readable, includes provider name/thresholds/actual values), context (jsonb: metric values, window, top keys), firedAt, resolvedAt? }`.

## Acceptance criteria

- [ ] Every default rule has a unit test proving it fires with synthetic data and does not fire just below threshold (boundary cases incl. `minSamples` not met).
- [ ] Hysteresis: condition flapping true/false faster than `forMinutes`/`resolveAfterGoodChecks` never produces firing→resolved→firing churn (assert on `alert_events` rows).
- [ ] Cooldown: sustained condition with a transient 1-good-evaluation dip re-fires at most once per `cooldownMinutes`.
- [ ] `db-down` fires from health snapshot even when call-log queries fail (DB unavailable).
- [ ] `api-429-spike` scopes to the offending key hash when one key dominates (unit test with synthetic top-N).
- [ ] Engine loop survives a thrown rule evaluation (isolated per rule).

## Tests

- **Unit:** state machine (all transitions incl. maxUnresolved auto-resolve), each rule family with synthetic metric/log fixtures (use fakes injected via constructor — the engine must not read singletons directly for data: accept data-provider functions), cooldown/hysteresis timing.
- **E2E:** with `MONITORING_*` test env (1 s engine interval, tiny windows), inject synthetic failures (e.g. a provider that always fails via a bogus-URL provider + forced calls) → `alert_events` row appears with `status='firing'`; fix the condition → row resolves.

## Out of scope

- Notification delivery (P2-02), the API surface (P2-03), manual ack (P2-03), rule UI (Console, P4-04).
