# Proposal — Provider Connection Testing (data-plane "test connection")

- **Status:** proposed
- **Branch:** `provider-test-connection`
- **Date:** 2026-08-24
- **Issue specs:** `specs/provider-test/` (TPC-01 … TPC-09)
- **Prerequisite line:** `advanced-monitoring` (P1-03 call logs, P1-05b probes, P2-01 alert engine incl. the 2026-08-24 last-signal branch)

## 1. Problem

Bonsai has **periodic, control-plane** provider probes (P1-05 / P1-05b): free
`GET` listings for LLM (`enumerateModels()` / 1-token `generate()`), storage
(`list`), TTS (vendor model listings) and — deliberately (Option A,
`docs/guide/monitoring.md`) — **REST control-plane** listings for streaming ASR
(jobs/models/projects), which are *not* the WebSocket data plane conversations
use.

The documented consequence stands: for streaming ASR, a probe `ok` proves the
API key works and the control plane is reachable, **not** that the streaming
endpoint will accept a session. There is no way for an operator to answer the
question *"will this provider actually work right now, over the protocol the
product uses?"* — for **any** provider type:

| Type | What exists today | Gap |
|---|---|---|
| LLM | `GET /api/providers/:id/models` → `enumerateModels()` (real API call, but a *different* endpoint than inference; LLM-only; unstructured: throws → 500/502) | No inference-path test; no structured result; no TTS/ASR/storage counterpart |
| ASR | `ping()` = REST listing (control plane) | Never touches the WebSocket session path |
| TTS | `ping()` = REST listing | Never touches the synthesis path (WS for ElevenLabs/Deepgram/Cartesia) |
| Storage | `list('', 1)` probe | Read-scope only; no write check |
| Channel | nothing | No test at all (token valid? SMTP/IMAP creds work?) |

Operators currently discover broken credentials / unreachable endpoints only
through failed conversations — after users are affected.

## 2. Goal

An on-demand **test connection** mechanism for **each provider type** that
verifies **authentication and availability** using **the same communication
protocol as the provider's main functionality** — i.e. the test goes through
the provider's *own production code path* (same host, same transport, same
auth, same SDK), not a surrogate endpoint.

Design principle (this is what makes the requirement hold *structurally*):

> **The test reuses the provider's existing session/call lifecycle methods** —
> `init() → start() → sendAudio() → stop() → cleanup()` for ASR,
> `start() → sendText() → end()` for TTS, `generate({ maxTokens: 64 })` for LLM
> `list() / upload() / download() / delete()` for storage — never a
> re-implementation of the protocol. Whatever a conversation does, the test
> does, at minimum size.

Non-goals (v1):

- No periodic data-plane probing (that is the explicit Option A decision for
  the 60 s probe cadence; see TPC-09 for the opt-in follow-up).
- No multi-region / multi-model matrix tests (one minimal call per test).
- No channel *send* tests (no test messages to real numbers/chatbots —
  side-effect-free auth/availability checks only).

## 3. API design

```
POST /api/providers/test-connection
```

One endpoint, discriminated-union body (Zod, same as the Tool API pattern):

```ts
// Mode A — saved provider (id XOR the draft fields below)
{ providerId: string, model?: string, voice?: string, write?: boolean }

// Mode B — draft (unsaved) config — what the Console "Test" button on the
// provider form needs before the provider row exists
{ providerType: 'llm'|'asr'|'tts'|'storage'|'channel',
  apiType: string,
  config: ProviderConfig,          // validated by the same per-apiType Zod schema used on create
  model?: string, voice?: string, language?: string,
  write?: boolean }
```

Response — **always 200 with a structured result** when the test itself ran
(vendor failures are data, not HTTP errors):

```ts
{
  ok: boolean,
  providerType: string, apiType: string,
  protocol: 'http' | 'websocket' | 'sdk' | 'smtp' | 'imap' | 'local-fs',
  phase: 'auth' | 'session' | 'first-data' | 'write',   // how far the test got
  latencyMs: number,
  errorCode: null | 'auth' | 'client_error' | 'rate_limited' | 'timeout' | 'network' | 'server_error' | 'unknown',  // THIRD_PARTY_ERROR_CODES
  errorText?: string,   // sanitized: truncated, token/key patterns stripped
  detail?: Record<string, unknown>,  // e.g. { models: 12 } | { voice: 'alloy', bytes: 31852 } | { bucket: 'x' }
}
```

