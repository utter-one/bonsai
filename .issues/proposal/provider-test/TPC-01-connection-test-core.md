---
title: "TPC-01 — Connection tester core: per-type strategies over the production code path"
severity: proposal
status: open
created: 2026-08-24
updated: 2026-08-24
assignee: ""
tags: [providers, spec, connection-test, phase-1]
---

# TPC-01 — Connection tester core

- **Depends on:** (none — builds on the shipped P1-03 call-log wrappers and P1-05b provider bases)
- **Blocks:** TPC-02, TPC-03, TPC-04, TPC-05
- **Estimate:** 2–3 dev-days

## Objective

A `ProviderConnectionTester` service that runs a minimal, side-effect-free
connection test for a **saved or draft** provider of type
`llm | asr | tts | storage`, driving the provider's **own production
lifecycle methods** (same protocol as the main functionality), and returning
a uniform structured result.

## Scope

### New files

- `src/services/providers/connectionTest/ProviderConnectionTester.ts`
- `src/services/providers/connectionTest/types.ts` (`ConnectionTestInput`, `ConnectionTestResult`, `TestPhase`)
- `src/services/providers/connectionTest/strategies/{llm,asr,tts,storage}.ts`
- `src/services/providers/connectionTest/index.ts` (strategy registry)
- `src/services/providers/connectionTest/silence.ts` (ASR silence-buffer helper)

### Modified files

- `src/services/providers/llm/LlmProviderFactory.ts` (+ asr/tts/storage factories):
  expose a `createForTest(provider, settings)` seam (or reuse
  `createProviderForEnumeration` where it already fits) — fresh instance,
  secrets resolved, **no** call to production call sites.
- `src/services/monitoring/CallLogger.ts`: one guard — `record()` still
  buffers test rows (they are ordinary `ProviderCallEntry` rows with
  `operation: '<type>.test'`) but **skips the breaker feed** for them
  (`operation.endsWith('.test')` → no `recordFailure`/`recordSuccess`), so
  manual testing can never open a breaker for real users.

## Implementation requirements

1. **Result type** (exact fields, all required unless noted):
   `ok: boolean; providerType; apiType; protocol: 'http'|'websocket'|'sdk'|'local-fs'; phase: 'auth'|'session'|'first-data'|'write'; latencyMs: number; errorCode: ThirdPartyErrorCode | null; errorText?: string; detail?: Record<string, unknown>`.
   Error codes come from `classifyThirdPartyError()` (reuse, do not fork).
2. **Strategies** — one per providerType, registered in the index:
   - **llm:** `generate([{role:'user',content:'ping'}], {maxTokens:1, temperature:0})`
     through the production template wrapper. Saved: `model` param, default
     first model from `enumerateModels()`. Draft: `model` required
     (throw `ValidationError` → 400 at the API layer).
   - **asr:** `init() → start() → sendAudio(silence) → await
     onRecognitionStarted (or first inbound message, whichever is earlier) →
     stop() → cleanup()` (cleanup in `finally`). Silence = ~500 ms in the
     provider's first `getSupportedInputFormats()` format (helper builds the
     byte buffer from `AudioFormat` sample-rate/bit-width metadata).
     `phase` progression: `auth` (WS/session established) → `first-data`
     (audio accepted / first message). `ok` = session started within timeout.
     A transcript partial, if any, is reported in `detail.transcript` (never
     required).
   - **tts:** production streaming lifecycle `init() → start() →
     sendText('Test connection.') → end() → cleanup()` (default voice from
     config, or `voice` param), `setOnSpeechGenerating` chunks dropped into
     a byte counter. `ok` = ≥1 audio chunk received.
     `detail: { voice, bytes }`.
   - **storage:** `list('', 1)` → `ok`, `phase 'first-data'`; with
     `write: true`: `upload('bonsai-connection-test/<uuid>')` →
     `download` (byte-compare) → `delete` in `finally` → `phase 'write'`.
     `local`: directory existence/writability check, `detail.path`.
3. **Guards (tester-owned):**
   - cooldown 5 s per saved `providerId` / per draft key
     (`draft:<apiType>:<sha256(stableStringify(config))[:12]>`) →
     `TooManyRequestsError` (carries `Retry-After`);
   - hard timeouts: llm 30 s, asr 20 s, tts 30 s, storage 15 s — wrap the
     whole strategy body; a timeout is `ok:false, errorCode:'timeout'`,
     with the provider instance's `cleanup()` still awaited (bounded);
   - fresh instance per test (never a pooled/pre-warmed provider);
   - **test outcomes never trip the circuit breaker** — the tester records
     via `CallLogger` but the breaker-feeding path must exclude
     `operation.endsWith('.test')` (assert in unit test);
   - error-text sanitization: truncate to 500 chars; redact `Bearer <…>`,
     JWT-shaped tokens, and `key/token/secret`-pattern values before
     response or log.
4. **Draft mode:** config validated by the same per-apiType Zod schema the
   create endpoint uses; instance built from a synthetic in-memory Provider
   (`id: 'draft'`, `providerType`, `apiType`, `config`); secrets resolved
   via `secretRefUtils.resolveObject` (plaintext secrets used for the test
   only, never persisted); **no** call-log row, **no** audit row.
5. **Saved mode:** provider row loaded (404 if missing), secrets resolved,
   call-log row recorded exactly once per test (ok or failure), `operation`
   = `<providerType>.test`, `model`/`statusHttp`/`errorText` filled as in
   production calls.

## Acceptance criteria

- Each of the four strategies drives the provider's existing public methods
  (no new protocol code; reviewable diff of strategies = method calls only).
- Every vendor outcome (auth error, rate limit, timeout, network, 5xx,
  mid-stream close) returns `ok:false` with the correct `errorCode` —
  never a thrown exception out of the tester (except guard errors:
  400/404/429).
- Unit tests (below) all pass; breaker-exclusion asserted.

## Tests

**Unit** (`tests/unit/providers/connection-test-*.test.ts`, no network):

- llm: local fake OpenAI-compatible HTTP server — 200 stream → ok; 401 →
  `auth`; 429 → `rate_limited`; 500 → `server_error`; hang → `timeout`.
- asr: local `ws` server — handshake + one inbound message → ok
  (`phase 'first-data'`); close-with-401-payload → `auth`; no response →
  `timeout`; mid-stream close after start → still ok (session established).
- tts: fake WS/HTTP chunk server — ≥1 chunk → ok with `detail.bytes`; 401 →
  `auth`; zero chunks after stream end → `ok:false, errorCode 'server_error'`.
- storage: `local` against a temp dir — list ok; write round trip ok + key
  cleaned up (assert directory empty afterwards); missing dir →
  `ok:false, client_error`.
- tester: cooldown → `TooManyRequestsError` with correct keying;
  sanitization vectors (Bearer token, JWT, `api_key=…`); draft vs saved
  attribution (draft → zero call-log rows); breaker exclusion (5 failed
  `*.test` rows do NOT open the breaker; 5 failed production rows do).

## Out of scope

- HTTP endpoint (TPC-02), alert-engine interplay tests (TPC-03),
  channel providers (TPC-04), periodic probing (TPC-05).
