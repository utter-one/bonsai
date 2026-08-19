---
title: "P2-01 — AlertRuleEngine: rules, state machine, default rules"
severity: proposal
status: open
created: 2026-08-17
updated: 2026-08-18
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
  metrics: MetricsSnapshot;                      // P1-02 — gauges read as-is (rss_bytes, event_loop_lag_*)
  windowSum: (name: string, labels: Record<string, string>, windowMs: number) => number;
                                                // windowed counter sum — delta ring, see below (finding 1)
  health: HealthSnapshot;                        // P1-05 (incl. db check detail { poolTotal, poolIdle, poolWaiting })
  providerNames: Map<providerId, { name: string; providerType: string }>;  // providers table — messages + per-type thresholds (finding 7)
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
  rejections: { api: number; auth: number; topKeys: RateLimitRejectionKeyStats[] };  // P1-07 — api/auth = windowed deltas; topKeys = CUMULATIVE per-process map (finding 3)
  breakers: Map<providerId, 'closed' | 'open' | 'half-open'>;  // P3-01 (empty until Phase 3 — inert branch)
  probeFailures: Map<providerId, number>;        // consecutive probe failures — P1-05
};
```

Per-provider rules (`scope: 'per_provider'`) evaluate once per providerId observed in `callLogs` ∪ `breakers` ∪ `probeFailures` ∪ `fallbackEventCounts` (the last union member is required for `fallback-active` — finding 11); alert key = `ruleId:providerId`. Global rules evaluate once. When a 429 rule finds one key hash caused >50% of the *tracked* rejections (top-N map is cumulative per process, not windowed — finding 3), the alert key's scope part becomes `key:<hash>` (detail includes the hash) — the per-key scoping from PROPOSAL §3.3, applied to both `api-429-spike` and `auth-429-spike`.

**Windowed counter reads (finding 1):** `MetricsSnapshot.counters` are cumulative since process start — a raw snapshot cannot answer "≥20 in 5 min". The engine keeps a per-series **delta ring**: each pass samples the four windowed counter metrics (`api_requests_total`, `rate_limit_rejections_total`, `oauth_refresh_total`, `imap_poll_total`), records `delta = current − previous` (negative → 0, counter reset) with a timestamp, and trims entries older than the largest active rule window + 2 passes. `windowSum(name, labelFilter, windowMs)` sums ring deltas with `ts ≥ now − windowMs` over series whose labels match the filter's keys exactly. Gauges need no windowing (read as-is). The ring is in-memory (lost on restart; the first pass after restart re-accumulates — same posture as the alert state). This keeps every metric-based rule **DB-independent**: with the DB down, `windowSum` still works from the in-memory registry, and `db-down` still fires from the health snapshot.

### Default rules (full set from PROPOSAL §3.3 tables — 20 rules: 15 general + 5 streaming, incl. `provider-auth-failed`; the 21st, `provider-chain-exhausted`, is added by P3-06)
`db-down`, `db-pool-saturated`, `provider-down`, `provider-degraded`, `provider-rate-limited`, `provider-auth-failed`, `service-stalled`, `api-5xx-spike`, `api-429-spike`, `auth-429-spike`, `oauth-refresh-failing`, `imap-poll-failing`, `high-memory`, `event-loop-lag`, `fallback-active`, `stream-slow-ttft`, `stream-stalls`, `tts-rtf-degraded`, `asr-final-latency`, `stream-abort-rate`.
Per-provider rules (`provider-*`) are evaluated per provider id from data at evaluation time — not pre-instantiated per provider.
Rule conditions (exact — each is one registered evaluator; params are the defaults shown in parentheses, overridable via `monitoring_config.rules[id]`):

- `provider-down` (critical) = **anyOf**: error rate = 100% over ≥5 calls in 10 min (`callLogs`) **or** breaker `open` (`breakers`) **or** ≥3 consecutive probe failures (`probeFailures`).
- `provider-degraded` (warning) = **anyOf**: error rate > 30% in 10 min (minSamples 10) **or** p95 duration > per-type threshold (LLM 20 s, ASR 2 s, TTS 5 s, channel 10 s). minSamples 10 applies to **both** branches; the per-type threshold comes from the provider record's `provider_type` (finding 7) — `embeddings`/`storage` have no latency threshold, so for them only the error-rate branch can fire.
- `provider-rate-limited` (warning) = `errorCounts['rate_limited']` ≥ 5 in 10 min. `provider-auth-failed` (critical) = `errorCounts['auth']` ≥ 1 in 5 min.
- `db-down` (critical) = `db` check `down` on this pass **and** the previous engine pass (the engine tracks the previous pass's db status in memory — it cannot read `health_checks` when the DB is down, which is exactly when this rule must fire; finding 4). `service-stalled` (warning) = a `service_heartbeat:{name}` check in the snapshot with status `down` (the check encodes the 3×-interval staleness); `unknown` (never ticked) never fires — a service that was never started is not stalled; scope part = `heartbeat:<name>`. `db-pool-saturated` (warning) = db detail `poolWaiting > 20% × poolTotal` — rule default `forMinutes` = 5, so the "for 5 min" semantics come from sustainment (as with event-loop-lag; finding 15).
- `api-5xx-spike` (warning) = `windowSum('api_requests_total', {status_class: '5xx'}, 5 min)` / `windowSum('api_requests_total', {}, 5 min)` > 5% (minSamples 20 on the denominator — the label is `status_class` with values `2xx`…`5xx`, not a raw status; finding 2). `api-429-spike` (warning) = ≥20 `windowSum('rate_limit_rejections_total', {scope: 'api'}, 5 min)` — the PROPOSAL §3.3 "429 ratio" branch is **dropped** (finding 2: `status_class` lumps 429 into `4xx`, so no 429-ratio source exists; the rejection counter is the authoritative source for Bonsai's own limiter) — per-key scoping as above. `auth-429-spike` (warning) = ≥5 `windowSum('rate_limit_rejections_total', {scope: 'auth'}, 15 min)` — **same per-key scoping** as api-429-spike (dominant key within `scope=auth` → scope part `key:<hash>`; generalizes PROPOSAL's "scoped to the offending IP" to operator/ip keys).
- `oauth-refresh-failing` / `imap-poll-failing` (warning) = `oauth_refresh_total{ok=false}` ≥ 3 in 60 min / `imap_poll_total{ok=false}` ≥ 5 in 60 min.
- `high-memory` (warning) = `rss_bytes` gauge (published by P1-05's `process` check) > `threshold` (default 1536 MB — mirrors the health check's `MONITORING_MEMORY_THRESHOLD_MB` default; the rule's own knob is `rules['high-memory'].threshold` in **bytes** — the env var still drives only the health check; finding 14). `event-loop-lag` (warning) = `event_loop_lag_p95_ms` gauge (P1-05 keeps a 60 s in-memory delay-sample window and publishes the gauge each cycle) > 250 ms — the "5 min" semantics come from `forMinutes` sustainment (document this in the rule's message). Optional burst variant: `event_loop_lag_max_ms` gauge (same window, P1-05 finding 11 follow-up) catches isolated stalls p95 misses — a single long block yields one coalesced sample, so p95 alone stays below threshold for bursty blocking; use `forMinutes` sparingly with max (a recurring one-off stall would otherwise sustain the alert).
- `fallback-active` (info, per-provider) = ≥1 `fallback_events` row for that provider in 10 min — evaluated over providerIds in `fallbackEventCounts` (not callLogs — a provider with zero calls but an executed fallback must still alert; finding 11). Inert until Phase 3 writes rows (expected in Phases 1–2; P3-06 verifies per-provider scoping).
- Streaming (all per-provider; 10-min call-log window; denominators + minSamples pinned by finding 16): `stream-slow-ttft` (warning) = ttft p95 > 10 s (LLM) / 3 s (TTS; `ttftMs` key in `metrics`, p95 over rows that have it, minSamples 10); `stream-stalls` (warning) = `stalledFraction` > 10% — fraction of rows **with a `maxChunkGapMs` value** (rows that actually streamed; single-chunk responses don't dilute), minSamples 10 such rows; `stream-abort-rate` (warning) = `midStreamErrorFraction` > 10% — rows with `errorPhase='mid_stream'` over **all** the provider's rows in the window, minSamples 10; `tts-rtf-degraded` (warning) = `rtfOver1Fraction` > 10% — fraction of rows **with an `audioDurationMs` value** where `duration_ms > audioDurationMs`, minSamples 10; `asr-final-latency` (info) = `eosToFinalP95Ms` > 10 s (p95 over rows with an `eosToFinalMs` value), minSamples 5.

Implementation notes:
- `provider-*`/`stream-*` data comes from ONE rolling-window query per pass over `provider_call_logs` (per-provider aggregates incl. `percentile_cont`; variant fields extracted from the `metrics` jsonb via `->>`), not one query per rule. Plus two small queries: `fallback_events` counts per provider (10-min window) and `providers` names/types for the evaluated ids only.
- Config validation: P2-01 exports the rule registry and tightens the P1-06 config schema with a `refine` — unknown rule id in `rules` → 400 (P2-03's PUT picks this up automatically).
- Loop (finding 9): **setInterval** (HealthCheckService pattern), not node-cron — node-cron cannot express sub-minute intervals and e2e needs ~1 s. `intervalMs = MONITORING_ALERT_ENGINE_INTERVAL_MS` (≥ 1000; test seam) ?? `config.alerting.engineIntervalMinutes × 60000` (schema minimum 1). Config changes are picked up live: each pass compares the effective interval and reschedules on change. `isProcessing` guard skips a pass if the previous one is still running.
- Data-source failures are isolated per source (finding 19): a failed `provider_call_logs`/`fallback_events`/`providers` query (DB down) logs + substitutes an empty map — dependent rules evaluate with no data (→ condition false, never a crash); in-memory sources (health snapshot, delta ring) keep working, so `db-down` fires during the very outage it detects.
- `HealthCheckService` gains `getProbeFailureCounts(): Map<providerId, number>` (additive, P2-01) so providers with ≥3 probe failures but zero call-log rows are still evaluated by `provider-down`'s probe branch (finding 6). Until then the map is only reachable per-id and such providers would be invisible.
- `breakers` provider: P2-01 wires an empty map (P3-01 swaps in the real one via the same data-provider seam — the engine never imports P3 code).
- Config load: the engine's first pass loads `MonitoringConfigService.get()`; if that fails (DB down at boot) it falls back to `monitoringConfigSchema.parse({})` and retries the real config on later passes (finding 19).

### State machine (per alert key)

The alert key is `ruleId:scopePart` where scopePart ∈ { `global`, providerId, `key:<hash>`, `heartbeat:<name>` }. The DB `scope_key` column stores this **full key** (e.g. `provider-down:prov_123`) and the engine's in-memory state map is keyed by the same string (finding 5).
```
ok → pending    (condition true; recorded pendingSince)
pending → firing (true continuously for `forMinutes`)   → AlertEventPublisher.fire(event)
firing → resolved (condition false for `resolveAfterGoodChecks` consecutive evaluations, or maxUnresolvedHours) → publisher.resolve(event)
firing → firing (cooldown suppresses duplicate fire() calls while condition stays true)
```
- State kept in memory (process restart resets state — acceptable; the first evaluation after restart re-derives from windows). `alert_events` is the durable record.
- **Startup reconciliation (finding 12):** on the first pass, orphaned `firing` rows whose `fired_at` is older than the rule's `maxUnresolvedHours` are resolved (`resolved_at = now`, context note `engine-restart`) — a restart orphans in-memory state, and the safety valve must apply durably or orphaned rows would stay firing forever.
- `publisher.fire()/resolve()` are invoked **without awaiting** from the evaluation pass (unhandled-rejection-safe by contract — publishers never throw), so a slow notifier can never stall the loop (P2-02's 15 s cap is internal to the publisher). The engine still attaches `.catch(log)` to every call — belt-and-braces, never relying on the contract alone (finding 18).
- **Cooldown precedence (finding 8):** `rules[id].cooldownMinutes` > `alerting.defaultCooldownMinutes` (config, default 15) > rule-definition default (15 min). Cooldown is enforced at the pending→firing transition: a key that just fired cannot fire again until `now − lastFiredAt ≥ cooldownMinutes`.
- **Disabled rules:** `rules[id].enabled = false` stops evaluation entirely — no new fires and no auto-resolve of existing firing rows (disabling detection is not resolving the incident).
- **Missing data = condition false (finding 13):** a gauge with no sample yet (before the first health cycle) or a counter with zero traffic never fires — no false positives at boot.
- Evaluation loop: setInterval per the Loop note above, `isProcessing` guard, all rules evaluated in one pass; a failing evaluation (DB down for call-log queries) must not crash the loop — log + skip rule (and note: if DB is down, `db-down` still fires from the health snapshot, which is in-memory).

### `AlertEventPublisher` (seam)
- Interface: `fire(event: AlertEvent): Promise<void>`, `resolve(event: AlertEvent): Promise<void>`.
- **DI seam (finding 10):** the engine does not depend on the concrete publisher — it injects the interface via a string `InjectionToken` (`ALERT_EVENT_PUBLISHER_TOKEN`, house pattern per `ISecretsManagerRegistryToken`). P2-01 registers `LogAndPersistPublisher` against the token in `server.ts`; P2-02 swaps the registration to a notifying wrapper without touching the engine.
- P2-01 implementation `LogAndPersistPublisher`: writes/updates `alert_events` row (firing: insert; resolved: update `status`+`resolved_at`; `notifications: []`), pino log at severity-appropriate level. P2-02 wraps this with notification dispatch.
- Event: `{ id, ruleId, scopeKey, scope, severity, message (rendered, human-readable, includes provider name/thresholds/actual values), context (jsonb: metric values, window, top keys), firedAt, resolvedAt? }`.

## Acceptance criteria

- [ ] Every default rule has a unit test proving it fires with synthetic data and does not fire just below threshold (boundary cases incl. `minSamples` not met).
- [ ] Hysteresis: condition flapping true/false faster than `forMinutes`/`resolveAfterGoodChecks` never produces firing→resolved→firing churn (assert on `alert_events` rows).
- [ ] Cooldown: sustained condition with a transient 1-good-evaluation dip re-fires at most once per `cooldownMinutes`.
- [ ] `db-down` fires from health snapshot even when call-log queries fail (DB unavailable).
- [ ] `api-429-spike` scopes to the offending key hash when one key dominates (unit test with synthetic top-N).
- [ ] Engine loop survives a thrown rule evaluation (isolated per rule).
- [ ] Startup reconciliation resolves orphaned firing rows older than `maxUnresolvedHours` on the first pass.
- [ ] Missing metric data (pre-first-cycle gauge, zero-traffic window) never fires a rule.

## Tests

- **Unit:** state machine (all transitions incl. maxUnresolved auto-resolve), each rule family with synthetic metric/log fixtures (use fakes injected via constructor — the engine must not read singletons directly for data: accept data-provider functions), cooldown/hysteresis timing.
- **E2E:** with `MONITORING_ALERT_ENGINE_INTERVAL_MS=1000` (test seam) and rule params overridden tiny via the engine's config-provider seam (the app-world `MonitoringConfigService` singleton is not the instance the test world writes to — see Implementation notes, item 1): (1) a gauge rule (`high-memory` with a 1-byte threshold) fires → `alert_events` row `status='firing'` appears within a few passes; then the threshold is raised via a config save → the row resolves; (2) `provider-down` via `CallLogger.record()` ×5 failing rows + `flushNow()` (no real network — same forced-call pattern as the monitoring-core e2e) → firing row for the provider key. Both assert the full fire→resolve trail on `alert_events` (finding 17).

## Out of scope

- Notification delivery (P2-02), the API surface (P2-03), manual ack (P2-03), rule UI (Console, P4-04).

## Soundness review (2026-08-18)

Spec verified against the P1 codebase before implementation. Findings (referenced inline as `finding N`):

1. **Windowed reads over cumulative counters.** `MetricsSnapshot.counters` are cumulative since process start; a raw snapshot cannot answer "≥20 in 5 min". Resolution: engine-side per-series **delta ring** (sample each pass, `delta = current − previous`, negative → 0 on counter reset, trim by largest active window) exposed to evaluators as `windowSum(name, labelFilter, windowMs)`; gauges read as-is. Side benefit: metric-based rules stay DB-independent, so `db-down` fires during the outage it detects.
2. **`api-429-spike` 429-ratio branch is uncomputable.** `requestOutcome` labels requests with `status_class` (`2xx`…`5xx`) — 429 is indistinguishable from other 4xx. Resolution: drop the ratio branch (synced in PROPOSAL §3.3); `rate_limit_rejections_total{scope=api}` is the authoritative source for Bonsai's own limiter 429s.
3. **Top-N key dominance is cumulative, not windowed.** `getRateLimitRejectionStats().topKeys` is a per-process top-10 map (min-count eviction). The ">50% of rejections" dominance test runs over the *tracked* (cumulative) map, not the window — documented in the rule condition.
4. **`db-down` "2 consecutive checks" cannot read `health_checks`.** When the DB is down (exactly when the rule must fire), its own history table is unreachable. Resolution: the engine tracks the previous pass's db check status in memory; condition = down on this pass and the previous pass.
5. **Alert-key naming vs the DB column.** The `alert_events.scope_key` comment stores the *full* key (e.g. `provider-down:prov_123`). Resolution: the in-memory state map and the DB column both store `ruleId:scopePart`; the spec's "scopeKey" wording now points at the full key explicitly.
6. **Probe-failure branch was invisible for zero-traffic providers.** `HealthCheckService.probeFailures` is a private map with per-id getters only — a provider with ≥3 probe failures but no call-log rows would never enter the per-provider evaluation set. Resolution: additive `getProbeFailureCounts(): Map<providerId, number>`.
7. **Rule messages need provider names + per-type thresholds.** Resolution: `providerNames: Map<id, {name, providerType}>` in `EvaluationData` (single query for the evaluated ids); `provider-degraded`/`stream-slow-ttft` thresholds come from the provider record's `provider_type` (`embeddings`/`storage` have no latency threshold).
8. **Cooldown precedence was unspecified.** Resolution: `rules[id].cooldownMinutes` > `alerting.defaultCooldownMinutes` (config, default 15) > rule-definition default (15 min).
9. **node-cron cannot express the e2e sub-minute interval.** Resolution: setInterval (HealthCheckService pattern) with `MONITORING_ALERT_ENGINE_INTERVAL_MS` (≥1000) test seam; otherwise `alerting.engineIntervalMinutes` (schema minimum 1), re-adopted live when the config changes.
10. **Publisher seam mechanics.** Resolution: string `InjectionToken` (house pattern per `ISecretsManagerRegistryToken`), registered against `LogAndPersistPublisher` in `server.ts`; P2-02 swaps the registration without touching the engine.
11. **Per-provider evaluation set was incomplete.** It must be `callLogs ∪ breakers ∪ probeFailures ∪ fallbackEventCounts ∪ counter-provider-ids ∪ tracked-state keys` — otherwise `fallback-active` (fallbacks with zero calls), `provider-down` (probe-only), and `oauth-refresh-failing`/`imap-poll-failing` (counter-only) would miss their providers, and keys whose data disappears could never resolve. Tracked-state keys are always re-evaluated (synthesized not-met when data is gone) so firing alerts resolve when their subject disappears.
12. **Orphaned firing rows after restart.** Alert state is in-memory; a restart orphans `firing` rows that nothing would ever resolve. Resolution: startup reconciliation on the first pass — resolve orphaned `firing` rows older than the rule's `maxUnresolvedHours` (durable application of the safety valve).
13. **Missing data must never fire a rule.** Pre-first-cycle gauges (no `rss_bytes` yet) and zero-traffic windows evaluate to not-met — no false positives at boot.
14. **`high-memory` threshold control plane.** The spec originally pointed at `MONITORING_MEMORY_THRESHOLD_MB`, but env is not the config plane ("params are in config"). Resolution: rule param `threshold` in **bytes**, default 1536 MB (mirrors the health-check default); the env var still drives only the health check.
15. **`db-pool-saturated` "for 5 min" semantics** come from rule default `forMinutes = 5` (sustainment), matching the event-loop-lag pattern — not from a 5-minute data window.
16. **Streaming denominators + minSamples pinned.** `stream-stalls` over rows *with* a `maxChunkGapMs` value (single-chunk responses don't dilute); `tts-rtf-degraded` over rows *with* an `audioDurationMs`; `stream-abort-rate` over *all* provider rows in the window; `stream-slow-ttft`/`asr-final-latency` over rows with the respective key; minSamples 10/10/10/10/5.
17. **E2E without real network.** Forced call rows via `CallLogger.record()` + `flushNow()` (the monitoring-core e2e pattern) drive `provider-down`; the gauge rule (`high-memory` with a 1-byte threshold) drives a fast fire→resolve cycle; 1 s engine interval via `MONITORING_ALERT_ENGINE_INTERVAL_MS`; tiny params via the engine's `setConfigProviderForTests` config seam (see Implementation notes, item 1).

## Implementation notes (2026-08-18)

1. **E2E config goes through the engine seam, not the config service.** (Diagnosis corrected 2026-08-19 by P2-02: it was NOT a dual-module-graph problem — the container is shared. `MonitoringConfigService` was a plain `@injectable()`, i.e. *transient*: every injection point got its own instance with its own private cache. P2-02 changed it to `@singleton()`, so saving through the shared service is now picked up by the engine without a seam — the separate tsyringe string-token cache quirk that DOES remain, for the publisher token, is P2-02 note 1.) The engine therefore still exposes `setConfigProviderForTests(provider)`; the P2-01 e2e keeps the seam for hermeticity. The engine therefore exposes `setConfigProviderForTests(provider)` (production path = `MonitoringConfigService.get()` with the schema-defaults fallback from finding 19); the e2e sets the provider per-test and resets it to `null` afterwards.
2. **Windowed SQL is a two-stage CTE.** `jsonb_object_agg(error_code, count(*))` is invalid Postgres (nested aggregates — parse error 42803); per-code counts are aggregated first (`errors_by_code`), then folded to a jsonb map (`errors_agg`). Discovered in e2e: finding 19's per-source isolation correctly swallowed the parse failure, which is why the unit suite (fakes) and tsc stayed green while the live engine saw no call-log data at all.
3. **`forMinutes: 0` fires on the first met pass.** The pending transition and the sustainment check happen in the same pass ("immediate" semantics); `forMinutes > 0` unchanged (sustained across N minutes of pending passes).
4. **Resolve persists the full context.** `LogAndPersistPublisher.resolve()` writes `context` (including `resolutionReason`: `auto` | `max_unresolved_hours` | `engine_restart`) so the P2-03 query API can show why an alert resolved.
5. **Config validation.** `monitoringConfigSchema` gained a `.superRefine()` rejecting unknown rule ids (config typo → 400 at save, not a silently-ignored override).
18. **Publisher calls are double-guarded.** The engine attaches `.catch(log)` to fire-and-forget `fire()`/`resolve()` calls regardless of the never-throw contract.
19. **Per-source failure isolation + config fallback.** A failed `provider_call_logs`/`fallback_events`/`providers` query logs + substitutes an empty map (dependent rules see no data → not-met); a failed `MonitoringConfigService.get()` (DB down at boot) falls back to schema-parsed defaults and retries on later passes.