HTTP status: `400` invalid draft config (Zod) · `401/403/404` standard ·
`429` per-provider cooldown (with `Retry-After`) · `500` only for internal
errors. *Decision:* vendor-side failures return `200 + ok:false` (the test ran
and reported), unlike `GET /models` which throws — the Console renders the
result, and `errorCode` drives the icon/message.

Guards (all in the tester service, TPC-01):

- **Cooldown:** 5 s per saved provider id / per draft key (in-memory map);
  `TooManyRequestsError` → 429 + `Retry-After`.
- **Timeouts (hard):** LLM 30 s · ASR 20 s · TTS 30 s · storage 15 s · channel 20 s.
- **Fresh instance per test:** the factory builds a *new* provider instance
  from the (resolved) config — never a pooled/pre-warmed live session, so a
  test can't disturb in-flight conversations. Precedent: `createProviderForEnumeration()`
  already builds instances from a DB row without `LlmSettings`; the draft path
  does the same from a synthetic in-memory `Provider` (`id: 'draft'`).
- **Secrets:** `secretRefUtils.resolveObject()` exactly as on create; plaintext
  secrets in a draft config are used for the test only, never persisted.
  Error text is sanitized (truncated to 500 chars; `Bearer …`, `api[_-]?key`,
  JWT-shaped tokens redacted) before it is returned or logged.

RBAC (defense in depth, house rule): controller `checkPermissions(req, [PROVIDER_READ])`
+ service `requirePermission(context, PROVIDER_READ)` on both modes. Testing is
read-scoped (no mutation); a dedicated `providers:test` permission is a
candidate for the RBAC follow-up, not v1.

## 4. Per-type test semantics (same protocol as the main functionality)

### 4.1 LLM — 1-token real inference (all 16 apiTypes)

`generate([system, { role: 'user', content: 'ping' }], { maxTokens: 64 })`
through the production template wrapper (same HTTP path, headers, streaming
SSE where the provider uses it, and the same call-log recording).

`maxTokens` is a **ceiling**, not a target — the "ping → single word" prompt
elicits ~1 token, but the ceiling must clear each vendor's hard floor (OpenAI
rejects `max_output_tokens` < 16 with a 400; 64 clears it and the 50+ non-
production recommendation). See TPC-02.

| apiType | transport | note |
|---|---|---|
| openai, openai-legacy, groq, mistral, deepseek, openrouter, together-ai, fireworks-ai, perplexity, xai, ovh, scaleway, cohere | HTTP POST chat/completions (SSE where applicable) | OpenAI-compatible `chat.completions` or vendor REST |
| anthropic | HTTP POST `/v1/messages` (SSE) | |
| gemini | HTTP POST `:streamGenerateContent` | |
| ollama | HTTP localhost | works against a local Ollama out of the box |

Model selection: draft mode **requires** `model`; saved mode takes an optional
`model`, defaulting to the first model returned by `enumerateModels()` (the
existing free call — reused, not duplicated).

Why not `enumerateModels()` as the test: it is a *different endpoint* than
inference (some vendors meter/limit it separately, and a models endpoint can
work while the inference quota is exhausted). A small `maxTokens` ceiling is
what conversations actually do; `HealthCheckService` already offers it as
`llmProbe: 'one_token'` for exactly this reason. Cost: one output token (the
ceiling is 64 to clear vendor floors — see above).

### 4.2 ASR — real WebSocket session + silence (all 6 apiTypes)

Full production session lifecycle at minimum size — the **same code a
conversation turn runs**:

```
init() → start()                      # WS connect + session config (auth accepted here)
       → sendAudio(<~500 ms silence>) # in the provider's first supported input format
       → await onRecognitionStarted (or first inbound message)  # session alive + accepting audio
       → stop() → cleanup()           # always, in finally
```

`ok` = the session started (or accepted the audio frame) within 20 s.
Receiving a *transcript* is not required (silence yields no text); a partial
result is reported in `detail` as a bonus signal.

| apiType | data plane the test exercises |
|---|---|
| deepgram | `wss://api.deepgram.com/v1/listen` (raw WS, JSON commands) |
| elevenlabs | `wss://api.elevenlabs.io/v1/speech-to-text/realtime` (raw WS) |
| speechmatics | `wss://eu|us|global.rt.speechmatics.com/v2` (raw WS, v2 config messages) |
| assemblyai | `wss://streaming.assemblyai.com` / `streaming.eu.assemblyai.com` (SDK streaming transcriber) |
| soniox | `@soniox/node` realtime STT (SDK WS) |
| azure | `microsoft-cognitiveservices-speech-sdk` (SDK WSS) |

