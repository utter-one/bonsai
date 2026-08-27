---
title: "TPC-04 — TTS strategy: real minimal synthesis, audio discarded"
severity: proposal
status: resolved
created: 2026-08-24
updated: 2026-08-24
assignee: ""
tags: [providers, spec, connection-test, phase-1, tts]
---

# TPC-04 — TTS connection strategy

- **Depends on:** TPC-01
- **Blocks:** TPC-09
- **Estimate:** 0.5 dev-day

## Objective

The `tts` strategy: verify auth + availability (and voice/model validity)
by running the provider's **production streaming synthesis lifecycle** on a
2–3 word test string, discarding the audio.

## Scope

### New files

- `src/services/providers/connectionTest/strategies/tts.ts` (registered for
  `providerType 'tts'`)

### Modified files

- `src/services/providers/tts/TtsProviderFactory.ts`: `createForTest` seam
  (TPC-01 pattern).

## Implementation requirements

1. Lifecycle (always; `cleanup()` in `finally`):
   `init() → start() → sendText('Test connection.') → end() → cleanup()`,
   with `setOnSpeechGenerating` chunks dropped into a byte counter.
2. Voice: provider config default, or the `voice` input param.
   `ok` = **at least one audio chunk received** — proves the full round
   trip (auth, voice/model validity, streaming delivery).
   Zero chunks after a clean stream end → `ok:false, errorCode
   'server_error'`.
3. `protocol` per apiType transport: `websocket` for elevenlabs
   (`wss://api.elevenlabs.io`), deepgram (`wss://api.deepgram.com/v1/speak`),
   cartesia (`wss://api.cartesia.ai/tts/websocket`); `http`/`sdk` for openai
   (`POST /v1/audio/speech`), soniox (SDK), amazon-polly (SDK
   `SynthesizeSpeechCommand`), azure (SDK synthesizer).
   No per-vendor code in the strategy.
4. No audio persisted, returned, or played. `phase: 'first-data'` on
   success; `detail: { voice, bytes }`.
5. Reused by TPC-09 for the opt-in periodic `ttsProbe: 'synth'` mode.

## Acceptance criteria

- The strategy only calls existing public lifecycle methods
  (`getSupportedFormats()`/`getOutputFormat()` for `detail` if useful).
- Every outcome class maps to the correct `errorCode`.

## Tests

**Unit** (`tests/unit/providers/connection-test-tts.test.ts`) — fake
chunking server (WS and HTTP variants, no network):

- ≥1 chunk → `ok:true`, `detail.bytes > 0`, `detail.voice` set;
- 401 → `ok:false, errorCode 'auth'`;
- zero chunks after clean stream end → `ok:false 'server_error'`;
- hang before first chunk → `timeout` (shortened via test seam);
- audio bytes never touch disk (assert temp-dir-free execution).

## Out of scope

- Audio quality/latency benchmarks (existing benchmark suite), periodic
  probing (TPC-09), endpoint plumbing (TPC-06).

## Resolution (2026-08-26)

Shipped: `TtsProviderBase.testConnection()` (the original
`strategies/tts.ts` was folded into the base — see TPC-01),
`TtsProviderFactory.createForTest` (+ `instantiateProvider` extraction;
stamps only for saved providers), the
`ElevenLabsTtsProvider.wsBaseUrlOverride` test seam, and
`tests/unit/providers/connection-test-tts.test.ts` (7 tests: a fake
ElevenLabs TTS WebSocket server in `ok`/`no-audio`/`hang` modes plus a scoped
`globalThis.fetch` stub for OpenAI in `ok`/`401`/empty modes, a 150 ms
timeout seam, and a temp-dir assertion proving audio is counted but never
persisted).

Semantics as specced: a minimal real synthesis — `init → start →
sendText('Test connection.') → end → await ended → cleanup`; `ok` = at least
one audio chunk; a clean end with zero chunks → `ok:false, phase 'session',
'server_error'`; 30 s timeout. Protocol table: websocket (elevenlabs,
deepgram, cartesia) / http (openai) / sdk (soniox, amazon-polly, azure).
`detail { voice, bytes }`.

Note: the `createForTest` extraction surfaced a dangling `resolvedProvider`
reference left in the factory's instantiation switch (all seven `create*
Provider` call sites referenced the old variable name); fixed to use the
`provider` parameter.
