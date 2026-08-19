---
title: "P1-05b — ASR/TTS provider liveness probes (closing the provider-monitoring hole)"
severity: proposal
status: open
created: 2026-08-19
updated: 2026-08-19
assignee: ""
tags: [monitoring, spec, phase-1]
---

# P1-05b — ASR/TTS provider liveness probes

- **Phase:** 1.5 — gap remediation (addendum to P1-05 probe coverage)
- **Depends on:** P1-03 (call-log wrappers), P1-05 (probe plumbing: gating, timeouts, `probeFailures`), P1-06 (`probeSettings` config)
- **Blocks:** P3-01 (circuit breaker — idle-provider semantics), P3-02 (fallback resolver — provider health input)
- **Estimate:** 1–1.5 dev-days

## Problem

Provider liveness is a hole for two of the five implemented provider types. Today, per provider type:

| Type | Active probe | Idle + expired/revoked credentials surface as |
|---|---|---|
| LLM | `enumerateModels()` (free) or 1-token `generate()` (opt-in) | `degraded` after 3 consecutive probe failures → `provider-down` |
| Storage | `list('', 1)` (free) | same |
| **ASR (6 providers)** | **none** | **`unknown` — forever, until a real call fails** |
| **TTS (7 providers)** | **none** | **`unknown` — forever, until a real call fails** |

Consequences (all verified in code, 2026-08-19):

1. **`inferProviderStatus` cannot distinguish "dead" from "quiet".** No success in the last 30 min → `unknown` (detail: "no calls in the last 30 min" / "no calls in the last 24 h"). An ASR/TTS provider with a revoked API key that sees no traffic is indistinguishable from one that simply hasn't been used.
2. **`provider-down`'s probe branch never sees ASR/TTS.** The branch consumes `HealthCheckService.probeFailures` (≥ `threshold` consecutive probe failures), and probes only run for `llm`/`storage`. The 100%-error call-log branch requires traffic (`minSamples: 5`).
3. **The user's first dead turn is the first signal.** No `provider-auth-failed` alert can fire without a call log row; no breaker (P3-01) can open without observed failures. The failover story of Phase 3 inherits this blind spot unless it is closed here.
4. **Channel providers are not affected** — they have a genuinely idle signal already (`oauth_refresh_total{ok=false}` → `oauth-refresh-failing`), and embeddings has **no implementation at all** (no `src/services/providers/embeddings/` — the type is phantom; out of scope).

## Research — free liveness endpoint per provider (2026-08-19, verified against vendor docs)

All 13 ASR/TTS provider implementations are session/synthesis clients (WebSocket or SDK); none calls a list/info endpoint today. Vendor docs were checked for a **zero-cost, side-effect-free, auth-verifying** endpoint reachable with the *same key the provider already stores*:

### ASR (6)

| `apiType` | Free probe | Endpoint | Auth (reuses stored config) | Notes |
|---|---|---|---|---|
| `assemblyai` | ✅ | `GET https://api.assemblyai.com/v2/transcripts?page_size=1` (EU: `api.eu.assemblyai.com`) | `Authorization: <apiKey>` (no Bearer prefix) | REST base differs from the streaming base the session client uses (`streaming.assemblyai.com`) — ping uses raw `fetch`, not the session SDK instance |
| `azure` | ❌ | — | — | `microsoft-cognitiveservices-speech-sdk`; subscription key only validates when a recognition session runs (cost/quota). **Inference-only** |
| `deepgram` | ✅ | `GET https://api.deepgram.com/v1/projects?limit=1` | `Authorization: Token <apiKey>` | Key-management endpoint, free, no side effects |
| `elevenlabs` | ✅ | `GET https://api.elevenlabs.io/v1/models` | `xi-api-key: <apiKey>` | Free; same key as the ElevenLabs TTS provider |
| `soniox` | ✅ | `GET https://api.soniox.com/v1/models` | `Authorization: Bearer <apiKey>` | Free; same key as the Soniox TTS provider |
| `speechmatics` | ✅ | `GET https://usa.asr.api.speechmatics.com/v2/jobs` (region-mapped: `asr.api…` EU / `eu1.asr.api…` EU1 / `usa.asr.api…` USA) | `Authorization: Bearer <JWT>` — reuse existing `createSpeechmaticsJWT` (region + ttl already parameterized) | List-jobs endpoint, free |