This is precisely what Option A **refused for the 60 s periodic probe** (session-creation
rate limits, false downs) — and exactly right for an on-demand, user-initiated
test with a 5 s cooldown. The Option A doc is updated to point here
(TPC-07, `docs/guide/monitoring.md`).

### 4.3 TTS — real minimal synthesis, audio discarded (all 7 apiTypes)

Each provider runs its **production streaming lifecycle** at minimum size —
`init() → start() → sendText('Test connection.') → end() → cleanup()` — with
`setOnSpeechGenerating` chunks dropped into a byte counter (no audio
persisted, returned, or played). `ok` = **at least one audio chunk received**
(proves the full round trip: auth, voice/model validity, streaming delivery).

> **ElevenLabs requires a `voice`** — it is the only TTS provider with no
> safe default (voices are account-specific; its legacy Default voices expire
> 2026-12-31). A missing voice for it is a `400` guard error, not a vendor
> failure. The other six providers fall back to a stable default (alloy /
> Joanna / thalia-en / Adrian / en-US-AriaNeural / a fixed Cartesia voice).
> See TPC-04.

| apiType | transport the test exercises |
|---|---|
| elevenlabs | `wss://api.elevenlabs.io` (WS streaming synthesis) |
| deepgram | `wss://api.deepgram.com/v1/speak` (WS) |
| cartesia | `wss://api.cartesia.ai/tts/websocket` (WS) |
| openai | HTTP POST `https://api.openai.com/v1/audio/speech` |
| soniox | `@soniox/node` SDK (HTTP) |
| amazon-polly | `@aws-sdk/client-polly` `SynthesizeSpeechCommand` (HTTP) |
| azure | `microsoft-cognitiveservices-speech-sdk` synthesizer (SDK SSE/WSS) |

### 4.4 Storage — real object-store calls (all 4 apiTypes)

Default: `list(prefix='', maxItems=1)` (read scope — availability + read auth).
With `write: true`: full round trip on a throwaway key
`bonsai-connection-test/<uuid>` → `upload` → `download` (byte-compare) →
`delete` (in `finally`, so a failed test still cleans up). `phase` reports
`first-data` (list ok) or `write` (round trip ok).

| apiType | transport |
|---|---|
| s3 | AWS SDK (`ListObjectsV2`, `PutObject`/`GetObject`/`DeleteObject`) |
| gcs | `@google-cloud/storage` |
| azure-blob | `@azure/storage-blob` |
| local | local filesystem — `detail.path` reported; always `ok` unless the directory is missing/unwritable (then `ok:false`, `errorCode: 'client_error'`) |

### 4.5 Channel providers — same-protocol auth check, zero side effects (TPC-08, phase 3)

| apiType | test call (same API the channel uses) |
|---|---|
| telegram | Bot API `GET getMe` |
| twilio-messaging | Twilio REST `GET /Messages.json?PageSize=1` (Basic auth) |
| twilio-voice | Twilio REST `GET /PhoneNumbers.json?PageSize=1` (same account creds) |
| whatsapp | Meta Cloud API `GET /{version}/{phone-number-id}` |
| sendgrid | `GET /user/account` |
| ses | AWS SDK `ListIdentitiesCommand` (free) |
| smtp-imap | SMTP: connect + `EHLO`/`STARTTLS` + `AUTH` with stored creds; IMAP: connect + `LOGIN`. **No message is sent.** |

### 4.6 Embeddings

`providerType: 'embeddings'` is declared in the schema but **no embedding
provider is implemented yet** — out of scope; the provider-base seam (a
`testConnection()` method on the base, dispatched by the tester via that
type's factory) means the first embedding provider adds a minimal
`embed(['ping'])` test for free.

## 5. Monitoring integration (the payoff)

**Saved-provider tests are recorded in `provider_call_logs`** (one row per
test, `operation: '<type>.test'` — e.g. `llm.test`, `asr.test`, `tts.test`,
`storage.test`, `channel.test`) through the provider bases' existing
recording wrappers (same as `asr.ping`). Draft tests are **not** recorded
(transient, no provider row to attribute to; the response is the deliverable).

This closes the loop with the alert engine's **last-signal branch**
(added 2026-08-24, P2-01 note 20):

- a **successful** test flips the provider's last observed signal to `ok`
  → a firing `provider-auth-failed` resolves (its documented resolution
  condition is "a call or probe from the provider succeeds" — a test now
  counts, which is exactly the operator workflow: fix creds → click Test →
  alert clears);
- a **failed** test with `errorCode: 'auth'` keeps `provider-auth-failed`
  firing even when the window is quiet;
- `provider-down`'s call-log and breaker branches are unaffected (tests are
  sparse; they don't feed the 100%-failure window meaningfully, and the
  breaker only counts production calls — **decision:** test outcomes do
  *not* trip the circuit breaker, so a flaky vendor during manual testing
  cannot open the breaker and trigger failover for real users).

