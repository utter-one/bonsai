---
title: "P1-03 — Instrument all 3rd-party call sites + streaming phase measurement"
severity: proposal
status: open
created: 2026-08-17
updated: 2026-08-17
assignee: ""
tags: [monitoring, spec, phase-1]
---

# P1-03 — Instrument all 3rd-party call sites + streaming phase measurement

- **Phase:** 1 — Instrumentation & health
- **Depends on:** P1-02
- **Blocks:** P1-05, P2-01, P3-01, P3-05, P4-03
- **Estimate:** 2 dev-days

## Objective

Every 3rd-party call in the system produces exactly one `provider_call_logs` row (via `CallLogger`) and metric increments — including streaming phase data (TTFT, chunk gaps, tokens, ASR finalization, TTS real-time factor) per PROPOSAL §3.2a/§3.2f. This is the biggest single diff in Phase 1; keep it mechanical: instrument at the existing choke points, never inline in business logic.

## Scope

### New files
- `src/services/monitoring/StreamStats.ts` — per-stream accumulator (start time, first-unit time, last-unit time, unit count, max gap, finish reason, usage, audio bytes/duration) → `toCallLogFields()`

### Modified files (choke points — see requirements)
- `src/services/providers/llm/LlmProviderBase.ts` (+ factory: set `providerId` on instances)
- `src/services/providers/llm/LlmProviderFactory.ts` — stamp `instance.providerId = provider.id` (and `apiType`) in `createProvider`/`createProviderForEnumeration`
- `src/services/providers/asr/AsrProviderBase.ts`, `src/services/providers/tts/TtsProviderBase.ts`, `src/services/providers/storage/StorageProviderBase.ts` (+ their factories: same stamping)
- `src/services/live/ConversationRunner.ts` — `MonitoringContext.run()` wrappers + `ai_turn_ttft_ms` emission + ASR end-of-speech timestamp + `active_conversations` gauge (incr on conversation start, decr on terminal state)
- `src/channels/websocket/WebSocketChannelHost.ts` — `active_websocket_connections` gauge on socket connect/disconnect
- `src/channels/twilio-messaging/TwilioMessagingConnection.ts` — `sendMessage` outcome (this is the silently-dropped-message gap)
- `src/channels/twilio-voice/TwilioVoiceChannelHost.ts` — `calls.create` (`channel.outbound_call`), webhook handlers (`channel.webhook`), media-stream connection lifecycle (bytes in/out, duration, disconnect reason → gauges/metrics)
- `src/channels/whatsapp/WhatsAppChannelHost.ts` — Graph API send + webhook outcomes
- `src/channels/telegram/TelegramChannelHost.ts` — Bot API send + webhook outcomes
- `src/channels/email/sendgrid/SendGridConnection.ts`, `src/channels/email/ses/SesConnection.ts` (or equivalent), `src/channels/email/smtp-imap/*Connection` — send outcomes
- `src/services/OAuth2TokenRefreshService.ts` — `oauth.refresh` per provider (ok/failed + status)
- `src/services/ImapInboundService.ts` — `imap.poll` per cycle (ok, `messages_found`)

## Implementation requirements

### Operation vocabulary (fixed enum, one per call site)
`llm.generate`, `llm.classify`, `llm.transform`, `llm.tool`, `llm.filler`, `llm.moderate`, `llm.models`, `asr.session`, `tts.synthesize`, `storage.upload`, `storage.download`, `channel.send_message`, `channel.outbound_call`, `channel.webhook`, `oauth.refresh`, `imap.poll`.
- The provider base knows only "generate" — the **caller** sets the precise operation via `MonitoringContext` (`llm.classify` in the classifier execution, `llm.filler` in filler generation, etc.) before invoking the provider.

### LLM (covers all 16 providers via `LlmProviderBase`)
- `generate()` (non-streaming): duration, ok, classified error, tokens from result, `errorPhase='setup'` (non-streaming has no mid-stream).
- `generateStream()`: `StreamStats` fed from the existing `notifyStarted/notifyChunk/notifyComplete/notifyError` hooks → `ttftMs` (first `notifyChunk`), `chunksCount`, `maxChunkGapMs`, `finishReason`, `tokensPrompt/tokensCompletion` (from the chunk `usage` payload / completion result).
- `errorPhase`: `'setup'` until the first chunk is delivered; `'mid_stream'` after — this is what Phase 3 failover keys on.
- `enumerateModels()` → `llm.models`; `moderateUserInput()` → `llm.moderate`.

