# Proposal: Production Monitoring, Alerting & 3rd-Party Failover

Status: **implemented** (branch `advanced-monitoring`, 2026-08-21) — see [Implementation status & deltas](#7-implementation-status--deltas-2026-08-21)
Scope: observability + resilience additions to the Bonsai backend
Date: 2026-08-17

---

## 1. Executive summary

The backend today has **no observability beyond pino logs and a static `/health`**, and **no resilience against 3rd-party outages** — any single LLM/ASR/TTS/channel failure kills the whole conversation or silently drops an outbound message. There is also **no history** of provider failures, health, or incidents, so post-mortems are impossible.

This proposal adds, without introducing any new infrastructure (Postgres remains the only state store):

1. **Instrumentation** — every 3rd-party call is logged (provider, operation, latency, outcome, classified error) and aggregated into metrics.
2. **Deep health checks** — periodic DB / provider-probe / background-service / process checks, persisted to history, exposed via endpoints.
3. **Alerting** — a rule engine with hysteresis that detects problems (provider down/degraded, DB trouble, stalled background services, 5xx spikes, OAuth failures, …) and notifies via webhook / email / Telegram / SMS reusing existing channel providers.
4. **Failover** — per-provider circuit breakers + ordered fallback provider chains (LLM first, then TTS, ASR, storage, outbound channels), so a broken 3rd-party service no longer kills conversations.
5. **History API** — REST endpoints to query all of the above: health history, alert events, provider call logs/stats, fallback events, metrics.

Everything follows existing house conventions: tsyringe DI, Zod + OpenAPI contracts, controller/service split with RBAC, Drizzle migrations, node-cron background services, e2e tests.

---

## 2. Current-state analysis (what exists today)

### 2.1 Third-party dependency inventory

| Layer | Providers | Where selected | Failure behavior today |
|---|---|---|---|
| LLM (16 apiTypes: openai, openai-legacy, anthropic, gemini, groq, mistral, deepseek, openrouter, together-ai, fireworks-ai, perplexity, cohere, xai, ollama, ovh, scaleway) | `providers` table, `providerType='llm'` | per-entity: `stages.llmProviderId`, classifiers, transformers, tools, guardrail/sample-copy classifiers, `agent.fillerSettings.llmProviderId`, `projects.moderationConfig` — all resolved in `ConversationRunner.buildStageData()` (`src/services/live/ConversationRunner.ts:384-600`) | `setOnError` → `markAsFailed()` (`ConversationRunner.ts:980-982` completion, `:993-995` classifier, `:1007-1009` transformer) → **conversation dies** |
| ASR (6: assemblyai, azure, deepgram, elevenlabs, soniox, speechmatics) | `projects.asrConfig.asrProviderId` | project-level | ASR error → `markAsFailed` (`ConversationRunner.ts:698-703`) → **conversation dies**; init failure throws at session start |
| TTS (7: polly, azure, cartesia, deepgram, elevenlabs, openai, soniox) | `agents.tts_provider_id` | agent-level | TTS error → `markAsFailed` (`:853-857`) → **conversation dies** |
| Storage (4: s3, azure-blob, gcs, local) | `projects.storageConfig.storageProviderId` | project-level | upload errors bubble to caller (artifact/recording loss) |
| Channels (twilio-messaging, twilio-voice, whatsapp, telegram, sendgrid, ses, smtp-imap) | `providers` table, `providerType='channel'` | per webhook/outgoing call, resolved from DB on every request | **Outbound SMS failure is caught and only logged** — message silently dropped (`src/channels/twilio-messaging/TwilioMessagingConnection.ts:61-78`); outgoing Twilio call failure → 502 (`TwilioVoiceChannelHost.ts:587-603`); inbound webhook errors → 4xx/5xx + log |
| Postgres | `DB_CONNECTION_STRING` (single instance) | global | app cannot run without it; no replica, no pool saturation visibility |
| Process-local WASM (Speex, SmartTurn, FireRedVAD) | bundled | server start | fail gracefully at startup, log-only |

### 2.2 Background services (all "catch and log per tick" — loops survive, but failures are invisible)

| Service | Loop | Failure mode |
|---|---|---|
| `ConversationTimeoutService` | cron `* * * * *` | DB error → logged, tick skipped (`ConversationTimeoutService.ts:66-88`) |
| `ScenarioRunExecutorService` | `setInterval` polling | per-run errors logged; queue starves silently |
| `BenchmarkExecutorService` | `setInterval` + cron schedules | per-run errors logged |
| `ImapInboundService` | polling, connect-on-demand | IMAP connect/parse errors logged per cycle (`ImapInboundService.ts:57-58,126-127`) |
| `OAuth2TokenRefreshService` | periodic | refresh failures logged; IMAP reload best-effort (`OAuth2TokenRefreshService.ts:97-98,152-153`) |
| `ProcessingDeferralService` | cron `*/15 * * * * *` | per-item errors logged |

**No heartbeats** — a silently dead loop (unhandled rejection in a worker, event-loop starvation) is undetectable.

### 2.3 Observability today

- `GET /health` — **static 200 `{"status":"healthy"}`**, no DB or dependency checks (`src/server.ts`). No liveness/readiness split.
- Logging: pino to stderr. Only "Incoming request" is logged — **no request outcome (status/duration/requestId)**; no pino redaction of `Authorization` headers.
- **429s are completely invisible**: `TooManyRequestsError` → 429 JSON with zero logging (`src/http/middleware/errorHandler.ts`), and the rate-limiter handlers (`src/http/middleware/rateLimiter.ts`) never log either — no way to tell if a client is being throttled, a limit is misconfigured, or someone is brute-forcing login.
- No metrics, no tracing, no alerting, no retries, no circuit breakers, no fallbacks anywhere in `src/`.
- Error mapping: `RemoteConnectionError` → 502, `OAuthTokenRefreshError` → 502 (`src/http/middleware/errorHandler.ts`) — but nothing records that these happened.
- **No graceful shutdown** — no `SIGTERM`/`SIGINT` handlers (grep confirms only ffmpeg child-process handlers exist); active WebSocket/voice conversations are killed on container stop.
- Existing history: `audit_logs` (entity CRUD), `conversation_events` (lifecycle), benchmark/scenario results. **Nothing about provider call outcomes, health over time, or incidents.**

### 2.4 Conventions the design must follow (verified in code)

- Controllers: `@singleton()`, `static getOpenAPIPaths()`, `registerRoutes(router)`, `checkPermissions(req, [...])`, handlers wrapped in `asyncHandler`, one-line loggers, Zod schemas with `.describe()` (see `AuditController.ts` as template).
- Services: `@injectable()`, `BaseService`, mandatory `RequestContext` param + `requirePermission(context, PERMISSIONS.X)` on writes.
- Lists: `listParamsSchema` (`offset/limit/textSearch/orderBy/filters`) in `src/http/contracts/common.ts`.
- DB: Drizzle `pgTable` in `src/db/schema.ts`; text ids; `createdAt/updatedAt` `defaultNow()`; explicit indexes; migrations via `npm run db:generate` (latest is `0067`, next is `0068`).
- Background services: node-cron `schedule()` or `setInterval` + `isProcessing` guard, `start()` called from `server.ts` via `container.resolve(X).start()`.
- Global (non-project) entities: `providers`, `operators`, `api_keys`, `secrets` — monitoring config fits here.
- Permissions: `PERMISSIONS` in `src/permissions.ts` (there is already `SYSTEM_CONFIG: 'system:config'`).
- Secrets: resolved via `SecretRefUtils` / `SecretsManagerRegistry` — notifiers must reuse this, never store raw credentials.

---

## 3. Proposed architecture

```
                         ┌────────────────────────────────────────────────────────┐
                         │                    IN-PROCESS                          │
 3rd-party calls ──────► │ ProviderCallLogger ──► MetricsRegistry (rolling win)  │
 (LLM/ASR/TTS/           │ CircuitBreakerRegistry (per provider id)              │
  storage/channel)       │ HeartbeatRegistry (per background service)            │
                         │                                                        │
 /health, probes,        │ HealthCheckService (60s loop)                         │
 pool stats, procs ─────►│       │                                                │
                         │       ▼                                                │
                         │ AlertRuleEngine (1/min) ──► AlertNotifier (webhook /   │
                         │ state machine w/ hysteresis      email / tg / sms)     │
                         └──────────┬──────────────────────────────┬─────────────┘
                                    │ batched async writes          │ cron (hourly rollup,
                                    ▼                               ▼ daily retention)
                         provider_call_logs, health_checks, alert_events,
                         fallback_events, metric_samples (+hourly rollups)
                                    │
                                    ▼
                         MonitoringController — REST history API (/api/monitoring/*)
                         + /health (live) + /health/ready (db) + optional /metrics (Prometheus)
```

**Design principle: zero new infrastructure.** Postgres is already a hard dependency; metrics, health history, alerts, and call logs all live there. No Redis, no Prometheus server, no external APM. (An optional Prometheus scrape endpoint is included so you can *add* Grafana later without code changes.)

### 3.1 New module layout

```
src/services/monitoring/
  CallLogger.ts            # ProviderCallLogger — records 3rd-party call outcomes (batched inserts)
  MetricsRegistry.ts       # in-process counters/gauges/histograms + 60s flush to metric_samples
  HeartbeatRegistry.ts     # lastRunAt per background service + per-service error counters
  HealthCheckService.ts    # check registry + 60s probe loop + in-memory snapshot
  MonitoringContext.ts     # AsyncLocalStorage business-context propagation (P1-02)
  StreamStats.ts           # per-stream accumulator → provider_call_logs streaming fields (P1-03)
  CircuitBreaker.ts + CircuitBreakerRegistry.ts   # closed/open/half-open breaker, per provider id (P3-01)
  AlertEvents.ts           # rule model + zod param schemas + registered default-rule evaluators (P2-01)
  AlertRuleEngine.ts       # rule evaluation (1/min), state machine, hysteresis, cooldowns (P2-01)
  AlertEventPublisher.ts   # engine→notifier seam; LogAndPersistPublisher in P2-01 (P2-02 wraps it)
  MonitoringConfigService.ts # loads/validates monitoring_config row + env fallbacks
  RetentionService.ts      # hourly rollups + daily purge (node-cron)
  notifiers/
    AlertNotifier.ts       # interface + NotifyingPublisher (P2-02)
    WebhookNotifier.ts / EmailNotifier.ts (P2-02); TelegramNotifier.ts / TwilioSmsNotifier.ts (P4-02)
  FallbackEventService.ts  # single write path for fallback_events rows (P3-02)
  WebhookDeadLetterService.ts  # (P4-03)
src/services/providers/FallbackResolver.ts    # builds ordered [primary, ...fallbacks] chains from providers.fallbacks (P3-02)
src/services/providers/{llm,tts,asr,storage}/Failover*Provider.ts   # failover decorators (P3-03/P3-04)
src/services/channels/OutboundChannelFallback.ts   # per-request outbound channel fallback helper (P3-05)
src/utils/errorClassification.ts   # classifyThirdPartyError() → auth|rate_limited|timeout|server_error|client_error|network|unknown
src/utils/shutdown.ts              # graceful shutdown sequence (P1-09)
src/http/controllers/MonitoringController.ts
src/http/contracts/monitoring.ts
```

### 3.2 Instrumentation (the foundation)

**a) `ProviderCallLogger`** — one row per 3rd-party call:

| field | notes |
|---|---|
| `providerId`, `providerType`, `apiType` | from `providers` table |
| `operation` (16) | `llm.generate`, `llm.classify`, `llm.transform`, `llm.tool`, `llm.filler`, `llm.moderate`, `llm.models` (probe), `asr.session`, `tts.synthesize`, `storage.upload`, `storage.download`, `channel.send_message`, `channel.outbound_call`, `channel.webhook`, `oauth.refresh`, `imap.poll` |
| `model` | nullable (LLM/ASR/TTS) |
| `projectId`, `conversationId` | nullable — ties incidents to business context |
| `ok` (bool), `errorCode`, `statusHttp`, `durationMs`, `errorText` (truncated 1KB) | |
| `fallbackProviderId` | set when this call executed on a fallback |
| `metrics` (jsonb, TS type `CallMetrics`) — variant-specific phase fields, sparse: LLM `ttftMs`, `chunksCount`, `maxChunkGapMs`, `finishReason`, `tokensPrompt`, `tokensCompletion`, `errorPhase` (`setup` \| `mid_stream`); TTS `audioBytesOut`, `audioDurationMs`; ASR `setupMs`, `timeToFirstPartialMs`, `eosToFinalMs`, `partialsCount`, `finalsCount`, `sessionAudioMs` | see §3.2f — phase-level measurement instead of a single duration; jsonb because a row is one variant (flat columns would be mostly NULL), nothing index-seeks these fields, and new fields need no migration |