Periodic probes stay control-plane (Option A, unchanged). The
`docs/guide/monitoring.md` "What the provider probes actually measure"
section gains one line: data-plane validation is available on demand via
`POST /api/providers/test-connection`.

## 6. Cost & quota analysis (why on-demand, minimal-size)

| Type | What one test consumes | Approx. cost |
|---|---|---|
| LLM | 1 output token (+1 prompt token) | ≤ ~$0.001 |
| ASR | ~0.5 s of silence on one WS session | ~$0 (free tiers); one session-creation slot |
| TTS | ~2–3 words synthesized, discarded | ~$0.0001–0.01 |
| Storage | 1 list (+ 3 tiny object ops with `write`) | ~$0 |
| Channel | 1 auth/list call; SMTP/IMAP handshake | $0, no messages sent |

The 5 s per-provider cooldown + the global API rate limiter make abuse
cost-bounded; a Console hint ("testing consumes a negligible amount of your
provider quota") is a frontend concern.

## 7. Architecture (new/changed files)

**New:**

- `src/services/providers/connectionTest/ProviderConnectionTester.ts` —
  `@singleton`; owns cooldown map, timeouts (a per-`providerType` timeout
  table), fresh-instance construction (saved: DB row +
  `secretRefUtils.resolveObject`; draft: synthetic Provider from validated
  config), **provider-base dispatch** (by `providerType` → that type's
  factory → `createForTest()` → the instance's own `testConnection()`), a
  per-`providerType` protocol table, result normalization (the public
  `providerType`/`apiType`/`protocol`/`latencyMs` are added to the
  provider-produced `ConnectionTestOutcome`), error-code mapping
  (`classifyThirdPartyError`), error-text sanitization, call-log attribution
  for saved tests.
- `src/services/providers/connectionTest/silence.ts` — shared ASR silence
  helper (format → byte buffer, reuses `AudioFormat` metadata); imported by
  `AsrProviderBase.testConnection()`.
- `src/http/contracts/providerConnectionTest.ts` — request union +
  `ConnectionTestResult` Zod schemas (`.describe()` on every field,
  `.openapi()` on reusable subschemas) → OpenAPI.
- **Provider bases gain a `testConnection()` method** (TPC-02–05):
  `LlmProviderBase`, `AsrProviderBase`, `TtsProviderBase`,
  `StorageProviderBase` each drive the production lifecycle described in §4
  and return the provider-produced `ConnectionTestOutcome`. Channels (TPC-08)
  follow the same per-base pattern; TPC-09 and future embedding providers
  plug in without touching the tester.

**Changed:**

- `src/http/controllers/ProviderController.ts` — `POST /api/providers/test-connection`
  (route + `getOpenAPIPaths` entry); `ProviderService` gains
  `testConnection(input, context)` (permission check + delegation).
- `src/services/AuditService.ts` — public `logEvent(entityType, entityId, action, details, userId)`
  (wraps the existing `logChange`); used with `action: 'TEST_CONNECTION'`
  (saved mode only; `newEntity` carries the result summary, never secrets).
- Provider bases: **gain a `testConnection()` method** (above); they keep
  using the existing public lifecycle methods (`getSupportedInputFormats()`
  / `getSupportedFormats()` are already public).
- `docs/guide/monitoring.md` (Option A cross-ref), `docs/frontend-monitoring-api.md`
  (endpoint reference for the Console), specs in `specs/provider-test/`.

## 8. Phases & specs

| ID | Spec | Contents | Est. |
|---|---|---|---|
| TPC-01 | tester-core | Tester skeleton: result type, provider-base dispatch + protocol table, guards (cooldown/timeout/sanitize), draft/saved instance construction, CallLogger breaker-exclusion | 1 dev-day |
| TPC-02 | llm-strategy | LLM test (`LlmProviderBase.testConnection`): 1-token real inference, model defaulting, fake-HTTP unit tests | 0.5 dev-day |
| TPC-03 | asr-strategy | ASR test (`AsrProviderBase.testConnection`): real WS session + silence helper, phase progression, fake-WS unit tests | 1 dev-day |
| TPC-04 | tts-strategy | TTS test (`TtsProviderBase.testConnection`): production synthesis lifecycle, chunk counting, fake-server unit tests | 0.5 dev-day |
| TPC-05 | storage-strategy | Storage test (`StorageProviderBase.testConnection`): `list` + optional write round trip, `local` variant, temp-dir unit tests | 0.5 dev-day |
| TPC-06 | http-endpoint-rbac | Endpoint + contracts + OpenAPI + RBAC + audit `logEvent` + e2e | 1 dev-day |
| TPC-07 | call-log-integration | `*.test` call-log rows, alert-engine interplay tests (last-signal), docs updates | 0.5–1 dev-day |
| TPC-08 | channel-providers | Channel tests (per-base `testConnection`, 7 apiTypes), zero side effects | 1 dev-day |
| TPC-09 | periodic-data-plane-probes (optional) | ~~`probeSettings`: `asrProbe`/`ttsProbe: 'data_plane'` opt-ins~~ — **closed (2026-08-27), won't do**: superseded by the monitoring module's `HealthCheckService`, which already probes every provider type on its 60 s cycle (LLM `models`/`one_token`, ASR/TTS zero-cost `ping()`, storage `list`, call-log inference fallback) | n/a |

Dependencies (direct only; `Blocks` in specs is the exact inverse):

```
TPC-01  (no new deps — builds on P1-03/P1-05b line)
TPC-02  ◄── TPC-01
TPC-03  ◄── TPC-01
TPC-04  ◄── TPC-01
TPC-05  ◄── TPC-01
TPC-06  ◄── TPC-01, TPC-02, TPC-05   (e2e exercises llm + storage; tts/asr as they land)
TPC-07  ◄── TPC-01          (alert interplay needs TPC-01 recording; rule side already shipped)
TPC-08  ◄── TPC-01, TPC-06
TPC-09  ◄── TPC-03, TPC-04, TPC-07   (optional)
```

Definition of done (every spec): `npm run build` green, `npm run test:unit`
green, `npm run test:e2e` green, unit + e2e tests per the spec, no regressions.

## 9. Testing strategy

Unit (no network, no vendor creds):

- **ASR/TTS WS tests:** in-test `ws` server standing in for the vendor —
  accept the handshake, assert the session-config message, echo one message
  / one audio chunk; negative cases: close-with-auth-error frame → `errorCode 'auth'`,
  no response → `timeout`, mid-stream close → structured result.
- **LLM test:** fake HTTP (OpenAI-compatible) via a local server — 200
  stream, 401, 429, 500, hang → `timeout`.
- **Storage test:** `local` against a temp dir (real); s3/gcs/azure-blob
  via injected fake SDK clients (constructor injection already exists in the
  provider classes for DI).
- **Tester:** cooldown 429, fresh-instance guarantee (no shared state with a
  live instance), error-text sanitization, draft-vs-saved attribution.

E2e (real app, no vendor creds):

- draft with invalid config → 400 (Zod); unknown `apiType` → 400
- saved `storage/local` provider → 200 `ok:true` (fully real path)
- saved `llm/ollama` pointing at a dead port → 200 `ok:false`,
  `errorCode 'network'` (structured failure contract)
- RBAC: viewer → 403; unauthed → 401; audit row written; call-log row for
  saved test; cooldown → 429 with `Retry-After`
- TPC-07: a failed auth test keeps `provider-auth-failed` firing; a successful
  test resolves it (extends the existing alert-rule-engine e2e pattern).

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Vendor session-quota abuse via the endpoint | 5 s per-provider cooldown + global rate limit + operator RBAC; TPC-09 keeps periodic data-plane probing **off by default** |
| Test disturbs live sessions | fresh instance per test (never pooled/pre-warmed); ASR test opens its own session |
| Secrets leak via `errorText` | sanitizer (truncate + pattern redact) before response/log; audit `details` carry the result summary only |
| WS tests flaky in CI | all vendor-protocol tests are unit-level against local fake WS/HTTP servers; e2e only uses `local` storage + unreachable-ollama (deterministic) |
| Draft mode bypasses validation | draft config validated by the **same** per-apiType Zod schema as `POST /api/providers` (single source of truth) |
| Breaker tripped by manual tests | explicit decision: test outcomes excluded from breaker counting (TPC-01) |

## 11. Out of scope (explicit)

- Console UI (frontend repo; the API + `docs/frontend-monitoring-api.md`
  section are the contract it builds on)
- Periodic data-plane probes **by default** (Option A stands; TPC-09 is opt-in)
- Webhook/channel *outbound* delivery tests (send a real message)
- Benchmark-style multi-model / multi-voice sweeps (existing benchmark suite
  covers quality, not connectivity)
- Embedding providers (none implemented yet)