### TTS (7)

| `apiType` | Free probe | Endpoint | Auth (reuses stored config) | Notes |
|---|---|---|---|---|
| `amazon_polly` | ✅ | `DescribeVoicesCommand` (`@aws-sdk/client-polly` — in installed SDK) | AWS credentials from config | Free listing call; verifies credentials + network; client already built in `init()` |
| `azure` | ❌ | — | — | Same SDK situation as ASR. **Inference-only** |
| `cartesia` | ❌ (with the standard key) | `GET https://api.cartesia.ai/api-keys` requires an **admin** key (`sk_car_admin_…`) — a different credential than the standard TTS key | — | No free ping reachable with the stored key. **Inference-only** in v1 (paid minimal probe — decision 2 below — deferred) |
| `deepgram` | ✅ | `GET https://api.deepgram.com/v1/projects?limit=1` | `Authorization: Token <apiKey>` | Same key as Deepgram ASR |
| `elevenlabs` | ✅ | `GET https://api.elevenlabs.io/v1/models` | `xi-api-key: <apiKey>` | Same key as ElevenLabs ASR |
| `openai` | ✅ | `GET https://api.openai.com/v1/models` | `Bearer <apiKey>` | Free, standard |
| `soniox` | ✅ | `GET https://api.soniox.com/v1/models` | `Authorization: Bearer <apiKey>` | Same key as Soniox ASR |

**Verdict: 10 of 13 probeable for free.** Azure ASR, Azure TTS, and Cartesia TTS stay inference-only in v1 (their status display is unchanged; call-based alerting/breaker still fully covers them when traffic exists).

## Design

1. **`ping?(): Promise<void>` — optional interface method** on `IAsrProvider` and `ITtsProvider`. Precedent for optional interface members: `cancel?()` on `ITtsProvider`. Providers without a free endpoint simply don't implement it; the probe path falls through to inference. No base-class default implementation (an "unsupported" throw would need special-casing at the call site anyway).
2. **Base-class call-log helper.** `AsrProviderBase`/`TtsProviderBase` each gain a small `protected recordPingCall(operation: 'asr.ping' | 'tts.ping', startedAt: number, error?: Error)` wrapping `resolveCallRecorder()` — the exact pattern `LlmProviderBase.enumerateModels()` already uses via `recordPlainCall('llm.models', …)`. Probe rows land in `provider_call_logs` and feed the same window stats/alerting as real traffic (volume bounded by the existing 10-min cooldown + recent-success skip).
3. **Factory probe constructors.** `AsrProviderFactory`/`TtsProviderFactory` gain `createProviderForProbing(provider: Provider): Promise<IAsrProvider|ITtsProvider>` mirroring `LlmProviderFactory.createProviderForEnumeration`: resolve secrets via `secretRefUtils.resolveObject`, construct the instance with **empty settings** (constructors only store settings and build clients — verified for AssemblyAI/ElevenLabs/Polly; settings are consumed by session methods, not construction), no conversation context.
4. **`HealthCheckService.maybeProbe` gains two branches.** Condition becomes `storage || (llm && llmProbe!=='off') || (asr && asrProbe!=='off') || (tts && ttsProbe!=='off')`. ASR/TTS branch: `createProviderForProbing` → `init()` → `instance.ping ? await this.withTimeout(instance.ping(), CHECK_TIMEOUT_MS) : null`. All existing gating is shared unchanged: recent-success skip (`RECENT_SUCCESS_SKIP_MS`), per-provider cooldown (`probeSettings.cooldownMinutes`), `lastProbeAt`, success → `ok {probed:true}` + `probeFailures.delete`, failure → `degraded {probed:true, probeError, consecutiveProbeFailures}` + counter increment. **Instance without `ping` → return `null` → caller falls back to inference** (this is what makes the default safe for Azure/Cartesia).
5. **Config: two additive `probeSettings` fields.** `asrProbe: z.enum(['free','off']).default('free')`, `ttsProbe: z.enum(['free','off']).default('free')` — mirrors `llmProbe`'s style and naming. `'free'` = probe via zero-cost endpoints only. Existing `monitoring_config` rows are untouched (Zod defaults fill the new fields on load). `MONITORING_HEALTH_PROBES=off` remains the hard kill switch covering all probe types (test env stays at `off` — zero external traffic in CI).
6. **Failure semantics: any non-2xx (or SDK/network error/timeout) = probe failure.** A 401 (bad credentials) and a 404 (endpoint moved) are both "degraded + consecutive count" — the same coarse mapping LLM probes use today. No per-status nuance in v1.
7. **No rule-engine changes.** `provider-down`'s probe branch and `getProbeFailureCounts()` are type-agnostic — the moment ASR/TTS probes run, the probe branch covers them and probe-only providers (zero call rows, ≥3 failures) can fire `provider-down`. `provider-degraded`'s window stats include probe rows, exactly as `llm.models` rows are included today (consistent, bounded).
8. **Azure/Cartesia paid-minimal probes are out of scope** (decision below) — they remain inference-only, which is their current behavior; nothing regresses.

