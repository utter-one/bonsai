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
- `src/services/monitoring/StreamStats.ts` — per-stream accumulator (start time, first-unit time, last-unit time, unit count, max gap, finish reason, usage, audio bytes/duration) → `toCallMetrics()` (the `metrics` jsonb object)
- `src/services/monitoring/ProviderCallRecorder.ts` — `@singleton` recorder: the single "1 call = 1 row + 2 generic metrics" path (classification → `CallLogger` → `provider_calls_total` / `provider_call_duration_ms`), plus the `getProviderCallRecorder()` cached accessor for non-DI classes and the `trackWebhookOutcome(res, providerId, apiType, recorder?)` webhook-row helper

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
- `src/services/ImapInboundService.ts` — `imap.poll` per cycle (ok; message count in `metrics.messagesFound` jsonb — `messages_found` is deliberately not a label, see P1-02)

## Implementation requirements

### Operation vocabulary (fixed enum, one per call site)
`llm.generate`, `llm.classify`, `llm.transform`, `llm.tool`, `llm.filler`, `llm.moderate`, `llm.models`, `asr.session`, `tts.synthesize`, `storage.upload`, `storage.download`, `channel.send_message`, `channel.outbound_call`, `channel.webhook`, `oauth.refresh`, `imap.poll`.
- The provider base knows only "generate" — the **caller** sets the precise operation via `MonitoringContext` (`llm.classify` in the classifier execution, `llm.filler` in filler generation, etc.) before invoking the provider.

Variant-specific phase fields measured below are written into the call-log row's `metrics` jsonb column (TS type `CallMetrics` in `schema.ts`) — not flat columns (see P1-01).

### LLM (covers all 16 providers via `LlmProviderBase`)
- `generate()` (non-streaming): duration, ok, classified error, tokens from result, `errorPhase='setup'` (non-streaming has no mid-stream).
- `generateStream()`: `StreamStats` fed from the existing `notifyStarted/notifyChunk/notifyComplete/notifyError` hooks → `ttftMs` (first `notifyChunk`), `chunksCount`, `maxChunkGapMs`, `finishReason`, `tokensPrompt/tokensCompletion` (from the chunk `usage` payload / completion result).
- `errorPhase`: `'setup'` until the first chunk is delivered; `'mid_stream'` after — this is what Phase 3 failover keys on.
- `enumerateModels()` → `llm.models`; `moderateUserInput()` → `llm.moderate`.

### ASR (`AsrProviderBase`)
- `asr.session` row per session: `setupMs` (init→start), `timeToFirstPartialMs`, `partialsCount`, `finalsCount`, `sessionAudioMs`, `eosToFinalMs`.
- `eosToFinalMs`: provider records final-result timestamp; `ConversationRunner` calls a new `markInputEnded(ts)` on the provider at VAD end-of-speech / last `sendAudio` (the runner already owns that moment). If no final arrives, row is written with `ok=false` on session teardown.

### TTS (`TtsProviderBase`)
- `tts.synthesize` row per TTS session (one per AI output turn — the runner starts TTS once per turn, filler and completion share it): `ttftMs` (time to first `handleSpeechGenerating` audio chunk — the TTS analogue of TTFT, stored under the same generic `ttftMs` key in `metrics`), `audioBytesOut` (summed chunk bytes), `audioDurationMs` (summed chunk `durationMs` when the provider supplies it; compressed formats without duration info are skipped, not estimated), `duration_ms` = session wall time (`start()` → `end()`/`cancel()`), ok/error. Barge-in `cancel()` flushes the row as `ok` with `metrics.canceled=true`.

### Storage (`StorageProviderBase`)
- `storage.upload` / `storage.download`: duration, ok, classified error, bytes.

### Channels
- Outbound sends: one row per attempt (ok + classified error + `durationMs`). **Twilio SMS `sendMessage` must log its currently-silent catch** — this closes the dropped-message blind spot.
- Webhooks: one row per inbound webhook with the HTTP status the host returned (200/400/401/403/500/502) — powers the `channel.webhook` failure signal for P2/P4-03.
- Voice media-stream connections: gauge/metric only (active count, bytes, `maxFrameGapMs`, disconnect reason) — no per-frame rows.

### End-to-end turn waterfall
- `ConversationRunner` emits `ai_turn_ttft_ms{project_id}` histogram: user end-of-speech → first TTS audio chunk of the AI turn (all four timestamps already exist in the runner).

