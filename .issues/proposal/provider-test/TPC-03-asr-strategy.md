---
title: "TPC-03 — ASR strategy: real WebSocket session + silence"
severity: proposal
status: open
created: 2026-08-24
updated: 2026-08-24
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