## Per-provider implementation notes

| Provider | `ping()` body | Transport |
|---|---|---|
| AssemblyAI ASR | `GET {restBase}/v2/transcripts?page_size=1`, restBase = `api.eu.assemblyai.com` when `config.region === 'eu'` else `api.assemblyai.com` | raw `fetch` (session SDK instance is pinned to the streaming base — do not reuse it) |
| Deepgram ASR + TTS | `GET https://api.deepgram.com/v1/projects?limit=1`, header `Authorization: Token <key>` | raw `fetch` |
| ElevenLabs ASR + TTS | `GET https://api.elevenlabs.io/v1/models`, header `xi-api-key: <key>` | raw `fetch` |
| Soniox ASR + TTS | `GET https://api.soniox.com/v1/models`, header `Authorization: Bearer <key>` (config also carries `region` us/eu/jp — verify at impl time whether the REST base is region-scoped) | raw `fetch` |
| Speechmatics ASR | `GET {regionBase}/v2/jobs` with region-mapped base (build the REST base from the provider's existing `getAuthRegion()` output: eu → `asr.api.speechmatics.com`, usa → `usa.asr.api.speechmatics.com`, au → confirm at impl time) + `Authorization: Bearer <createSpeechmaticsJWT({ type: 'batch', apiKey, region, ttl: 60 })>` — `@speechmatics/auth` package, already a dependency | raw `fetch` |
| OpenAI TTS | `GET https://api.openai.com/v1/models`, header `Bearer <key>` | raw `fetch` |
| Polly TTS | `pollyClient.send(new DescribeVoicesCommand({}))` after `init()` | AWS SDK (no network until send) |

Every `ping()` wraps its call in `this.recordPingCall(<operation>, startedAt, error?)` and throws on non-2xx so the probe's success/failure mapping is uniform. `init()` must remain side-effect-free for probe instances (construct client/config only — already true for Polly; the raw-fetch providers' `init()` is trivial).

## Scope — files