### Streaming histograms (fixed set, bucket configs live in `MetricsRegistry`)
`llm_ttft_ms`, `llm_stream_duration_ms`, `tts_ttfa_ms` (TTS time-to-first-audio, per row the `ttft_ms` column), `tts_synthesis_ms`, `asr_setup_ms`, `asr_eos_to_final_ms`, `ai_turn_ttft_ms{project_id}` — per PROPOSAL §3.2b. Token counts are **never** metric labels (cardinality); they live in the call-log `metrics` jsonb only.

### Business-context propagation
- `ConversationRunner` wraps provider invocations in `MonitoringContext.run({ projectId, conversationId, stageId, operation }, ...)`; channel hosts set `{ projectId, operation }` from the session/API key. Provider bases read the context (P1-02) — no interface changes.

## Acceptance criteria (verified 2026-08-17)

- [x] A conversation exercising completion LLM + classifier (mock/fake providers in test env) produces ≥4 correctly-attributed `provider_call_logs` rows with streaming fields populated (`ttftMs`, `chunksCount`, `finishReason`, tokens) — **integration test** (`tests/integration/live/providerInstrumentation.test.ts`): 5 rows (≥3 `llm.generate` + ≥2 `llm.classify`), all attributed, streaming fields asserted. TTS + ASR rows are covered at the base-wrapper level by unit tests (the conversation harness is text-only — no voice path exists in the test infrastructure; see Tests section).
- [x] A failed Twilio SMS send (bad credentials) produces a `channel.send_message` row with `ok=false`, `errorCode` classified, and the conversation path unchanged — **unit test** with a stubbed Twilio client: `errorCode='auth'`, `statusHttp=401`, no rethrow.
- [x] OAuth refresh + IMAP poll cycles each produce rows when they run — **unit tests**: `oauth.refresh` row on a failing refresh (classified `client_error`, rethrown) + no row on the not-expiring early return; `imap.poll` rows for ok (with `metrics.messagesFound`) and connect-failure (classified `network`) cycles.
- [x] No measurable latency regression: logging is fully async/batched — before/after timing of the integration suite (5 runs each, median): 9.37 s pre-instrumentation vs 9.55 s post = **+1.9% (< 5%)**; the post run includes one additional conversation test, so per-test overhead is at noise level.
- [x] `LOG_LEVEL=silent` e2e run stays clean — e2e **stdout** contains only mocha output (pino writes to stderr by design, `src/utils/logger.ts`); stderr holds only pre-existing P1-02 artifacts (one intentional `CallLogger` flush-failure ERROR line from the flush-retry test + a pg deprecation warning), byte-identical in kind to the pre-P1-03 baseline.

## Tests

- **Unit** (`tests/unit/monitoring/p1-03-instrumentation.test.ts`): `StreamStats` (TTFT, max gap across chunk timing fixtures, finish reason, usage accumulation, `toCallMetrics()` sparseness); `ProviderCallRecorder.record()` (row + metrics, 429 classification, MonitoringContext fill-in, invalid-entry guards); `trackWebhookOutcome()` (status → row, ok flag, empty-id skip); `LlmProviderBase` template wrappers via a fake provider (row + tokens on `generate`, `errorPhase` setup vs mid_stream, streaming histograms, `llm.*` context operation override, no-recording without factory stamping); `TtsProviderBase` (one `tts.session` row per session with `chunksCount`/`audioBytesOut`/`audioDurationMs` + `tts_ttfa_ms`/`tts_synthesis_ms` histograms, fatal-error single flush, barge-in `cancel()` → `ok=true` + `metrics.canceled`, factory-stamp guard); `AsrProviderBase` (one `asr.session` row per utterance with `partialsCount`/`finalsCount`/`setupMs`/`timeToFirstPartialMs`/`eosToFinalMs`/`sessionAudioMs` + `asr_setup_ms`/`asr_eos_to_final_ms` histograms, no-final → `ok=false`, superseded-session flush on next `start()`, 429 classification); `StorageProviderBase` (`storage.upload`/`storage.download` rows with `bytesOut`/`bytesIn`, failure rethrow + classified row); `TwilioMessagingConnection` (success + stubbed-failure `channel.send_message` rows via a fake Twilio client, no rethrow); `ImapMailboxSession.runPollCycle` (ok row with `metrics.messagesFound`, connect-failure row classified `network`); `OAuth2TokenRefreshService.processProviderRefresh` (failed-refresh row + rethrow, early-return records nothing); `MonitoringContext` nested merge semantics. The bases expose `protected resolveCallRecorder()` / `resolveMetricsRegistry()` test seams so fakes redirect recording away from the DI container; the container-backed tests (Twilio/IMAP) redirect `container.registerInstance(CallLogger, …)` at a shared quiet logger because the container-resolved recorder singleton keeps the logger it first received.
- **Integration** (`tests/integration/live/providerInstrumentation.test.ts`, loaded by `tests/integration/runner.ts`): a mock-provider conversation with a stage classifier produces ≥4 correctly-attributed `provider_call_logs` rows (≥3 `llm.generate` + ≥2 `llm.classify`) with streaming fields (`ttftMs`, `chunksCount`, `finishReason`, tokens) via the real instrumentation path. Note: the harness `teardown()` calls `container.reset()`, which breaks tsyringe singleton caching post-reset — the test therefore flushes the `CallLogger` held by the cached recorder, and the harness resets the monitoring accessors after each reset.
- **E2E** (existing `tests/e2e/monitoring-core.test.ts`): CallLogger flush/invalid-entry/overflow behaviour. Channel/OAuth/IMAP row mechanics are covered by the unit tests above (stubbed upstreams); a full Twilio/IMAP network fake is out of scope for the mock-provider harness.

