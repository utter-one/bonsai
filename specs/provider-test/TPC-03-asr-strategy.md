---
title: "TPC-03 — ASR strategy: real WebSocket session + silence"
severity: proposal
status: resolved
created: 2026-08-24
updated: 2026-08-26
assignee: ""
tags: [providers, spec, connection-test, phase-1, asr]
---

# TPC-03 — ASR connection strategy

- **Depends on:** TPC-01
- **Blocks:** TPC-09
- **Estimate:** 1 dev-day

## Objective

The `asr` strategy: verify auth + availability by opening a **real
streaming session over the provider's WebSocket data plane** and feeding it
~500 ms of silence — the exact lifecycle a conversation turn runs.

## Scope

### New files

- `src/services/providers/connectionTest/strategies/asr.ts` (registered for
  `providerType 'asr'`)
- `src/services/providers/connectionTest/silence.ts` — builds a ~500 ms
  silence `Buffer` for a given `AudioFormat` (sample rate × bit width ×
  channels; u-law/a-law silence = constant byte). Shared with TPC-09.

### Modified files

- `src/services/providers/asr/AsrProviderFactory.ts`: `createForTest` seam
  (TPC-01 pattern).

## Implementation requirements

1. Lifecycle (always, in this order; `cleanup()` in `finally`):
   `init() → start() → sendAudio(silence) → await onRecognitionStarted
   (or first inbound message, whichever is earlier) → stop() → cleanup()`.
2. Silence = ~500 ms in the provider's **first**
   `getSupportedInputFormats()` format.
3. `phase` progression: `auth` (WS/session established — auth accepted) →
   `first-data` (audio accepted / first inbound message).
   `ok` = session started within the 20 s timeout.
4. A transcript partial is **never required** (silence yields no text); if
   one arrives it is reported in `detail.transcript` as a bonus signal.
5. `protocol: 'websocket'` (all six apiTypes are WS-based: deepgram
   `wss://api.deepgram.com/v1/listen`, elevenlabs
   `wss://api.elevenlabs.io/v1/speech-to-text/realtime`, speechmatics
   `wss://eu|us|global.rt.speechmatics.com/v2`, assemblyai
   `wss://streaming.assemblyai.com`/`streaming.eu.assemblyai.com`, soniox
   SDK realtime, azure SDK WSS) — no per-vendor code in the strategy.
6. This is what Option A **refused for the 60 s periodic probe** (session
   rate limits, false downs) and is exactly right on-demand: one session
   per click, 5 s cooldown. TPC-09 reuses this strategy for the opt-in
   periodic mode; TPC-07 updates the Option A doc to point here.

## Acceptance criteria

- The strategy only calls existing public lifecycle methods (reviewable
  diff = method calls only).
- Auth rejection surfaces as `errorCode 'auth'` (vendor close frame / error
  message classification via `classifyThirdPartyError`).

## Tests

**Unit** (`tests/unit/providers/connection-test-asr.test.ts`) — local `ws`
server standing in for the vendor (no network):