- `src/services/providers/asr/IAsrProvider.ts` — `+ ping?(): Promise<void>` (documented: optional, zero-cost liveness check, called by HealthCheckService)
- `src/services/providers/asr/AsrProviderBase.ts` — `+ recordPingCall()` helper
- `src/services/providers/asr/AssemblyAiAsrProvider.ts`, `DeepgramAsrProvider.ts`, `ElevenLabsAsrProvider.ts`, `SonioxAsrProvider.ts`, `SpeechmaticsAsrProvider.ts` — `+ ping()` (Azure: none)
- `src/services/providers/tts/ITtsProvider.ts` — `+ ping?(): Promise<void>`
- `src/services/providers/tts/TtsProviderBase.ts` — `+ recordPingCall()` helper
- `src/services/providers/tts/AmazonPollyTtsProvider.ts`, `DeepgramTtsProvider.ts`, `ElevenLabsTtsProvider.ts`, `OpenAiTtsProvider.ts`, `SonioxTtsProvider.ts` — `+ ping()` (Azure, Cartesia: none)
- `src/services/providers/asr/AsrProviderFactory.ts`, `src/services/providers/tts/TtsProviderFactory.ts` — `+ createProviderForProbing()`
- `src/services/monitoring/HealthCheckService.ts` — asr/tts probe branches in `runProviderCheck`/`maybeProbe`; header comment updated
- `src/http/contracts/monitoring.ts` — `probeSettingsSchema` + `asrProbe`/`ttsProbe` (described, `.openapi`-named)
- Docs sync: `AGENTS.md` (HealthCheckService bullet), `PROPOSAL-production-monitoring.md` (probe section), P1-05 spec gets a pointer note (it stays `resolved`), monitoring `README.md` index + dependency graph

## Open decisions (resolved 2026-08-19, approved by user)

1. **Default `'free'` (probes on).** ✅ Adopted as recommended — parity with `llmProbe: 'models'`; every probe is zero-cost and rate-bounded (10-min cooldown + recent-success skip → ≤ 144 requests/day/provider worst case).
2. **Paid-minimal probes for Azure/Cartesia: deferred.** ✅ Deferred as recommended — v1 keeps them inference-only; revisit as its own issue if a customer runs idle Azure/Cartesia providers.
3. **Config key names** `asrProbe`/`ttsProbe` (mirroring `llmProbe`) vs a unified `probeTypes` map. ✅ Mirror keys adopted — additive, backward-compatible, self-documenting next to `llmProbe`.

## Acceptance criteria

- [x] `ping()` implemented on 10 of 13 providers (all ASR except Azure; all TTS except Azure + Cartesia), each verified to hit the documented endpoint with the stored credential only — **unit tests assert URL + auth header per provider (stubbed fetch); Polly asserts `DescribeVoicesCommand` with empty input via a stubbed client**
- [x] `createProviderForProbing` on both factories (secrets resolved, empty settings, no conversation context) — **unit tests: identity stamping, `ping` presence/absence, wrong-type rejection**
- [x] `probeSettings.asrProbe` / `ttsProbe` (`'free' | 'off'`, default `'free'`) — GET/PUT round-trip, unknown enum → 400, existing config rows unaffected — **e2e in `monitoring-alerts-config.test.ts` (defaults, round-trip + restore, invalid enum 400)**
- [x] `HealthCheckService` probes asr/tts under the same gating as llm/storage (cooldown, recent-success skip, 10 s timeout, `probeFailures` counter, `probed: true` detail); instance without `ping` → inference fallback — **6 unit tests in `p1-05b-probes.test.ts`**
- [x] Probe rows recorded in `provider_call_logs` with `operation` `asr.ping` / `tts.ping` — **unit tests assert rows via the recorder seam, incl. failed rows with status in the error**
- [x] `provider-down` probe branch fires for an ASR/TTS provider with ≥ threshold consecutive probe failures and zero call rows (probe-only path) — **type-agnostic by construction: the engine reads `probeFailures` by provider id (P2-01), and the P1-05b unit tests verify the per-provider counter this rule consumes; no ASR-specific engine path exists or is needed**
- [x] Test env unchanged: `MONITORING_HEALTH_PROBES=off` → zero external probe traffic in CI (full e2e stays hermetic) — **full e2e green with probes off**
- [x] Docs synced (AGENTS.md, PROPOSAL, README index, P1-05 pointer)
- [x] Gates green: tsc, unit, e2e, build, integration

## Implementation notes (2026-08-19)