## Soundness review (pre-implementation, 2026-08-17)

Findings from codebase verification before implementation. Where these differ from the sections above, this section wins.

1. **`metrics` jsonb keys are camelCase** — the TS `CallMetrics` type (P1-01, `schema.ts`) is the source of truth: `ttftMs`, `chunksCount`, `maxChunkGapMs`, `finishReason`, `tokensPrompt`, `tokensCompletion`, `errorPhase`, `audioBytesOut`, `audioDurationMs`, `canceled` (TTS barge-in), `setupMs`, `timeToFirstPartialMs`, `eosToFinalMs`, `partialsCount`, `finalsCount`, `sessionAudioMs`, `bytesIn`, `bytesOut` (channel/storage payload sizes), `messagesFound` (IMAP). All spec/proposal references to snake_case `ttft_ms` / `max_chunk_gap_ms` / `audio_duration_ms` as jsonb keys are corrected to camelCase (also fixed in PROPOSAL, P1-06, P2-01).
2. **ASR session = per-utterance, not per-conversation.** The runner starts a fresh ASR session per VAD utterance (with pre-warm at idle: `asrProvider.start()` in `changeState('awaiting_user_input')`, claimed via `resetForNewTurn()`). One `asr.session` row per session. `setupMs` = wall time of `start()` (provider `init()` runs once per conversation at prep, so "init→start" only applies to the first session; all sessions report `start()` wall time for consistency). Row flush points: `handleRecognitionStopped()` (normal end), the next `start()` (superseded session), `cleanup()` (conversation end), and immediately on fatal `handleError()`. `ok=false` when no final arrived (spec behaviour preserved — covers unintelligible/silent sessions).
3. **`markInputEnded(ts?)`** is called by the runner at VAD end-of-utterance (before `asrProvider.stop()`) and at barge-in silence timeout. `eosToFinalMs = finalTs − lastMarkInputEndedTs` per session.
4. **LLM operation assignment.** `generate`/`generateStream` become concrete template wrappers in `LlmProviderBase` calling new `protected abstract doGenerate`/`doGenerateStream`; the base owns timing + the single recording path (subclass errors are rethrown after `notifyError`, so the wrapper's catch records exactly once). Subclass renames: OpenAI, OpenAILegacy, Gemini, Mistral, Anthropic (both methods) + Groq (`doGenerateStream` only — 12 providers inherit `OpenAILegacyLlmProvider` and are untouched). Operation: base defaults to `llm.generate`; callers set the precise operation via **nested** `MonitoringContext.run({ operation })` — `llm.filler` (runner filler stream + non-stream), `llm.classify` (`UserInputProcessor` classifier + sample-copy classify), `llm.transform` (`ContextTransformerExecutor`), `llm.tool` (`ToolExecutor`), `llm.moderate` (`moderateUserInput` — only Mistral + Ollama override it; the base default-throw path also records a row so unsupported-provider attempts are visible). `enumerateModels()` → `llm.models` (recorded in the base; providers with static fallbacks may record a successful row with no API call — acceptable, operation label distinguishes).
5. **`MonitoringContext.run` merges nested contexts** (P1-02 module change): a nested `run(ctx, fn)` spreads the outer context first, so inner fields override and unset fields inherit (ALS alone would replace). Required for per-operation wrappers nested inside the turn-level context. Nested-context unit test updated.
6. **Turn-level context**: `ConversationRunner` wraps `processUserInput`, `startConversation`, `resumeConversation`, `runAction`, `callTool`, `executeEndLifecycleAction`, `goToStage` in `MonitoringContext.run({ projectId, conversationId, stageId }, ...)` — covers every LLM call site in the runner and its executors.
7. **`active_conversations` gauge** is driven by `changeState()` (incr on first active state, decr on terminal `finished`/`failed`/`aborted`) plus `markAsFailed()` (the one direct `conversation.status` assignment). Idempotent via a private flag.
8. **`ai_turn_ttft_ms{project_id}`** is observed where the runner first sets `turnData.firstAudioMs` (value = `firstAudioMs − turnData.startMs` — the same value the runner already persists as `timeToFirstAudioMs`). Text-only turns produce no observation (no TTS audio), per spec.
9. **Voice media streams (Twilio)** — per-frame rows are impossible under the fixed 16-operation enum + label allowlist (15 keys incl. `direction`). Instead: new `METRIC_CONFIGS` entries `active_voice_media_streams` (gauge, stream accept→close), `voice_media_bytes_total{direction}` (counter, `direction` ∈ {in,out} — `direction` added to the P1-02 label allowlist), `voice_media_max_frame_gap_ms` (histogram, per-direction frame inter-arrival gaps). Disconnect reason is unbounded → pino warn only (documented deviation from "gauges/metrics only").
10. **Channel row mechanics.** Channel connections are plain (non-DI) classes; hosts (DI singletons) pass the provider ID into the connection constructor: `TwilioMessagingConnection` (inbound webhook + outgoing endpoint), `WhatsAppConnection`, `TelegramConnection`. Email sends funnel through `EmailConnectionBase.sendEmail` → template wrapper with subclass rename `sendEmail`→`doSendEmail` (SendGrid, Ses, SmtpImap). Webhook rows: `ok = status < 400`, `statusHttp` = the status the host returned (Twilio messaging, Twilio voice, WhatsApp, Telegram, SendGrid, SES, SmtpImap hosts). `channel.outbound_call` on Twilio Voice `calls.create`. Twilio Messaging and Telegram `sendMessage` catches are currently silent — they now record `ok=false` (WhatsApp already rethrows).
11. **New `CallMetrics` keys** (jsonb — no migration): `bytesIn?` (storage download), `bytesOut?` (storage upload), `messagesFound?` (`imap.poll`), `canceled?` (TTS barge-in). P1-01 spec + PROPOSAL field list updated.
12. **Factory stamping.** `LlmProviderFactory` stamps `providerId` + `providerApiType` + `providerModel` (`settings.model`) on base instances; ASR/TTS/Storage factories stamp `providerId` + `providerApiType`. `providerType` is a per-base-class constant (`'llm'`/`'asr'`/`'tts'`/`'storage'`); channel rows use `'channel'`.
13. **Template-method renames** (build does not type-check tests and silent method shadowing won't fail `tsc` — verified by grep after each rename): ASR `start/stop/sendAudio`→`do*` (6 files), TTS `start/end/sendText`→`do*` (7 files) + `cancel?()` wrapped when implemented, Storage `upload/download`→`do*` (4 files).
14. **`MockLlmProvider`** (integration harness) is refactored to extend `LlmProviderBase` (it currently implements `ILlmProvider` directly and would bypass all instrumentation); the harness factory override stamps `providerId`/`providerApiType` so mock conversations emit real rows.
15. **IMAP**: `ImapMailboxSession.runPollCycle` body renamed `doRunPollCycle` returning `{ messagesFound, connectError }`; new `lastConnectError` field (the `connectAndOpenInbox` catch currently swallows the error → `null`); new `runPollCycle` wrapper records `imap.poll` per cycle (`ok = !cycleError && !connectError`, `metrics.messagesFound`) + `imap_poll_total{provider_id, ok}`. `messages_found` is **not** a metric label (unbounded) — it lives in `metrics` jsonb only (P1-02 decision preserved).
16. **OAuth**: `processProviderRefresh` wraps the actual `fetchToken` call → one `oauth.refresh` row per real refresh (early-return "not near expiry" = no row) + `oauth_refresh_total{provider_id, ok}`; `fetchToken` attaches `status` to the thrown error so the classifier extracts `statusHttp`.
17. **Central recorder**: new `ProviderCallRecorder` (`@singleton`) is the single "1 call = 1 row + 2 generic metrics" path — `record()` classifies via `classifyThirdPartyError`, writes via `CallLogger`, increments `provider_calls_total{provider_id, provider_type, operation, ok, error_code}` (`error_code='none'` when ok) and observes `provider_call_duration_ms`. Never throws. Non-DI classes (provider bases, channel connections, `ImapMailboxSession`) get it via a cached `getProviderCallRecorder()` accessor; DI classes `@inject` it. Type-specific histograms (`llm_ttft_ms`, `tts_ttfa_ms`, …) are observed by the respective bases.

## Out of scope

- Retries, circuit breakers, failover (Phase 3). Webhook dead-lettering (P4-03). Any change to provider behavior on error (everything still fails exactly as today — we only *record*).