Write path: in-memory bounded buffer, flushed every 5s or 200 rows (whichever first) via `INSERT ... VALUES` batch; flush failure → keep last 10k in memory + pino error (never throw into the business path). Instrumentation points (choke points, minimal diff):

- `LlmProviderBase.generate()` / `generateStream()` — wraps **all 16 LLM providers** in two methods; also wraps `enumerateModels()` and `moderateUserInput()`.
- `AsrProviderBase.init()/start()/stop()` and `TtsProviderBase` synthesize entry points.
- `StorageProviderBase.upload/download`.
- Each channel connection's `sendMessage` (Twilio SMS/WhatsApp, Telegram, email) + channel hosts' webhook handlers + `twilioClient.calls.create`.
- `OAuth2TokenRefreshService` refresh results and `ImapInboundService` poll results.

`classifyThirdPartyError()` normalizes SDK errors (OpenAI/Anthropic/Twilio/FB-Graph/AWS status + codes, `ETIMEDOUT`/`ECONNREFUSED`, 429 vs 5xx vs 401/403) into the `errorCode` enum — this drives both alerting and retry/fallback decisions.

**b) `MetricsRegistry`** — in-process, flushed every 60s to `metric_samples`:

- `api_requests_total{method, route_group, status_class}` + duration histogram — from a **new request-outcome middleware** (also adds `requestId` uuid, duration, status, operatorId to pino; `res.on('finish')`).
- `provider_calls_total{provider_id, provider_type, operation, ok, error_code}` + `provider_call_duration_ms`.
- Gauges: `active_conversations` (ConversationRunner start/terminal state, P1-03), `active_websocket_connections` (WS connect/disconnect, P1-03), `active_voice_media_streams` (Twilio Media Streams accept→close, P1-03), `db_pool_total/idle/waiting` + `rss_bytes` + `event_loop_lag_p95_ms` + `event_loop_lag_max_ms` (p95 + max over a 60 s in-memory window from `perf_hooks.monitorEventLoopDelay`; max for burst-sensitive rules) — the last group published by the P1-05 checks, so the rule engine reads gauges only.
- `circuit_breaker_state{provider_id}` (0/1/2), `circuit_opens_total{provider_id}`, `circuit_open_skips_total{provider_id}`, `fallback_attempts_total{provider_id}` (each failed attempt that moved the chain), `fallbacks_executed_total{provider_id, fallback_provider_id}` (successful transitions), `provider_chain_exhausted_total{provider_id}`, `fallback_incompatible_total{provider_id}` (skipped incompatible TTS fallback), `background_service_last_run_ts{service}` (heartbeats).
- Per-check health metrics (`specs/health-check-metrics-spec.md`, 2026-09-01): `health_check_status{check,…}` (gauge, 0=ok/1=degraded/2=down/3=unknown — `unknown` published too) + `health_check_latency_ms` (histogram, buckets 5…10000 ms) published per cycle by the P1-05 checks; latency observed only where a real measurement exists (db ping, provider probes). Labels bounded: `{check}` + `service` / `provider_id`+`provider_type` — never the raw `provider:<id>` check name; 500 series per metric.
- `rate_limit_rejections_total{scope, key_type}` (scope: `api` | `auth`; key_type: `operator` | `ip`) — hooked in both `createApiRateLimiter`/`createAuthRateLimiter` handlers, which also gain a pino warn line (`operatorId`/`ip` redacted to key hash, path). Covers **Bonsai's own 429s**. **Upstream 429s** (LLM/ASR/TTS/Twilio returning 429) are captured as `provider_call_logs` rows with `error_code='rate_limited'` — the two directions are tracked separately on purpose (own limits = capacity/client issue; upstream limits = quota problem needing provider attention).
- `oauth_refresh_total{provider_id, ok}`, `imap_poll_total{provider_id, ok}` (message count lives in the call-log `metrics.messagesFound` jsonb — an unbounded label is not allowed).
- **Voice media (Twilio Media Streams, P1-03):** `voice_media_bytes_total{direction}` (counter, `direction` ∈ in/out), `voice_media_max_frame_gap_ms{direction}` (histogram of frame inter-arrival gaps). Per-frame rows are impossible under the fixed operation enum — metrics only (disconnect reason → pino warn).
- **Streaming histograms** (phase-level, not total duration — see §3.2f): `llm_ttft_ms`, `llm_stream_duration_ms`, `tts_ttfa_ms`, `tts_synthesis_ms`, `asr_setup_ms`, `asr_eos_to_final_ms`, `ai_turn_ttft_ms{project_id}` (end-to-end: user EOS → first TTS audio chunk). Labels stay low-cardinality: `provider_id`, `operation`, `model`, `direction` (voice media); token counts live in the call log, never as labels.

**c) Deep health — `HealthCheckService`**

- `GET /health` stays static liveness (docker/k8s `livenessProbe`).
- New `GET /health/ready` — real `SELECT 1` + pool reachable (for `readinessProbe`); returns 503 when DB is down.
- 60s background loop runs the check registry; results persisted to `health_checks` and kept as an in-memory snapshot:
  - `db`: ping + pool saturation (waiting>0 → degraded).
  - `provider:{id}` probes — LLM: `enumerateModels()` (already implemented on every LLM provider, cheap) or 1-token generation (globally opt-in via `monitoring_config.probeSettings` — costs money, off by default); storage: list with limit 1; ASR/TTS: zero-cost liveness `ping()` on a fresh, uninitialised instance (10 of 13 providers have a free endpoint; Azure ASR/TTS + Cartesia TTS fall back to call-log inference — P1-05b addendum, `probeSettings.asrProbe`/`ttsProbe` `'free' | 'off'`). Note (2026-08-24): for streaming ASR the probe is a REST **control-plane** check (account/key liveness), not the WebSocket data plane — data-plane liveness is carried by the `provider-down` call-log/breaker branches; see `docs/guide/monitoring.md` → “What the provider probes actually measure”; channels: provider-specific cheap call where it exists (Twilio: none — rely on call-log signals, status `inferred`). Non-probed providers: status derived from recent `provider_call_logs` (e.g. "ok if ≥1 success in last 30 min"). Probe cooldown: no more than 1 probe/provider/10 min; skipped if call logs show recent success.
  - `service_heartbeat:{name}` for all 6 background services (stale > 3× interval → down).
  - `process`: RSS vs threshold, event-loop lag, uptime.
- Full snapshot served at `GET /api/monitoring/health` (auth).

