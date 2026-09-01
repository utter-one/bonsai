# P3-04: TTS, ASR & storage failover

```yaml
---
id: P3-04
title: TTS, ASR & storage failover
severity: medium
phase: 3
status: resolved
updated: 2026-08-20
depends_on: [P3-01, P3-02, P3-03]
blocks: [P3-05, P3-06]
effort: 1.5 dev-days
---
```

## Background

P3-02 gives every provider a `fallbacks` chain and P3-03 executes it for LLMs.
This issue extends failover execution to the other three provider types. Unlike LLMs,
TTS and ASR are **session-based**: a provider session is opened per turn (TTS) or
pre-warmed across turns (ASR), so the failover boundary is the **session setup**, not a
single request.

## Design

### Shared helpers — `src/services/providers/failoverCommon.ts`

Extracted from the P3-03 wrapper semantics (P3-03 itself stays frozen):
`classifySetupError()`, `isRetryableSetupError()` (`timeout`/`server_error`),
`passBreakerGate()` (`getState()` first — gating must not create registry entries),
`recordTransition()` / `markTransitionSucceeded()` (via `FallbackEventService`,
**awaited**, never throwing), and `exhaustChain()`
(`provider_chain_exhausted_total{provider_id=primary}` + awaited `onError` + throw last
error; descriptive error when every step was breaker-skipped).

### `FailoverTtsProvider` (`src/services/providers/tts/`)

Implements `ITtsProvider`. Wraps a primary + `FallbackStep[]`.

- **Chain position resets every turn**: each `start()` walks the chain from the
  primary (a previously broken primary gets a fresh chance after recovery; an open
  circuit makes the skip instant). A mid-turn `sendText` failover continues from the
  **failed provider's next position** (no looping back within the turn).
- **Setup failover**: `init()`/`start()` rejection → one retry after 500 ms for
  `timeout`/`server_error`, then next provider (init-if-needed + start).
- **Per-turn pre-audio failover**: `sendText()` rejection **before the first
  `onSpeechGenerating` chunk of the turn** → rebuild the session on the next provider
  (init + start + sendText). After the first chunk (`turnDelivered`) the error is
  rethrown — no failover (same semantics as P3-03 mid-stream).
- **Callback-channel errors** (provider `handleError` → `onError` after the setup
  promises resolved) are surfaced as today, not failed over (failing over would require
  resuming the LLM chunk stream into a new session; out of scope).
- **Lazy/pre-created instances**: TTS fallback instances are created **eagerly at
  conversation build time** because output-format compatibility (below) requires the
  instance. Each instance is `init()`-ed exactly once (Deepgram TTS `init()` opens a
  persistent WebSocket — re-init is not safe).
- **Callback suppression**: `onError` deliveries before the first audio chunk of the
  turn are logged + dropped; the chunk forwarder sets `turnDelivered`.
- `end()`/`cancel()` forward to the active provider (no failover — finalization).
  `cleanup()` forwards to the primary + every created instance.
- `getOutputFormat()`/`getSupportedFormats()` delegate to the primary (chain is
  format-compatible by construction).

### `FailoverAsrProvider` (`src/services/providers/asr/`)

Implements `IAsrProvider`. Same chain/retry/breaker/event machinery.

- **Failover only around `init()` + `start()`** (session setup). `start()` with an
  active provider retries it once, then continues the chain from its position;
  without one, walks from the primary.
- `sendAudio`/`markInputEnded`/`stop`/`resetForNewTurn`/`getAllTextChunks` forward to
  the active provider — mid-session errors never fail over.
- Instances are **lazy** (no format constraint — see compatibility below).
- Callbacks (recognizing/recognized/started/stopped/error) forward without
  suppression: a resolved `start()` means the session is live.

### `FailoverStorageProvider` (`src/services/providers/storage/`)

Implements `IStorageProvider`.

- **Per-operation failover on `upload()` and `download()`**: full chain walk per
  operation (breaker gate, retry-once for `timeout`/`server_error`, transition events
  with `operation` = `storage.upload`/`storage.download`). **Instance-creation failure**
  (factory `init()` rejection) is an attempt failure too — the next provider is tried.
- `delete`/`getSignedUrl`/`exists`/`list`/`setOnError` forward to the primary.
- **No artifact migration** (documented limitation): an upload that lands on fallback B
  is never copied to the primary; later reads fail over to B as needed while the primary
  is down, and once the primary recovers, *new* uploads go to the primary only.

### Output-format compatibility — `assertCompatibleChain` behaviour

Per the proposal, an incompatible fallback is **skipped with a pino warning +
`fallback_incompatible_total{provider_id=<skipped fallback id>}`**, and the chain
becomes the **compatible prefix** (walk stops at the first incompatible entry).

- **TTS — hard constraint**: `fallback.getOutputFormat()` must equal the primary's.
  Checked eagerly at build time (instances are created for the check and handed to the
  wrapper pre-created).