### ASR (`AsrProviderBase`)
- `asr.session` row per session: `setupMs` (init→start), `timeToFirstPartialMs`, `partialsCount`, `finalsCount`, `sessionAudioMs`, `eosToFinalMs`.
- `eosToFinalMs`: provider records final-result timestamp; `ConversationRunner` calls a new `markInputEnded(ts)` on the provider at VAD end-of-speech / last `sendAudio` (the runner already owns that moment). If no final arrives, row is written with `ok=false` on session teardown.

### TTS (`TtsProviderBase`)
- `tts.synthesize` row per turn: `ttft_ms` (time to first `onSpeechGenerating` audio chunk — the TTS analogue of TTFT, stored in the same generic `ttft_ms` column), `audioBytesOut`, `audioDurationMs` (chunks × sample rate per the provider's output format — the base already knows it via `getOutputFormat()`), `duration_ms` = synthesis wall time, ok/error.

### Storage (`StorageProviderBase`)
- `storage.upload` / `storage.download`: duration, ok, classified error, bytes.

### Channels
- Outbound sends: one row per attempt (ok + classified error + `durationMs`). **Twilio SMS `sendMessage` must log its currently-silent catch** — this closes the dropped-message blind spot.
- Webhooks: one row per inbound webhook with the HTTP status the host returned (200/400/401/403/500/502) — powers the `channel.webhook` failure signal for P2/P4-03.
- Voice media-stream connections: gauge/metric only (active count, bytes, `maxFrameGapMs`, disconnect reason) — no per-frame rows.

### End-to-end turn waterfall
- `ConversationRunner` emits `ai_turn_ttft_ms{project_id}` histogram: user end-of-speech → first TTS audio chunk of the AI turn (all four timestamps already exist in the runner).

### Streaming histograms (fixed set, bucket configs live in `MetricsRegistry`)
`llm_ttft_ms`, `llm_stream_duration_ms`, `tts_ttfa_ms` (TTS time-to-first-audio, per row the `ttft_ms` column), `tts_synthesis_ms`, `asr_setup_ms`, `asr_eos_to_final_ms`, `ai_turn_ttft_ms{project_id}` — per PROPOSAL §3.2b. Token counts are **never** metric labels (cardinality); they live in call-log columns only.

### Business-context propagation
- `ConversationRunner` wraps provider invocations in `MonitoringContext.run({ projectId, conversationId, stageId, operation }, ...)`; channel hosts set `{ projectId, operation }` from the session/API key. Provider bases read the context (P1-02) — no interface changes.

## Acceptance criteria

- [ ] A conversation exercising completion LLM + classifier + TTS + ASR (mock/fake providers in test env) produces ≥4 correctly-attributed `provider_call_logs` rows with streaming fields populated (`ttftMs`, `chunksCount`, `maxChunkGapMs`, `finishReason`, tokens).
- [ ] A failed Twilio SMS send (bad credentials) produces a `channel.send_message` row with `ok=false`, `errorCode` classified, and the conversation path unchanged.
- [ ] OAuth refresh + IMAP poll cycles each produce rows when they run.
- [ ] No measurable latency regression: logging is fully async/batched (verify with a before/after timing of a mock streaming run — must be <5% overhead).
- [ ] `LOG_LEVEL=silent` e2e run stays clean.

## Tests

- **Unit:** `StreamStats` (TTFT, max gap across chunk timing fixtures, finish reason, usage accumulation); `errorPhase` transitions in a fake LLM provider (fail pre-chunk vs post-chunk); ASR `eosToFinalMs` computation.
- **E2E:** mock-streaming-provider conversation → rows + `ai_turn_ttft_ms` observable via `MetricsRegistry.snapshot()`; Twilio send failure row; webhook row with status.

## Out of scope

- Retries, circuit breakers, failover (Phase 3). Webhook dead-lettering (P4-03). Any change to provider behavior on error (everything still fails exactly as today — we only *record*).