**d) Background service heartbeats** — each of the 6 services calls `HeartbeatRegistry.tick('conversation-timeout')` (plus error counters on caught failures). One-line change per service.

**f) Streaming-aware measurement (the core question: total duration is meaningless for streams)**

A 20 s LLM stream for a 300-word answer is excellent; 20 s for a 10-word answer is terrible; and a 12 s stream with one 9 s gap in the middle is a provider hiccup that no average or total will ever surface. So streaming calls are measured by **phases**, not by one duration:

| Stream | Phases recorded (per call-log row) | Derived signal |
|---|---|---|
| LLM `generateStream` | `ttftMs` (request → first chunk), `chunksCount`, `maxChunkGapMs` (largest gap between consecutive chunks), `tokensPrompt`/`tokensCompletion` (from the `usage` callback), `finishReason` | **TTFT** = perceived responsiveness; **stall** = `maxChunkGapMs > 10 s` mid-stream; throughput = `tokensCompletion / (duration − ttft)` |
| TTS per turn | `ttftMs` (time to first `onSpeechGenerating` audio chunk — stored under the same generic `ttftMs` key in `metrics` as LLM; the dedicated histogram is `tts_ttfa_ms`), `audioBytesOut`, `audioDurationMs` (length of produced audio), flat `duration_ms` column = synthesis wall time, `canceled` (barge-in) | **RTF** = `duration_ms / audioDurationMs`; RTF > 1 ⇒ TTS can't keep up ⇒ user hears gaps mid-sentence |
| ASR per session | `setupMs` (init→start), `timeToFirstPartialMs`, `eosToFinalMs` (VAD end-of-speech → final transcript), `partialsCount`/`finalsCount` | `eosToFinalMs` = how long the system "thinks" after the user stops talking |
| Voice/WS connections (Twilio Media Streams, WebRTC, WebSocket) | session duration, bytes in/out, `maxFrameGapMs`, disconnect reason | jitter/stall indicator per connection; feeds `active_*` gauges |

**Why "arbitrarily long input" stops being a problem:**
- LLM prompt length (the only input that affects latency — pre-fill) is *bounded in practice*: `ResponseGenerator` truncates via `inputTokenCap` / `truncateMessagesToTokenBudget`, so TTFT variance from prompt size is capped by project config, not unbounded.
- Raw token counts are stored per row (log column) and can be bucketed in SQL rollups (`<100 / 100–500 / 500–2000 / 2000+` completion tokens) if a threshold ever needs normalization — but never as metric labels (cardinality).

**Implementation — all hooks already exist, minimal diff:**
- `LlmProviderBase` already routes every stream through `notifyStarted()` / `notifyChunk()` / `notifyComplete()` / `notifyError()`. A small `StreamStats` accumulator in the base (start time, first-chunk time, last-chunk time, chunk count, max gap, finishReason, usage) emits the extra columns on the existing `provider_call_logs` row at complete/error. **All 16 LLM providers get this for free in two methods.** `errorPhase` distinguishes `setup` failures (failover-able, pre-first-chunk) from `mid_stream` (not failover-able — see §3.4).
- ASR: provider records `setupMs` + partial/final timestamps; `ConversationRunner` supplies the end-of-speech timestamp (VAD pause / last `sendAudio`) — it already owns that moment.
- TTS: same accumulator pattern on the `onSpeechGenerating` chunk callback.
- **End-to-end turn waterfall:** `ConversationRunner` sees user EOS, ASR final, LLM first chunk, and TTS first audio — it emits one aggregate histogram `ai_turn_ttft_ms{project_id}` (the single "how snappy did this voice agent feel" number). Per-incident forensics: the ASR + LLM + TTS call-log rows for the same `conversationId`/time window reconstruct the exact waterfall per turn.

**Streaming-specific alert rules** (complement error-rate rules — a provider can be 100% "successful" yet feel broken):

| rule id | severity | condition (defaults) |
|---|---|---|
| `stream-slow-ttft` | warning | TTFT p95 > 10 s (LLM) or > 3 s (TTS `ttftMs`) in 15 min (min 20 streams), per provider |
| `stream-stalls` | warning | >10% of streams with `maxChunkGapMs > 10 s` in 15 min — provider stalling, usually the early warning before a full outage |
| `tts-rtf-degraded` | warning | >10% of TTS turns with RTF > 1 in 15 min (user hears mid-sentence gaps) |
| `asr-final-latency` | info | `eosToFinalMs` p95 > 10 s in 15 min |
| `stream-abort-rate` | warning | >10% of streams ending with `errorPhase='mid_stream'` or abnormal `finishReason` in 15 min |

**g) Hardening while we're in there** (small, high-value):

- Graceful shutdown in `src/index.ts`: `SIGTERM`/`SIGINT` → stop cron/interval services, stop accepting new WS connections, drain active conversations up to `SHUTDOWN_GRACE_MS` (default 10s), close HTTP server, close pg pool.
- pino redaction of `Authorization` headers in request logs.

### 3.3 Alerting

**`AlertRuleEngine`** (node-cron, 1/min) evaluates a **registered set of rule evaluators** over: in-memory metric windows, health snapshot, and rolling `provider_call_logs` windows. Rules are not a generic condition DSL — several defaults are OR-composites over heterogeneous sources (e.g. `provider-down` below), so each rule is a named, unit-tested evaluator in code; `monitoring_config` only overrides *parameters* (thresholds, windows, minSamples, severity, `enabled`) per rule id. 21 default rules total — 20 ship in Phase 2, the 21st (`provider-chain-exhausted`) is added in Phase 3 when its data source exists.

Default rules (built-in, overridable in `monitoring_config`):