- **ASR — none** (spec: "no constraints beyond type"); the runner sends audio in the
  primary's first supported input format, which a fallback may not parse — a
  mid-session recognition failure in that case is the documented trade-off.
- **Storage — none.**

### Call-log attribution

`fallbackProviderId` already exists on the shared `ProviderCallRecord`. The TTS/ASR/
storage **bases** gain a `fallbackOfProviderId` field (emitted as
`fallbackProviderId: this.fallbackOfProviderId ?? null` in their record paths) and an
interface method `setFallbackOf?(providerId: string)` (implemented by the bases) —
duck-typed so the wrapper works across the e2e dual module graph without
`instanceof`.

### Base-class fixes (TTS)

`TtsProviderBase.start()` currently leaks the session row when `doStart()` throws
(ASR already flushes). `start()` now flushes `failSession` on rejection, and
`sendText()` flushes `failSession` on rejection (the session is dead in both cases).
Failed setup/sendText attempts therefore leave a `tts.session` row with
`ok: false` + the fallback attribution.

## Integration

- `ConversationRunner.buildStageData`:
  - TTS site → `createTtsProviderWithFailover(entity, settings)`: factory primary →
    `resolveChain` → eager fallback creation + format-compat prefix → wrap when the
    chain is > 1.
  - ASR site → `createAsrProviderWithFailover(entity, settings)`: same, lazy, no
    compat check.
- `ConversationStorageService.getStorageProvider`: same wrap (resolver + breaker
  registry + event service + metrics injected into the service).
- HealthCheckService probes are **not** wrapped (they test one provider in isolation).

## Implementation notes (2026-08-20)

Deviations / clarifications discovered during implementation:

1. **Storage wrapper takes a `ProviderRow`, all instances lazy** — the storage
   factory's `createProvider` includes `await instance.init()` (a network step),
   so pre-creating the primary would let a primary init failure bypass the chain.
   The constructor therefore takes the primary's DB row and creates *every*
   instance (primary included) lazily via `ensureInstance`; a creation rejection is
   an attempt failure for the chain walk. `ConversationStorageService` branches:
   chain length > 1 → wrapper, chain length 1 → direct factory instance (no wrapper
   overhead for the single-provider case).
2. **The direct pre-audio `sendText` attempt is not retried** — the one-retry for
   `timeout`/`server_error` applies to the chain-walk steps (the next provider's
   start+sendText); the failed provider's own sendText is not re-attempted.
3. **Call-log `fallback_provider_id` semantics** — on `provider_call_logs` the
   column holds the **primary** the call ran on behalf of (the instance is stamped
   `setFallbackOf(primaryId)`), matching P3-03. This is the *inverse* of
   `fallback_events.fallback_provider_id`, which holds the provider that served
   the call. Don't mix them up in queries/dashboards.
4. **ASR `start()` always re-walks the chain from the primary** (per-turn reset),
   not "from the active provider's position" as originally worded. Consequence
   inside one wrapper: after an init failover, a later `start()` re-attempts the
   primary's init (it may have recovered) and can record a second transition.
   In production the runner builds a fresh wrapper per turn, so this is only
   observable in long-lived wrapper scenarios/tests.
5. **Skipped (breaker-open) steps leave no transition row** — consistent with
   P3-03: a skip is not a failed attempt. Breaker skips remain visible via the
   P3-01 `circuit_open_skips_total` metric.
6. **E2E module-graph constraint (storage)**: `StorageProviderFactory.createProvider`
   loads providers via `await import(...)`, which under the e2e runner lands in a
   second module graph — the `instanceof StorageProviderBase` stamp check then
   fails and call-log rows would be silently unattributed. The storage e2e suite
   therefore uses a stub factory that mirrors the real one (construct + `init()` +
   identity stamp) with direct imports in the test graph. Production is a single
   graph and unaffected.

## Acceptance criteria

- [x] TTS: setup-phase failure (init/start) before the first chunk fails over; retry-once
      for timeout/server_error; mid-turn failure after first chunk does **not** fail over.
- [x] TTS: incompatible output-format fallback skipped (warn + `fallback_incompatible_total`),
      conversation continues with the compatible prefix.
- [x] ASR: setup-phase failure (init/start) fails over; mid-session recognition errors do not.
- [x] Storage: per-operation upload/download failover, including instance-creation failure.
- [x] Every fallback transition writes a `fallback_events` row (correct operation:
      `tts.session` / `asr.session` / `storage.upload` / `storage.download`) and marks it
      `success` when the fallback serves; failed attempts leave call-log rows with
      `fallbackProviderId` set.
- [x] Circuit-open fallbacks are skipped without creating call-log noise; exhaustion
      surfaces the last original error + `provider_chain_exhausted_total`.
- [x] Unit + e2e tests; `npm run build` clean.
