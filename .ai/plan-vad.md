# Plan: Server-Side Voice Activity Detection (avr-vad)

## Overview
Add server-side VAD using `avr-vad`. In VAD mode, ASR is never tied to client `start/end_user_voice_input` signals. VAD runs continuously on incoming audio and owns the turn lifecycle: `speech_start` event starts the ASR session and generates `inputTurnId` server-side, `end_of_utterance` stops it. After the AI response, reentering `awaiting_user_input` resets VAD ready for next utterance.

Existing `voiceActivityDetection: boolean` in `asrConfig` is a client-side hint — untouched. New `serverVad` object added to `asrConfig` JSONB (no DB migration needed).

---

## Phase 1 — Core VadProcessor Service

**Step 1** — Install `avr-vad` (`npm install avr-vad`)

**Step 2** — Create `src/services/audio/VadProcessor.ts`:
- `VadProcessor extends EventEmitter`; constructor: `(sampleRate: 8000|16000|32000|48000, config: ServerVadConfig)`
- Internal frame buffer + `speaking` state + `silenceDurationMs` accumulator
- `push(chunk)` — accumulate + process complete VAD frames (exact `frameDurationMs * sampleRate * 2` bytes for 16-bit PCM)
- Per-frame logic: voiced → if first voiced frame emit `'speech_start'`, then emit frame via `'data'`; silent when speaking → accumulate; past `silencePaddingMs` and silence > `autoEndSilenceDurationMs` → emit `'end_of_utterance'`
- `reset()` — clear buffer, reset all state; `flush()` — unconditionally emit remaining buffer
- Static `getSampleRateFromFormat(AudioFormat): number | null` — returns null for non-PCM formats

---

## Phase 2 — Configuration Schemas (no DB migration)

**Step 3** — Create `src/http/contracts/vad.ts` with `serverVadConfigSchema.openapi('ServerVadConfig')`:
- `mode: 0–3` (VAD aggressiveness, default 2)
- `frameDurationMs: 10 | 20 | 30` (default 20)
- `silencePaddingMs: 0–1000` (post-roll ms to keep, default 300)
- `autoEndSilenceDurationMs: 100–5000` (silence ms to trigger EOU, default 800)
- Export `ServerVadConfig = z.infer<typeof serverVadConfigSchema>`

**Step 4** — Update `src/db/schema.ts`: add `serverVad?: ServerVadConfig` to `asrConfig` JSONB `.$type<{...}>()`

**Step 5** — Update `src/http/contracts/project.ts`: add `serverVad: serverVadConfigSchema.optional()` to `asrConfigSchema`

**Step 6** — Update `src/http/contracts/projectExchange.ts`: same addition to `asrConfigExchangeV1Schema`

**Step 7** — Update `src/services/ProjectExchangeService.ts`: map `serverVad` alongside `voiceActivityDetection` in both export and import

---

## Phase 3 — ConversationRunner Redesign (always-on, VAD-owned turns)

**Step 8** — Add `private vadProcessor: VadProcessor | null` field and `private get isVadMode()` getter. Add `private forwardToAsr(chunk)` method. Refactor `setupInboundConverter()`'s `'data'` callback to call `forwardToAsr`.

**Step 9** — Add `private setupVadProcessor(asrProvider, conversationId)`, called from `wireUpProviders()` after `setupInboundConverter()`:
- Creates `VadProcessor`
- In VAD mode: **rewires** `inboundConverter`'s `'data'` callback to `vadProcessor.push(chunk)` instead of `forwardToAsr` (VAD intercepts post-conversion PCM audio)
- Wires VAD events: `'speech_start'` → `handleVadSpeechStart()`, `'data'` → `forwardToAsr()`, `'end_of_utterance'` → `handleVadEndOfUtterance()`

**Step 10** — Add `private async handleVadSpeechStart()`:
- Guard: return if status ≠ `'awaiting_user_input'`
- Generate server-side `inputTurnId`; call `asrProvider.start()`; `changeState('receiving_user_voice')`

**Step 11** — Add `private async handleVadEndOfUtterance()`:
- Guard: return if status ≠ `'receiving_user_voice'`
- `vadProcessor.flush()` → `asrProvider.stop()` → `changeState('processing_user_input')`
- Existing `setOnRecognitionStopped` callback drives `processUserInput` onward

**Step 12** — Update `changeState()`: when transitioning to `'awaiting_user_input'` in VAD mode, call `vadProcessor.reset()` (ready for next utterance; ASR is NOT started preemptively — lazy start on `speech_start`)

**Step 13** — Update `receiveUserVoiceData(inputTurnId, voiceData)`:
- In VAD mode: accept in both `'awaiting_user_input'` AND `'receiving_user_voice'` states; ignore client-provided `inputTurnId`; route through converter or directly to `vadProcessor.push()`
- Non-VAD: unchanged

**Step 14** — Update `startUserVoiceInput()`: if VAD mode → return current `inputTurnId` immediately (no-op)

**Step 15** — Update `stopUserVoiceInput()`: if VAD mode → no-op

**Step 16** — Update `destroy()`: `vadProcessor?.reset(); vadProcessor = null`

---

## Phase 4 — WebSocket Contract Update

**Step 17** — Update `src/channels/websocket/contracts/userInput.ts`: change `inputTurnId: z.string()` to `z.string().optional()` in both `sendUserVoiceChunkRequestSchema` and `sendUserVoiceChunkResponseSchema`

**Step 18** — Update `src/channels/handlers/SendUserVoiceChunkHandler.ts`: pass `message.inputTurnId ?? ''` to `receiveUserVoiceData()` (VAD mode ignores it)

---

## Phase 5 — Swagger Registration

**Step 19** — Register in `src/swagger.ts`: `registry.register('ServerVadConfig', serverVadConfigSchema)` before `AsrConfig`

**Step 20** — Make comprehensive documentation on VAD mode for the clients.
---

## Verification
1. `npm run build`
2. Non-VAD mode: existing `start_user_voice_input → send_chunks → end_user_voice_input` flow unchanged
3. VAD mode: client sends continuous `send_user_voice_chunk` (no start/end) → speech detected → turn created → EOU fires → AI responds → cycle repeats
4. Audio arriving in `awaiting_user_input` state (VAD mode) is accepted without errors
5. Client `start/end_user_voice_input` in VAD mode returns success (graceful no-op)

---

## Decisions
- ASR started lazily per-utterance (on `speech_start`), not eagerly — avoids holding provider connections during silence
- `inputTurnId` in `send_user_voice_chunk` made optional (backward-compatible)
- Barge-in explicitly out of scope
- `voiceActivityDetection: boolean` remains untouched (client-side hint)
- No DB migration needed