| rule id | severity | condition (defaults) |
|---|---|---|
| `db-down` | critical | health check `db` down for 2 consecutive checks (~2 min) |
| `db-pool-saturated` | warning | pool waiting > 20% of total for 5 min |
| `provider-down` | critical | error rate 100% over ≥5 calls in 10 min, **or** breaker open, **or** probe failed N=3 consecutive times |
| `provider-degraded` | warning | error rate > 30% in 10 min (≥10 calls) or p95 latency > per-type threshold (LLM 20s, ASR 2s, TTS 5s, channel 10s) |
| `provider-rate-limited` | warning | ≥5 `rate_limited` errors for a provider in 10 min (quota problem — distinct from outage) |
| `service-stalled` | warning | heartbeat stale > 3× interval (per service; a dead loop is degraded, not an outage — upgrade severity via config if a specific service is mission-critical for you) |
| `api-5xx-spike` | warning | 5xx ratio > 5% in 5 min (min 20 reqs) |
| `api-429-spike` | warning | ≥20 API 429 rejections in 5 min — indicates client abuse, misconfigured polling, or limit set too low; scope per offending key when one operator/IP causes > 50% of the tracked rejections (the original "429 ratio" variant was dropped in the P2-01 review: `status_class` lumps 429 into 4xx, so no ratio source exists) |
| `auth-429-spike` | warning | ≥5 auth (login/refresh) 429 rejections in 15 min — **security signal** (possible credential stuffing / brute force); same per-key scoping as `api-429-spike` (dominant operator/IP key) |
| `oauth-refresh-failing` | warning | ≥3 refresh failures for a provider in 1 h |
| `imap-poll-failing` | warning | ≥5 failed poll cycles for a provider in 1 h |
| `high-memory` | warning | `rss_bytes` gauge > `MONITORING_MEMORY_THRESHOLD_MB` (default 1.5 GB) |
| `event-loop-lag` | warning | `event_loop_lag_p95_ms` gauge > 250 ms, sustained (forMinutes) |
| `provider-auth-failed` | critical | ≥1 `error_code='auth'` call on a provider in 5 min — misconfigured/expired credentials; deliberately does **not** count toward the circuit breaker (won't self-heal), but does trigger failover (fallback may hold valid credentials) |
| `provider-chain-exhausted` **(Phase 3)** | critical | ≥1 `provider_chain_exhausted_total{provider_id}` increment in 5 min, per provider — the whole fallback chain is dead; message names the full chain tried |
| `fallback-active` | info | any fallback executed in the window (early signal, usually precedes `provider-down`) |
| `stream-slow-ttft`, `stream-stalls`, `tts-rtf-degraded`, `asr-final-latency`, `stream-abort-rate` | warning/info | streaming-quality rules — see §3.2f; catch "healthy but feels broken" providers that error-rate rules miss |

State machine per alert key (`ruleId:scope`, e.g. `provider-down:prov_123`):

```
OK → PENDING (condition true for `for` duration, default 2 min)
   → FIRING  (alert_events row created, notifications sent)
   → RESOLVED (condition false for 2 consecutive checks; auto-resolve after 6 h max)
```

Hysteresis + per-key cooldown (default 15 min between re-fires of an unresolved-same-condition alert) prevent flapping. Manual `POST /api/monitoring/alerts/{id}/acknowledge` stamps `ackedAt/ackedBy` (also recorded in `audit_logs`).

Note on 429 coverage — both directions are handled:
- **Bonsai rejecting clients (own rate limits)** → `api-429-spike` / `auth-429-spike` rules above, fed by `rate_limit_rejections_total{scope, key_type}`.
- **3rd parties rejecting us (upstream quotas)** → `provider-rate-limited` rule, fed by `provider_call_logs` rows with `error_code='rate_limited'` (classified from SDK 429s by `classifyThirdPartyError()`). This is deliberately a *separate* rule from `provider-down` because a quota-limited provider is usually up and healthy — the remediation is different (raise quota, add fallback, throttle usage) and it often recurs at predictable times (hourly/daily quota resets).

**Notifiers** (`AlertNotifier` interface, all fire-and-forget, delivery outcome stored on the alert event):

- `WebhookNotifier` — POST JSON `{event, rule, severity, scope, message, firedAt, resolvedAt, context}` to a URL; works with Slack/Discord/PagerDuty/ntfy/Make as-is.
- `EmailNotifier` — **reuses an existing channel provider record** (sendgrid/ses/smtp) chosen in config; no new credentials.
- `TelegramNotifier` / `TwilioSmsNotifier` — same pattern, for on-call pings.

Config: single global row `monitoring_config` (`{notifiers: [{id, type, channelProviderId?, url?, to?, enabled, minSeverity}], rules: {<ruleId>: {enabled?, threshold?, windowMinutes?, minSamples?, severity?, ...}}, retentionDays, probeSettings}`), editable via API; env fallbacks (`MONITORING_WEBHOOK_URL`, `MONITORING_EMAIL_PROVIDER_ID`) so it works with zero DB config. `minSeverity` (default `info`) = the lowest severity a notifier receives. Notifier `type` starts as `'webhook' | 'email'`; Phase 4 extends it with `'telegram' | 'twilio_sms' | 'whatsapp'` (P4-02, done; voice was analyzed and rejected). The new types reuse existing channel provider rows for credentials (`providers` table, `providerType='channel'`), send directly (the channel connections swallow errors) and record their own `channel.send_message` call-log rows; `to` is per-type (email address vs E.164) and validated by a per-type `superRefine`, `chatId` for telegram. All three are served by a single `ChannelNotifier` class (per-channel strategy table) — the per-channel class design was simplified away after implementation (2026-08-20 analysis); `WebhookNotifier` and `EmailNotifier` remain separate by design. If all notifiers fail, alerts still land in `alert_events` (history is never lost to notifier outages).

### 3.4 Fallback for broken 3rd-party services

Two mechanisms compose:

**a) Circuit breakers (per provider id, in-memory)** — `failureThreshold=5` failures (classified as `server_error|timeout|network|rate_limited`, plus `unknown` counted conservatively) within 60 s → **open** for `cooldownMs=5 min` → **half-open** (one probe call) → closed on success. `auth` and `client_error` never open the breaker (misconfiguration won't self-heal; `provider-auth-failed` is the reaction). While open, calls skip the provider immediately. State transitions are logged as call-log entries + `circuit_breaker_state` metric + feed the `provider-down` alert. Breakers reset on process restart (acceptable; probes re-learn quickly).

**b) Ordered fallback chains** — new column on `providers`:

```ts
fallbacks: { providerId: string; settings?: Record<string, unknown> }[]  // ordered
```