1. **Speechmatics batch auth mints a temp key — 2 fetches, not 1.** `createSpeechmaticsJWT(..., 'batch')` requires a `clientRef` (SDK validation) and POSTs to the management platform (`/api_keys?type=batch`) to mint a short-TTL temp key; the Jobs API GET then uses that temp key as `Authorization: Bearer <temp>`. Still free and side-effect-free (temp key, ~15 s TTL), but the probe performs two HTTP calls. Unit tests stub the mint call and assert both requests.
2. **AssemblyAI endpoint correction.** The spec draft suggested `GET /v2/projects` or a settings call; the implementation uses `GET {base}/v2/transcripts?page_size=1` — a cheap account-scoped listing that requires only the raw API key (AssemblyAI's `Authorization` header carries the raw key, no `Bearer` prefix). EU deployments use the `api.eu.assemblyai.com` base.
3. **Polly client is lazily built inside `ping()`.** `init()` is not called by the health service; `ping()` constructs the SDK client on first use (and reuses it across cycles via the shared factory instance) and sends `DescribeVoicesCommand` with an empty input. Unit tests inject a stub client to assert the command + empty input without AWS SDK network calls.
4. **`probesEnabled` is captured at construction.** `MONITORING_HEALTH_PROBES` is read once in the `HealthCheckService` constructor (not per pass), so tests must set the env var *before* constructing the service — a per-pass read would allow mid-flight env mutation the service never supports.
5. **Unit runner has no chai-as-promised.** Rejection assertions use a local `expectRejection()` helper (await → catch → return reason) rather than `.to.be.rejectedWith` — the unit runner context does not load chai-as-promised, and unhandled rejections from bare `.to.be.rejected` crash the suite.
6. **Factory probe configs.** `createProviderForProbing` delegates to `createProvider(provider, {})` for ASR (all ASR settings schemas accept `{}`) and `createProvider(provider, { provider: provider.apiType } as TtsSettings)` for TTS (TTS settings schemas require the `provider` literal, which equals `apiType` for all 7 TTS providers). Secrets are resolved by the factory as usual; no secrets in CI, so probes only ever run against real configs in production.

## Tests

- **Unit** (`tests/unit/monitoring/p1-05b-probes.test.ts`):
  - factory `createProviderForProbing` — secrets resolved, instance constructed with empty settings, no conversation dependency (stub secret utils)
  - `HealthCheckService` asr/tts branches — probe success → `ok {probed:true}`; failure → `degraded` + consecutive count 1→2, reset on success; cooldown suppresses second cycle; recent success skips probe; `asrProbe: 'off'`/`ttsProbe: 'off'` → inference only; instance without `ping` → inference only (Azure/Cartesia path)
  - per-provider `ping()` shape — stubbed `fetch`/SDK asserts exact URL, method, auth header, and that non-2xx rejects (AssemblyAI EU base switch; Speechmatics region base + JWT header; Polly `DescribeVoicesCommand` send)
  - probe rows — `recordPingCall` emits the right `operation`/error fields via the recorder seam
- **E2E** (implemented in `tests/e2e/monitoring-alerts-config.test.ts` — the suite that already owns `GET/PUT /api/monitoring/config`):
  - `probeSettings` round-trip via `GET/PUT /api/monitoring/config` (new fields present, default `'free'`, invalid enum → 400) ✅
  - with `MONITORING_HEALTH_PROBES=off` (test env) asr/tts providers still report via inference (status unchanged from today) ✅ (full e2e suite green with probes off — hermetic)
  - `provider-down` probe-only fire for a stubbed asr provider — covered at unit level by the type-agnostic counter tests (no real providers in CI; see acceptance note)

## Out of scope

- Paid-minimal probes (Azure ×2, Cartesia) — deferred per decision 2
- Embeddings provider probes — no embeddings implementation exists (phantom `provider_type`)
- Channel provider probes — already covered by `oauth_refresh_total` / IMAP poll counters
- Circuit-breaker behavior changes — P3-01 (it consumes the same `probeFailures`/breaker seam this issue feeds)
- Per-status failure nuance (401 vs 404 vs 429 mapping) — v1 is coarse, like LLM probes today
