---
title: "P3-01 — CircuitBreaker + registry, wired into CallLogger outcomes"
severity: proposal
status: open
created: 2026-08-17
updated: 2026-08-17
assignee: ""
tags: [monitoring, spec, phase-3]
---

# P3-01 — CircuitBreaker + registry, wired into CallLogger outcomes

- **Phase:** 3 — Failover
- **Depends on:** P1-03 (call outcomes carry `errorCode`)
- **Blocks:** P3-03, P3-04
- **Estimate:** 1 dev-day

## Objective

Per-provider circuit breakers that stop hammering a dead provider (and make failover decisions instantaneous), driven automatically by the call outcomes P1-03 already records — zero new call sites.

## Scope

### New files
- `src/services/monitoring/CircuitBreaker.ts`
- `src/services/monitoring/CircuitBreakerRegistry.ts` (`@singleton`)

### Modified files
- `src/services/monitoring/CallLogger.ts` — on `record(entry)`: `breakerRegistry.recordSuccess(providerId)` if `entry.ok`, else `breakerRegistry.recordFailure(providerId, entry.errorCode)` (in-memory only — the breaker is a pure in-process state; it does **not** survive restarts — see "State on restart" below)
- `src/services/monitoring/HealthCheckService.ts` — provider health detail includes breaker state
- `src/http/controllers/MonitoringController.ts` — `GET /api/monitoring/providers` response gains the `circuitBreaker` field (P1-08 endpoint; response schema in `src/http/contracts/monitoring.ts`)
- `src/errors.ts` — `CircuitOpenError extends Error`. **Decision:** `CircuitOpenError` is internal — failover wrappers (P3-03/P3-04) catch it and move to the next chain member; on chain exhaustion it is replaced by the original provider error. It must never reach `errorHandler` raw; as a safety net, map it to 502 in the handler.

## Implementation requirements

### Breaker state machine (per provider id)
```
closed  → open       (≥ failureThreshold failures within windowMs)
open    → half-open  (cooldownMs elapsed)
half-open → closed   (probe succeeds)
half-open → open     (probe fails; cooldown restarts)
```
- Defaults (all overridable via `monitoring_config`): `failureThreshold: 5`, `windowMs: 60_000`, `cooldownMs: 5 * 60_000`.
- **Which failures count:** `server_error`, `timeout`, `network`, `rate_limited`. **Not counted:** `auth` (won't self-heal → immediate `provider-auth-failed` alert instead, P3-06 rule), `client_error` (bad prompt/payload — provider is fine), `unknown` (counts, conservatively).
- `rate_limited` nuance: counted, but a provider that is *only* rate-limited (no 5xx/timeout/network in the window) opens the breaker with the standard cooldown — that's correct (backing off a throttled provider is the desired behavior).
- `beforeCall(providerId)`: if `open` and cooldown not elapsed → throw `CircuitOpenError(providerId)`; if `open` and cooldown elapsed → allow one probe (state → `half-open`).
- Concurrency: single probe in half-open (second concurrent caller while probe in flight → treated as open, waits or skips per P3-03's ordering — the registry serializes half-open probes with a flag). Every rejected `beforeCall` increments `circuit_open_skips_total{provider_id}`; every closed→open transition increments `circuit_opens_total{provider_id}` and sets the `circuit_breaker_state{provider_id}` gauge (0/1/2).
- **State on restart:** in-memory only. After a restart the breaker is closed, but `provider_call_logs` history + the `provider-down` alert rule (windowed on recent calls) cover the gap — document this.

### Registry
- Lazy per-provider instances, `getState(providerId): 'closed' | 'open' | 'half-open'`, `snapshot()` for `GET /api/monitoring/providers` (P1-08 endpoint — extend its response with `circuitBreaker: { state, failuresInWindow, lastStateChangeAt, opensInLast24h }` — add a `circuit_opens_total{provider_id}` metric here too).
- Exposes `getBreaker(providerId)` to the failover wrappers (P3-03/P3-04) and to `HealthCheckService` (open breaker → provider detail shows `circuit open`).

## Acceptance criteria

- [ ] 5 qualifying failures in 60 s (synthetic `CallLogger.record` calls) → state `open`; next `beforeCall` throws `CircuitOpenError`.
- [ ] After `cooldownMs` (test env: config override to 1 s), next call is a single probe; success → closed, failure → open again.
- [ ] `auth` and `client_error` failures never open the breaker (unit test).
- [ ] Half-open allows exactly one probe under concurrent calls.
- [ ] `circuit_opens_total` / `circuit_open_skips_total` counters + `circuit_breaker_state` gauge + `/api/monitoring/providers` breaker field reflect state.
- [ ] No behavior change for business code (breaker is advisory until P3-03 wires `beforeCall` into failover wrappers).
- [ ] The single-process assumption (breaker state is in-memory; a restart clears it — mitigated by the `provider-down` rule's call-log windows + probe failures) is explicit in this spec's "State on restart" bullet, not left implicit.

## Tests

- **Unit:** full state machine incl. window sliding (failures outside window don't count), all errorCode counting rules, half-open probe serialization, config overrides, metric increments.
- **E2E:** drive a bogus-URL LLM provider through ≥5 calls via an existing endpoint (e.g. quick-prompt or a conversation) → `GET /api/monitoring/providers` shows `open`.

## Out of scope

- Using the breaker to gate non-failover calls (only P3-03/P3-04 failover wrappers ever call `beforeCall`; business code paths never do), cross-instance breaker state — **decision: in-memory, single process.** Restart clears breaker state; the `provider-down` rule (P2-01) covers the restart gap via `provider_call_logs` windows + probe failures. Document this here and in P4-05 docs. Persisted breaker history (call logs are the source of truth).