- `ProviderService` validates on create/update: same `providerType` as primary, fallback exists, no cycles (graph check across the `fallbacks` edges).
- `FallbackResolver` (cached per conversation build) returns the full chain for any primary provider id.
- **LLM (highest value)**: `FailoverLlmProvider` decorator implements `ILlmProvider`. In `ConversationRunner.buildStageData()`, each resolved LLM provider (completion, classifiers, transformers, guardrails, sample-copy, filler, moderation) is wrapped: on circuit-open or a failure with `errorPhase='setup'` — i.e. **before the first chunk** (after 1 bounded retry with 500 ms backoff for `timeout`/`server_error`), it records a `fallback_events` row + `fallback_attempts_total` metric and re-runs the call on the next chain member (a successful transition also increments `fallbacks_executed_total`). The `errorPhase` column (§3.2f) is what makes this decision mechanical: `setup` → failover, `mid_stream` → not failover-able (partial chunks already sent to the client/TTS), the turn fails as today (documented limitation). All chain members exhausted → original error surfaces (conversation fails only when the *entire chain* is dead) + `provider-chain-exhausted` alert (critical).
- **TTS**: wrap per-turn synthesis; on failure before first audio chunk of a turn → retry the turn on the fallback TTS (that turn's audio is lost, conversation continues); mid-turn failure → fail turn (as today).
- **ASR**: failover on `init()/start()` failure (restart session with next ASR provider — clean). Mid-stream ASR errors still fail the conversation (audio already consumed; switching mid-stream is not safe) but now emit `provider-down` alerts and appear in history.
- **Storage**: wrap upload/download; per-call failover to next storage provider (e.g. S3 → GCS); artifact metadata records which provider stored it.
- **Outbound channels**: optional **per-request** parameter `fallbackChannelProviderId` on the six outbound endpoints (`POST /api/twilio/messaging/send`, WhatsApp, Telegram, SendGrid, SES, smtp-imap, Twilio voice call) — when the requested `channelProviderId` send fails, retry **once** on the fallback channel, dispatching on the fallback row's `apiType` (the channel kind), not `providerType` (which is just `'channel'`). Validation happens at request time (provider exists, `providerType='channel'`, ≠ the request's primary) — verified against the codebase: channel providers are resolved per request (query param/body, API-key auth), there is **no agent-owned channel provider column**, so an agent-level default is a follow-up. No DB migration for this feature. Inbound webhooks have no failover by nature; instead their failures are fully logged (call log `channel.webhook` with HTTP status) — visible in `GET /api/monitoring/provider-calls` and counted by `api-5xx-spike`. Dedicated webhook rules (e.g. `webhook-failures` 5xx-spike, `webhook-dead-letter` backlog) are follow-ups after P4-03, which provides their data source.

All failover executions are persisted in `fallback_events` — this is the "history of the fallbacks" the user asked for, queryable per provider/conversation/time range.

### 3.5 History (new DB objects, migration `0068_*.sql`)

```ts
// providers: + fallbacks jsonb default []

provider_call_logs (id text pk, provider_id, provider_type, api_type, operation,
  model, project_id, conversation_id, ok bool, error_code, status_http,
  duration_ms int, error_text, fallback_provider_id, metrics jsonb, created_at)
  -- metrics (nullable jsonb, TS type CallMetrics; see §3.2f) holds the variant-specific
  -- streaming/ASR/TTS phase fields sparsely — a row is one variant, so flat columns
  -- would be ~9–13 NULLs per row: LLM ttftMs/chunksCount/maxChunkGapMs/finishReason/
  -- tokensPrompt/tokensCompletion/errorPhase; TTS audioBytesOut/audioDurationMs/canceled;
  -- ASR setupMs/timeToFirstPartialMs/eosToFinalMs/partialsCount/finalsCount/sessionAudioMs;
  -- channels/storage bytesIn/bytesOut; IMAP messagesFound.
  -- Nothing index-seeks these (only batch window scans aggregate them, via ->>), and new
  -- streaming fields can be added without a migration. Core columns stay flat: filtered/
  -- indexed, and error_code feeds the stats-table PK.
  -- indexes: (created_at), (provider_id, created_at), (project_id, created_at), (conversation_id)
  -- retention: purge > retentionDays (default 90), daily cron

provider_call_stats_hourly (hour_bucket timestamp, provider_id, operation,
  ok bool notNull, error_code text notNull default 'none', -- PK members must be non-NULL; rollup COALESCEs NULL → 'none'
  count, sum_duration_ms, min_duration_ms, max_duration_ms,
  p95_duration_ms,
  p50_ttft_ms, p95_ttft_ms, p99_ttft_ms, p95_max_chunk_gap_ms, -- streaming percentiles
  stalled_count int, rtf_over_1_count int)  -- PK(hour_bucket, provider_id, operation, ok, error_code)
  -- built hourly from raw logs (cron), powers fast stats endpoints

health_checks (id text pk, check_name, status, latency_ms int, detail jsonb, created_at)
  -- indexes: (check_name, created_at), (created_at)

alert_events (id text pk, rule_id, scope_key, scope jsonb, severity,
  status text, -- 'firing' | 'resolved'
  message, context jsonb, notifications jsonb,
  fired_at, resolved_at timestamp, acked_at timestamp, acked_by text)
  -- indexes: (fired_at), (scope_key, status), (rule_id, fired_at)

fallback_events (id text pk, provider_id, fallback_provider_id, provider_type,
  operation, reason, project_id, conversation_id, success bool, created_at)
  -- indexes: (created_at), (provider_id, created_at)

metric_samples (id text pk, -- jsonb labels can't be part of a PK
  bucket timestamp, name, labels jsonb, count bigint,
  sum double, min double, max double, created_at)
  -- index: (name, bucket), (bucket)

monitoring_config (id text pk default 'global', config jsonb notNull,
  version int notNull default 1, updated_at)
```

### 3.6 New REST API (house style: `listParamsSchema`, `checkPermissions`, `requirePermission`, OpenAPI via `getOpenAPIPaths`)

New permission: `PERMISSIONS.SYSTEM_MONITORING: 'system:monitoring'` (granted to `super_admin`; optionally `developer`).

| Endpoint | Purpose |
|---|---|
| `GET /health` (existing, unchanged) | liveness |
| `GET /health/ready` (new) | readiness — real DB ping; 503 when DB down |
| `GET /metrics` (optional, token-gated via `MONITORING_METRICS_TOKEN`) | Prometheus text exposition for external Grafana/Prometheus |
| `GET /api/monitoring/health` | current deep-health snapshot (all checks + details) |
| `GET /api/monitoring/health/history` | `listParamsSchema` + `check` filter → persisted health history |
| `GET /api/monitoring/alerts` | alert events; filters: `status`, `severity`, `ruleId`, date range |
| `GET /api/monitoring/alerts/{id}` | detail incl. notifications + context |
| `POST /api/monitoring/alerts/{id}/acknowledge` | manual ack (audit-logged) |
| `GET /api/monitoring/providers` | per provider: breaker state, last probe, rolling error rate + p95 (15 min) |
| `GET /api/monitoring/provider-calls` | raw call logs; filters: `providerId`, `providerType`, `ok`, `errorCode`, `conversationId`, date range |
| `GET /api/monitoring/provider-stats` | `groupBy=hour\|day`, `from/to` (span ≤ 14 days), `providerId`, `operation` — recomputed from `provider_call_logs` over the window (percentiles can't be merged across the rollup's `ok`/`errorCode` PK dimension, and the live partial hour has no rollup row yet; P1-08 soundness finding 1) |
| `GET /api/monitoring/fallback-events` | failover history; filters: `providerId`, `date range`, `success` |
| `GET /api/monitoring/metrics` | generic time series: `name`, label filters, `from/to/step` |
| `GET /api/monitoring/config` | current rules/notifiers/retention |
| `PUT /api/monitoring/config` | update (optimistic locking via `version`, super_admin) |

