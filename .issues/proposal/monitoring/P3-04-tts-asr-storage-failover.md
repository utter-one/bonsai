---
title: "P3-04 — TTS/ASR/storage failover wrappers"
severity: proposal
status: open
created: 2026-08-17
updated: 2026-08-17
assignee: ""
tags: [monitoring, spec, phase-3]
---

# P3-04 — TTS/ASR/storage failover wrappers

- **Phase:** 3 — Failover
- **Depends on:** P3-01, P3-02
- **Blocks:** P3-06
- **Estimate:** 1.5 dev-days

## Objective

Extend the same failover semantics to the other three provider types with the same `errorPhase` boundary: failover only for failures **before the first output unit**; mid-session failures fail the turn/conversation as today (but are now recorded and alertable).

## Scope

### New files
- `src/services/providers/tts/FailoverTtsProvider.ts`
- `src/services/providers/asr/FailoverAsrProvider.ts`
- `src/services/providers/storage/FailoverStorageProvider.ts`

### Modified files
- `src/services/live/ConversationRunner.ts` — wrap TTS (per agent's `tts_provider_id` chain) and ASR (per project `asrConfig` provider chain) providers; ASR wrapper exposes `markInputEnded` (P1-03) and rebuilds the active session on the next provider after a setup failure
- Storage call sites (artifact upload/download — `ConversationRunner` / artifact service) — wrap with the storage wrapper

## Implementation requirements

### TTS (`FailoverTtsProvider implements ITtsProvider`)
- `synthesize(...)` (per-turn streaming synthesis): setup-phase failure (before first `onSpeechGenerating` chunk) → next fallback (retry-once on timeout/server_error first, as P3-03); success mid-fallback → `fallback_events` row `success=true`, `operation='tts.synthesize'`.
- Mid-stream (after first audio chunk) failure → **no failover**, surface as today (`markAsFailed` path), `errorPhase='mid_stream'` already logged by P1-03.
- `getOutputFormat()` must agree across the chain. **Decision (definitive): the compatibility check is runtime-only.** `getOutputFormat()` is a provider-*instance* concern, so `ProviderService` write-time validation (P3-02) deliberately does **not** check TTS format — it validates type match / self-ref / cycles / duplicates only. Instead, `assertCompatibleChain` (below) runs at conversation-build time; on format mismatch the incompatible fallback is **skipped** (pino warn + `fallback_incompatible_total{provider_id}` increment) and the conversation continues with the compatible prefix of the chain. No 400, no conversation failure.

### ASR (`FailoverAsrProvider implements IAsrProvider`)
- Failover only around `init()` + `start()` (session setup): failure → next provider, `operation='asr.session'`, `fallback_events` row.
- On a setup failover mid-conversation (previous session died): the runner rebuilds the session on the next provider; any audio sent before the failure is lost for that utterance (documented limitation — user re-speaks; VAD will pick the next utterance).
- Mid-session errors (`recognizing`/`recognized` error callbacks) → no failover, existing conversation-failure path.
- `markInputEnded(ts)` forwarded to the active underlying provider.

### Storage (`FailoverStorageProvider implements IStorageProvider`)
- Per-operation failover: `upload`/`download` — any failure → next provider (no streaming boundary for storage; a failed download before completion is safe to retry on another bucket). Retry-once on timeout/server_error applies.
- Record which provider actually served (call-log rows carry it already via `providerId` stamping — P1-03); **no** schema change to artifact rows (which-provider-stored-the-artifact is visible in call logs; adding an `artifact.provider_id` column is a follow-up, out of scope).

### Shared
- All three wrappers: breaker `beforeCall` + skip semantics identical to P3-03; `fallback_events` rows per transition via `FallbackEventService` (P3-02 — same two-phase success stamping as P3-03); chain-exhausted rethrows the last original error.
- `assertCompatibleChain` (new util in `src/services/providers/`): per-type compatibility predicate (TTS outputFormat equality; ASR: no constraints beyond type; storage: none).

## Acceptance criteria

- [ ] Unit (each wrapper): setup failure → fallback served + `fallback_events` rows; mid-stream (TTS after first chunk / ASR after first partial) → no failover, error surfaces; breaker-open skip; chain exhausted.
- [ ] Unit: TTS chain with mismatched `outputFormat` → incompatible fallback skipped (metric + pino), compatible one used.
- [ ] E2E: TTS — primary bogus (invalid key → `auth`/401 from the provider) + fake working TTS double → turn audio served by fallback (assert via call-log rows); both bogus → conversation fails as today. ASR — primary fails `init` → fallback session established (fake doubles). Storage — primary unwritable local root + healthy second local root → upload succeeds on second, rows for both.
- [ ] Existing suite green with no fallbacks configured.

## Tests

- **Unit:** three wrappers with fakes (mirror the P3-03 matrix, minus the retry nuance duplication — share a test helper if trivial).
- **E2E:** as acceptance criteria (fake doubles via container override; local storage roots under `os.tmpdir()`).

## Out of scope

- ASR mid-session recovery, cross-bucket artifact migration, per-turn TTS provider switching (chain is fixed at conversation build), webhook/channel fallback (P3-05).