- handshake + one inbound message → `ok:true`, `phase 'first-data'`;
- close with 401-style payload → `ok:false, errorCode 'auth'`;
- no response after open → `timeout` (shortened via test seam);
- mid-stream close **after** session start → still `ok:true` (session was
  established — the test's job is auth + session availability);
- `silence.ts`: 16 kHz 16-bit mono 500 ms → 16 000 bytes of zeros;
  8 kHz u-law 500 ms → 4 000 bytes of `0xFF`.

## Out of scope

- Requiring a transcript (silence test), periodic probing (TPC-09),
  endpoint plumbing (TPC-06).

## Resolution (2026-08-26)

Implemented and green: build ✓, unit 962 passing / 0 failing, e2e
1054 passing / 0 failing.

**Artifacts**

- `src/services/providers/connectionTest/silence.ts` — `buildAsrSilence(format)` (imported by `AsrProviderBase.testConnection()`):
  `pcm_<rate>` → 500 ms of 16-bit mono zeros (rate × 2 bytes); `mulaw` →
  4 000 bytes of `0xFF` (8 kHz); `alaw` → 4 000 bytes of `0x7F` (8 kHz);
  throws on unsupported formats. 500 ms constant (`SILENCE_MS`) — shared
  with TPC-09.
- `AsrProviderBase.testConnection()` (the original `strategies/asr.ts` was
  folded into the base — see TPC-01). `protocol: 'websocket'` (tester
  protocol table), timeout 20_000 (tester timeout table). The tester
  resolves `AsrProviderFactory.createForTest` (TPC-01 pattern) — **without
  `init()`**: the
  lifecycle below is the test, and an init failure must surface as a
  classified result. `test` registers `onRecognitionStarted` /
  `onRecognizing` / `onRecognized` / `onError` **before** `init()`/`start()`
  because Deepgram fires `onRecognitionStarted` on WS `open` and
  ElevenLabs resolves `start()` on the `session_started` message — both
  during `start()`, so registering afterwards would miss the signal.
  Lifecycle: `init → start → sendAudio(silence of first format) → await
  sessionLive (started or first inbound) → stop`; returns `phase
  'first-data'` + `detail: { transcript? }` (bonus only).
- `src/services/providers/asr/AsrProviderFactory.ts` — extracted
  `instantiateProvider(provider, settings)` (the apiType switch) and added
  `createForTest(provider, settings)`: resolves config, instantiates,
  stamps identity for saved providers only (skipped for
  `CONNECTION_TEST_DRAFT_ID`). `createProvider` delegates to the same
  private method — one code path.
- `ElevenLabsAsrProvider` (3 production fixes, all required to make the
  spec's test table observable through the real lifecycle):
  1. `doStart` now connects to `this.realtimeWsUrl` (the seam previously
     existed for `ping()` only) — same default endpoint, overridable to a
     local mock in tests.
  2. **Close-before-session rejection**: a socket close that arrives before
     `session_started` (the real-world 4401 `invalid api key` shape) now
     rejects `start()` with `code`/`reason` in the message — previously it
     hung until the 20 s timeout and misreported `timeout` instead of
     `auth`.
  3. `doStop` null-race: the socket is captured once and re-guarded before
     the final `close()` — an inbound close during the 100 ms finalization
     window previously nulled `this.socket` and turned the close into a
     `TypeError` (`Cannot read properties of null (reading 'close')`).

**Notes / known siblings**

- The provider bases expose `cleanup()`; the tester's `boundedCleanup`
  awaits `instance.cleanup()` (bounded) after the timeout/finally.
- `DeepgramAsrProvider.doStop` has the same latent null-race shape (close
  after `await 100ms` without re-guarding); not fixed here (out of
  scope) — flagged for a follow-up.
- The silence session records one `asr.session` call-log row with
  `ok: false` (no finals — production session semantics: a session with
  no recognized audio is a not-ok session). Breaker exclusion works via
  the ctx-aware `CallLogger` guard (`ctx.operation = 'asr.test'`), since
  `AsrProviderBase.flushSession` hardcodes `operation: 'asr.session'`.
- Unit tests (`tests/unit/providers/connection-test-asr.test.ts`, 11
  tests) run the real `ElevenLabsAsrProvider` against a local `ws`
  server speaking the minimal realtime protocol; the factory seam points
  `realtimeWsUrl` at the mock (vendor-specific code lives in the test,
  never in the base's `testConnection` — all six apiTypes are covered by
  construction).
  Coverage: ok handshake (silence bytes on the wire verified + row +
  breaker not fed), 4401 close → `auth`, no-response → `timeout` (150 ms
  registry seam), mid-stream close → `ok:true`, partial →
  `detail.transcript`, draft → zero rows / zero breaker, and
  `buildAsrSilence` byte-exactness (pcm_16000/8000, mulaw, alaw, invalid).