All endpoints skip the API rate limiter for `/health/*` + `/metrics` (same treatment as existing `/health`).

### 3.7 Documentation & config surface

- `docs/guide/monitoring.md` — concepts, default rules, how to configure notifiers, how to set up fallback chains, endpoint reference (VitePress, remember: no bare `{{ }}` outside code fences).
- `compose/env.example` + `.env.example`: new vars — `MONITORING_WEBHOOK_URL`, `MONITORING_EMAIL_PROVIDER_ID`, `MONITORING_METRICS_TOKEN`, `MONITORING_RETENTION_DAYS` (90), `MONITORING_HEALTH_INTERVAL_MS` (60000), `MONITORING_CALL_LOG_BUFFER_SIZE`, `MONITORING_MEMORY_THRESHOLD_MB`, `SHUTDOWN_GRACE_MS`. (No global `MONITORING_ENABLED` switch — instrumentation is always on and cheap; individual behavior is tuned via `monitoring_config`.)
- `AGENTS.md`: short section on the monitoring module (for future agents).

---

## 4. Phased implementation plan

Each phase is independently shippable and keeps the build green (`npm run build`) + full e2e suite passing.

### Phase 1 — Instrumentation & health (foundation)
1. Migration `0068`: `provider_call_logs`, `health_checks`, `metric_samples`, `monitoring_config` (+ `providers.fallbacks` column now so later phases don't re-migrate).
2. `src/utils/errorClassification.ts`, `CallLogger`, `MetricsRegistry`, `HeartbeatRegistry`.
3. Instrument provider bases (LLM/ASR/TTS/storage) + channel connections/hosts + OAuth/IMAP services.
4. Request-outcome middleware (requestId, duration, status, 5xx hook, pino redaction).
5. `HealthCheckService` + `/health/ready` + heartbeat ticks in the 6 background services.
6. `RetentionService` (rollup + purge), `MonitoringConfigService`.
7. Rate-limit instrumentation: `rate_limit_rejections_total{scope, key_type}` + warn logging in both limiter handlers.
8. Read-only endpoints: `GET /api/monitoring/health`, `/health/history`, `/provider-calls`, `/provider-stats`, `/providers`, `/metrics` (+ introduces `PERMISSIONS.SYSTEM_MONITORING`, granted to `super_admin`).
9. Graceful shutdown in `src/index.ts`.
- **Tests:** unit (classifier, call logger batching, `StreamStats` accumulator — TTFT/chunk-gap/max-gap/finishReason capture, metrics flush), e2e (endpoints return 200 with fixtures, health/ready reflects DB state, call logs appear after a conversation using a mock streaming provider with `ttftMs`/`chunksCount` populated, 429 responses increment `rate_limit_rejections_total` and are logged).

### Phase 2 — Alerting
1. `AlertRuleEngine` + state machine + 20 default rule evaluators (15 general + 5 streaming — per-rule evaluators in code, params overridable in config).
2. `alert_events` writes (table added in 0068) + notifiers (webhook first, then email reusing channel provider).
3. `GET/PUT /api/monitoring/alerts*`, `/config`.
4. RBAC completion: role matrix for `SYSTEM_MONITORING` (permission introduced in Phase 1 step 8), audit-log integration for config writes/acks, 403 coverage for all non-super-admin roles.
- **Tests:** unit (rule eval with synthetic windows, hysteresis/cooldown, 429 spike detection incl. per-key scoping), e2e (fire a rule via injected synthetic failures; webhook received by a local test server; alert appears in API; ack works; PUT config validates + optimistic lock; driving the API rate limiter past `RATE_LIMIT_API_MAX` in test env fires `api-429-spike`).

### Phase 3 — Failover
1. `CircuitBreaker` + registry; wire into `CallLogger` outcomes.
2. `FallbackResolver` + `ProviderService` validation (type match, cycles) + provider API contract changes (`fallbacks` in create/update schemas).
3. `FailoverLlmProvider` + `ConversationRunner` integration (completion, classifier, transformer, filler, moderation).
4. TTS/ASR/storage failover wrappers.
5. Outbound channel fallback (per-request `fallbackChannelProviderId` on the six outbound endpoints — no migration).
6. `fallback_events` endpoint + `provider-chain-exhausted` rule (the 21st default rule; `fallback-active` and `provider-auth-failed` already shipped in Phase 2 — this step verifies their per-provider scoping against real failover data and adds chain-naming context to their messages).
- **Tests:** unit (breaker state transitions, resolver chain building, cycle detection), e2e (primary provider mocked to 5xx → conversation completes via fallback, `fallback_events` row + metric present; breaker opens after N failures; exhausted chain → conversation fails with 502-class error and `provider-chain-exhausted` alert).

### Phase 4 — Polish
- Prometheus `/metrics` endpoint + token gate.
- `TelegramNotifier` / `TwilioSmsNotifier` (only if needed for on-call).
- Optional: webhook dead-letter table (`webhook_failures`) + replay endpoint for failed inbound webhooks.
- Console (separate repo) hooks: monitoring page consuming the new endpoints (list endpoints here are designed to be directly consumable).
- Docs + env examples + load sanity check (call-log volume at peak, rollup job cost).

**Rough effort:** Phase 1 ≈ 4–6 dev-days, Phase 2 ≈ 3–4, Phase 3 ≈ 5–7, Phase 4 ≈ 1–2 (excluding Console UI, which is a separate repo).

---

## 5. Risks & trade-offs (and how the design handles them)

| Risk | Mitigation |
|---|---|
| `provider_call_logs` volume (LLM: 1 row per turn × completions+classifiers+transformers) | batched async inserts, `errorText` truncated, 90-day default retention, hourly rollups for stats; table is the one to watch first — retention is configurable |
| LLM probes cost money | probes are globally opt-in/opt-out via `monitoring_config.probeSettings`, cooldown-gated, and skipped when call logs show recent success; default probe = `enumerateModels()` (free on most providers) |
| Mid-stream LLM/ASR/TTS failure can't be retried safely (partial chunks already sent) | documented limitation: failover applies pre-first-chunk; mid-stream failure still ends the turn but now with full history + alerts |
| Failover changes semantics (different model on fallback) | `fallbacks[].settings` allows per-fallback model override; fallback is only used when the primary is failing — the alternative is a dead conversation |
| Alert noise / flapping | hysteresis (sustained `for`), auto-resolve, cooldowns, per-rule severity, rules individually disable-able |
| Notifier outage hides alerts | alert events are persisted regardless of notification success; notification failures are themselves visible in `alert_events.notifications` |
| New endpoints expand attack surface | RBAC (`system:monitoring`), `/metrics` token-gated, `/health*` stays unauthenticated but read-only and static-ish |
| DB is also the monitoring store — if Postgres dies, monitoring writes fail | call logger keeps a bounded in-memory buffer + pino; `/health/ready` returns 503 (orchestrator sees it); in-memory health snapshot still serves `/api/monitoring/health` from the last good state — and `db-down` is the one alert that fires from the health loop's failure, delivered via a notifier that doesn't need the DB |

## 6. Open questions (need your call)

1. **Notifiers to build first?** Default proposal: webhook + email (reusing existing channel provider). Add Telegram/SMS in phase 4 only if you want on-call pings.
2. **Prometheus endpoint** — include from phase 1 (cheap, ~50 lines) or defer? Proposal: phase 4, but it's trivial to move earlier.
3. **Who gets `system:monitoring`?** super_admin only (proposal) vs also developer.
4. **LLM probe default**: free `enumerateModels()` only (proposal) vs allow paid 1-token probes by default.
5. **Retention defaults**: 90 days call logs (proposal), 90 days health checks, alerts/fallback events kept forever (low volume) — OK?
6. Do you want the **Console UI** for this in scope (separate repo `bonsai-console`), or backend-only for now?

---

## 7. Implementation status & deltas (2026-08-21)

**All four phases are implemented and tested** on branch `advanced-monitoring`
(unit + e2e suites green; spec index: `specs/monitoring/README.md`).
Operator guide: `docs/guide/monitoring.md`; frontend contract:
`docs/guide/monitoring-api.md`. Answers to §6's open questions, as shipped:

1. **Notifiers:** webhook + email first (Phase 2); Telegram, Twilio SMS and
   WhatsApp added in Phase 4 (P4-02), all channel-based ones reusing existing
   channel providers.
2. **Prometheus:** Phase 4 (P4-01), as proposed — `GET /metrics`, token-gated
   via `MONITORING_METRICS_TOKEN`, disabled by default.
3. **RBAC:** `system:monitoring` = **super_admin only** (P2-04).
4. **Probes:** free liveness endpoints only — `enumerateModels()` (or a
   1-token generation where no list endpoint exists), storage `list`, vendor
   `ping()` for ASR/TTS where available (P1-05b); `MONITORING_HEALTH_PROBES=off`
   kill switch; no-cost inference from call logs for vendors without free
   endpoints.
5. **Retention:** 90 d call logs / health checks, 2× for hourly stats,
   `alert_events` / `fallback_events` kept forever — as proposed.
6. **Console UI:** backend-only here; P4-04 ships the endpoint-by-endpoint
   contract doc for the console team.

### Deltas from this proposal

| # | Delta | Reason |
|---|---|---|
| 1 | **Outbound channel fallback (P3-05) — closed, not shipped.** The proposal's failover item included outbound channels (e.g. retry a failed WhatsApp send on Twilio SMS). Implemented once, then **rejected post-implementation**: per-request channel choice belongs to the caller, not the backend. Outbound channel failures are still fully instrumented (call logs + `provider-down`-style alerting on channel providers). | v1 scope decision (2026-08-20) |
| 2 | **Webhook dead-letter queue (P4-03) — closed, not shipped.** The "optional" Phase 4 item was declined: overkill for v1. Failed *inbound* webhook processing still logs + returns 500; failed *outbound alert* webhook deliveries are auditable in `alert_events.notifications` (at-most-once delivery, 15 s cap — deliberately no retry queue in v1). | v1 scope decision (2026-08-20) |
| 3 | **Hybrid call-log schema:** `provider_call_logs` = 16 dense flat columns + one `metrics` jsonb for sparse variant fields (streaming phases, tokens), instead of the proposal's wide flat column set. Cheaper to evolve; same query patterns. | schema refinement during P1-01 |
| 4 | **Channel notifiers consolidated** into one `ChannelNotifier` strategy table (telegram / twilio_sms / whatsapp) instead of three near-identical classes. | P4-02 implementation review |
| 5 | **ASR/TTS provider probes (P1-05b)** — an addition beyond the original probe design: per-type probe policy (`llmProbe` / `asrProbe` / `ttsProbe`) with zero-cost vendor ping endpoints. | spec added 2026-08-19 |
| 6 | **Rule catalog endpoint** `GET /api/monitoring/rules` — addendum so UIs can build from the live rule set instead of hardcoding ids. | addendum during P2-03 |
| 7 | **`GET /health/ready`** (DB-backed readiness probe) + heartbeats for all nine background services — the proposal's health section grew these during P1-05. | P1-05 implementation |
| 8 | **`incrGauge` → `changeGauge`** metric API rename (gauges can go down). | naming fix during P1-02 |
| 9 | **Scale follow-up filed:** at 100× the measured call volume (~39 M rows/day) the hourly rollup exceeds 5 s worst-case → `.issues/medium/provider-call-logs-partitioning.md` (time partitioning + partition-based purge). Below that, the single-table design is verified fine (P4-04 EXPLAIN evidence). | P4-05 load sanity, pre-agreed decision rule |
| 10 | **Notification delivery is at-most-once + audit ledger** (no retry queue) — the proposal's risk table assumed this; it is now an explicit v1 decision with the delivery trail as the audit surface. | reliability review after P2-02 |
| 11 | **Per-check health metrics** — `health_check_status` (gauge, 0=ok/1=degraded/2=down/3=unknown) + `health_check_latency_ms` (histogram) published per cycle by the P1-05 checks. Dashboard/trend surface; the rule engine keeps reading the health snapshot directly. | `specs/health-check-metrics-spec.md` (2026-09-01) |
