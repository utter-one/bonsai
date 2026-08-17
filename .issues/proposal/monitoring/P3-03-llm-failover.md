---
title: "P3-03 — FailoverLlmProvider + ConversationRunner integration"
severity: proposal
status: open
created: 2026-08-17
updated: 2026-08-17
assignee: ""
tags: [monitoring, spec, phase-3]
---

# P3-03 — FailoverLlmProvider + ConversationRunner integration

- **Phase:** 3 — Failover
- **Depends on:** P3-01, P3-02
- **Blocks:** P3-06
- **Estimate:** 2 dev-days

## Objective

A conversation's LLM calls (completion, classification, transformation, tools, filler, guardrails, moderation) transparently try the provider's fallback chain when the primary fails **before the first token** — the single biggest production-stability win in the proposal. A conversation only fails when the **entire chain** is dead.

## Scope

### New files
- `src/services/providers/llm/FailoverLlmProvider.ts`

### Modified files
- `src/services/live/ConversationRunner.ts` — `buildStageData()`: wrap each LLM instance (completion provider, classifier, transformer, guardrail LLM, sample copy, filler, moderation) with `FailoverLlmProvider` when its chain length > 1 (chain resolved via `FallbackResolver`; wrap lazily/cached per conversation to avoid N resolves per turn)
- `src/services/monitoring/CallLogger.ts` — entries emitted by failover attempts carry `fallback_provider_id` when the attempt is not the primary

## Implementation requirements

### `FailoverLlmProvider implements ILlmProvider`
- Constructor: `(primary: ILlmProvider, steps: FallbackStep[], baseSettings: LlmSettings, deps: { breakerRegistry, resolver, callLogger, factory, logger })`. Fallback instances are created **lazily, on first attempt**, via `LlmProviderFactory.createProvider(step.provider, mergeSettings(baseSettings, step.settings ?? {}))` — `createProvider` takes a full provider row + settings (verified signature); `baseSettings` is the agent-level LLM settings the runner already built for the primary, and each step's `settings` override merges on top. Cache the instances on the wrapper for the conversation's lifetime.
- `generateStream(params)`:
  1. For each step in `[primary, ...fallbacks]`:
     - `breakerRegistry.beforeCall(step.provider.id)` — `CircuitOpenError` → skip to next. **Decision:** a breaker skip produces **no** `fallback_events` row and **no** call-log row (no call was made) — it produces a pino warn + the `circuit_open_skips_total{provider_id}` metric (P3-01). Only *attempted* calls produce call-log rows.
     - Attempt with **1 retry** (500 ms backoff) if the failure is `timeout` or `server_error` in the setup phase.
     - Setup-phase failure (before first chunk, incl. auth/client_error) → record `fallback_events` row (`provider_id`=failed, `fallback_provider_id`=next attempted, `operation`, `reason`=errorCode, project/conversation from `MonitoringContext`, `success=false` — success stamped later when the chain outcome is known; see below), increment `fallback_attempts_total{provider_id}`, continue to next step.
     - **Mid-stream failure → no failover.** The stream has already emitted tokens to downstream (TTS pipeline / response state); silently re-running the completion would corrupt the turn. Surface the error exactly as today (`notifyError` → conversation failure path) + the call-log row has `errorPhase='mid_stream'` (already from P1-03) so the `mid_stream` failure rate is observable/alertable.
     - Success → return this step's stream; mark the preceding `fallback_events` rows of this attempt chain `success=true` (the row whose fallback was the one that succeeded).
  2. Chain exhausted → rethrow the **last** attempt's original error (conversation fails via existing path) + increment `provider_chain_exhausted_total{provider_id}` metric (P3-06 rule reads this / or the fallback_events rows).
- `generate(params)` (non-streaming): identical logic without the mid-stream distinction (any failure → next step).
- `enumerateModels()`, `moderateUserInput()`: delegate to primary only (no failover — low blast radius, keeps it cheap).
- Identity: the wrapper exposes the primary's id as a `readonly primaryId: string` field (audit/`fallback_events` semantics). **No `ILlmProvider` interface change** — the interface has no `getProviderId()` and we don't extend it. Every attempt's call-log row carries the *attempted* provider id + `fallback_provider_id` when applicable (the P1-03 base-class stamping already does the attempted-id part).

### Fallback events semantics
One `fallback_events` row **per transition** (primary→f1, f1→f2...), `success` = whether the *next* provider in the chain ultimately served the request. This keeps the table a clean transition log (P3-06 endpoint) and matches the `fallback-active` rule ("any fallback executed").
**Persistence (two-phase):** the wrapper inserts the row at transition time with `success=false` (via `FallbackEventService` — P3-02's single write path for `fallback_events`, also used by P3-04/P3-05), then issues one `UPDATE ... SET success=true WHERE id=...` for the transition whose fallback served the request when the attempt chain completes. Chain exhaustion leaves all rows `success=false`. Both statements are fire-and-forget with the standard monitoring failure policy (log, never throw).

### Integration detail
- Wrap only when chain length > 1 — no overhead for the ~99% of configs without fallbacks.
- The wrapped provider must be created per conversation (chains can change between conversations; resolver cache makes it cheap) and disposed with the conversation (stream cleanup hooks preserved — the wrapper forwards `cleanup()` to the active attempt; `ILlmProvider` has no `cancel()`, and in-flight stream teardown remains each provider's own lifecycle).

## Acceptance criteria

- [ ] Unit: primary fails pre-token (401 / 500 / timeout / network) → fallback stream is served; response bytes are the fallback's.
- [ ] Unit: primary emits ≥1 chunk then errors → wrapper rethrows, **no** fallback attempt (assert fallback provider never called), `errorPhase='mid_stream'` row present.
- [ ] Unit: primary's breaker open → skipped (no call, no call-log row, skip metric), fallback served.
- [ ] Unit: whole chain dead → original last error thrown, `provider_chain_exhausted_total` incremented, one fallback_events row per transition.
- [ ] Unit: retry-once applies to setup-phase timeout/server_error (2 attempts at primary before moving on), never to auth/client_error.
- [ ] E2E: two bogus-URL providers (A primary, B fallback, both 401) + stage → conversation attempt produces 2 call-log rows + 1 fallback_events row (`success=false`) + conversation fails (today's behavior preserved for exhausted chains); one bogus + one "working" fake provider (test double registered in the container) → conversation proceeds.
- [ ] Existing conversation e2e suite green (no fallbacks configured → zero behavior change).

## Tests

- **Unit:** `FailoverLlmProvider` with fake `ILlmProvider`s covering the 5 acceptance behaviors + `cleanup()` forwarding + lazy fallback instantiation (assert the factory is only called for steps actually attempted).
- **E2E:** as in acceptance criteria (test double LLM registered via container override — follow the pattern used by existing mocked-provider tests if any; otherwise instantiate the fake in a `before` hook through the factory).

## Out of scope

- Mid-stream recovery (documented limitation, proposal §3.2f), TTS/ASR/storage wrappers (P3-04), channel fallback (P3-05), alert rules for the new signals (P3-06), per-entity fallback selection.
