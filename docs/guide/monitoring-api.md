# Frontend Monitoring API — Reference

Companion to the P4-04 spec (`.issues/proposal/monitoring/P4-04-console-hooks.md` in the repo root).
Everything the Console "system health" views need to talk to the backend, with
**real** (redacted) response samples captured from a running instance.

The full machine-readable contract is also in OpenAPI at
`GET /openapi.json` (unauthenticated) — this document adds the frontend-facing
context OpenAPI can't express: who may call what, how fresh the data is, how to
poll it, and what the panels map to.

---

## 1. Access & auth

| | |
|---|---|
| **Base path** | `/api/monitoring/*` (13 endpoints) |
| **Auth** | `Authorization: Bearer <accessToken>` — the same JWT as every other API call |
| **Permission** | Every monitoring endpoint requires `system:monitoring` |
| **Effective access** | **`super_admin` only** (P2-04). `content_manager`, `support`, `developer` and `viewer` all get **403** on every monitoring endpoint — including the config read. If Console shows a monitoring section, gate it on the operator having the `super_admin` role. |
| **Rate limit** | Standard API limiter (default 300 req/min per operator). Responses carry draft-7 `RateLimit-*` headers; a 429 carries `Retry-After` in seconds. |
| **Error shape** | `{ "error": "<message>" }` and, for validation failures, `{ "error": "Validation failed", "details": [ { "path": [...], "message": "..." } ] }` |

Status codes you will actually meet: `400` (bad query/body), `401` (missing/invalid
token), `403` (not super_admin), `404` (unknown alert id),
`409` (config version mismatch on PUT).

## 2. Conventions (all list endpoints)

All list endpoints below share the house `ListParams` query contract:

| Param | Notes |
|---|---|
| `offset` | Page start, default `0` |
| `limit` | Page size, default **100**, max **1000** |
| `filters[field]=value` | Bracket notation. Direct value = `eq` |
| `filters[field][op]=<op>&filters[field][value]=<v>` | Ops: `eq, ne, gt, gte, lt, lte, like, in, nin, between`. ISO-8601 date strings are converted for timestamp columns. `in`/`nin` take arrays (`filters[field][value][0]=a&filters[field][value][1]=b`); `between` takes a 2-element array. |
| `textSearch=<q>` | Supported per endpoint (see each section) |
| `orderBy=<field>` or `-<field>` | `-` prefix = descending. Each endpoint documents its default order |

List response envelope (where applicable):

```json
{ "items": [ ... ], "total": 1234, "offset": 0, "limit": 100 }
```

Timestamps are **ISO 8601 UTC**. There is **no** WebSocket/SSE — the UI polls.

## 3. Data freshness

| Data | Source | Max lag behind reality |
|---|---|---|
| `GET /health` | In-memory snapshot, refreshed each health-check cycle | one cycle (default **60 s**, `MONITORING_HEALTH_INTERVAL_MS`; e2e/tests use 1 s) |
| `provider_call_logs` (calls, provider-stats, providers.rolling) | Batched in-memory `CallLogger` → Postgres | **≤ ~5 s** (flush every 5 s or 200 rows) |
| `fallback_events` | Written synchronously at the failover transition | real-time |
| `alert_events` | Alert rule engine tick | one tick (default **1 min**, `monitoring_config.alerting.engineIntervalMinutes`) |
| `metric_samples` (`GET /metrics`) | Batched `MetricsRegistry` → Postgres | **≤ 60 s** |
| `circuitBreaker` (in `/providers`) | In-memory per process | live, but **resets to `closed` on process restart** |

Practical consequence: the "live" panels can poll comfortably at 10–30 s
intervals without hammering the DB — the data underneath only changes at the
cadence above anyway.

---

## 4. Endpoints

### 4.1 `GET /api/monitoring/health`

Current in-memory health snapshot (no pagination).

```json
{
  "checkedAt": "2026-08-21T14:00:31.332Z",
  "checks": [
    {
      "name": "db",
      "status": "ok",
      "latencyMs": 1,
      "detail": { "poolTotal": 7, "poolIdle": 4, "poolWaiting": 0 }
    },
    {
      "name": "process",
      "status": "ok",
      "detail": {
        "uptimeSec": 9,
        "rssBytes": 594976768,
        "heapUsedBytes": 313159288,
        "memoryThresholdBytes": 1610612736,
        "eventLoopLagP95Ms": 20,
        "eventLoopLagMaxMs": 21
      }
    },
    {
      "name": "service_heartbeat:scenario-run-executor",
      "status": "ok",
      "detail": { "ageMs": 2007, "thresholdMs": 90000, "errorCount": 0 }
    },
    {
      "name": "service_heartbeat:imap-inbound",
      "status": "unknown",
      "detail": { "reason": "never ticked" }
    }
  ]
}
```

`status` values: `ok` | `degraded` | `down` | `unknown`. Check names: `db`,
`process`, `service_heartbeat:<name>` (one per background service), and
`provider:<id>` for probed providers. `latencyMs` is `null` for non-latency
checks. `detail` is free-form per check type — render defensively.

### 4.2 `GET /api/monitoring/health/history`

Persisted history (`health_checks`), full `ListParams`. Filterable fields:
`id`, `check` / `checkName`, `status`, `latencyMs`, `createdAt`.
`textSearch` covers `checkName` + `status`. Default order: `createdAt` desc.

```json
{
  "items": [
    {
      "id": "hchk_01a0249f-8d60-73cd-9952-cf57071217f8",
      "checkName": "service_heartbeat:scenario-run-executor",
      "status": "ok",
      "latencyMs": null,
      "detail": { "ageMs": 2009, "errorCount": 0, "thresholdMs": 90000 },
      "createdAt": "2026-08-21T14:00:31.329Z"
    }
  ],
  "total": 27,
  "offset": 0,
  "limit": 1
}
```

Typical usage — sparkline for one check:
`?checkName=db&filters[createdAt][op]=gte&filters[createdAt][value]=<iso>&limit=1000`

### 4.3 `GET /api/monitoring/providers`

One row per **configured provider** (`providers` table — providers with no
config row won't appear even if they have call logs), with probe status, a
**rolling 15-minute** call-log window, and live circuit-breaker state.
No pagination.

```json
{
  "providers": [
    {
      "id": "prov_2xxxxxxxxxxxxxxxxxxxx",
      "name": "Sample LLM A",
      "providerType": "llm",
      "apiType": "openai",
      "probeStatus": "ok",
      "rolling": {
        "windowMinutes": 15,
        "calls": 200,
        "okRate": 0.905,
        "p95DurationMs": 2962.5,
        "topErrorCodes": [["timeout", 19]]
      },
      "circuitBreaker": {
        "state": "closed",
        "failuresInWindow": 0,
        "lastStateChangeAt": "2026-08-21T14:00:00.000Z",
        "opensInLast24h": 0
      }
    }
  ]
}
```

Notes:
- `probeStatus` is `null` until the provider's liveness probe has run at least once.
- `circuitBreaker` is `null` when the provider has no recorded calls in this process's lifetime (state is in-memory; a restart resets it to `closed`).
- `topErrorCodes` is an array of `[code, count]` pairs.

### 4.4 `GET /api/monitoring/provider-calls`

Raw call log (`provider_call_logs`), full `ListParams`. Filterable fields:
`id, providerId, providerType, apiType, operation, model, projectId,
conversationId, ok, errorCode, statusHttp, durationMs, createdAt` (plus
`fallbackProviderId`). `textSearch` covers `operation` + `model` +
`providerId` + `conversationId`. Default order: `createdAt` desc.

```json
{
  "items": [
    {
      "id": "call_xxxxxxxxxxxxxxxxxxxxxxxx",
      "providerId": "prov_2xxxxxxxxxxxxxxxxxxxx",
      "providerType": "llm",
      "apiType": "openai",
      "operation": "llm.generate",
      "model": "gpt-sample",
      "projectId": "proj_2xxxxxxxxxxxxxxxxxxxx",
      "conversationId": null,
      "ok": false,
      "errorCode": "timeout",
      "statusHttp": 504,
      "durationMs": 120,
      "errorText": null,
      "fallbackProviderId": null,
      "metrics": { "ttftMs": 110, "maxChunkGapMs": 0 },
      "createdAt": "2026-08-21T14:00:29.737Z"
    }
  ],
  "total": 200,
  "offset": 0,
  "limit": 2
}
```

Notes:
- `metrics` is free-form per operation type (jsonb). Known keys: LLM streaming → `ttftMs`, `maxChunkGapMs`; TTS → `audioDurationMs`. Treat unknown keys as opaque.
- `fallbackProviderId` is set when the call was **served by a fallback provider**: `providerId` is the provider that actually served the call, `fallbackProviderId` is the primary that failed (the inverse of `fallback_events`, where `providerId` is the failed primary — see P3-04). Do not mix the two conventions in dashboards.
- `errorText` is a truncated error message (only on failures).
- The `errorCode` vocabulary is the house classification (`THIRD_PARTY_ERROR_CODES`): `auth`, `client_error`, `rate_limited`, `timeout`, `network`, `server_error`, `unknown`.

### 4.5 `GET /api/monitoring/fallback-events`

Failover transitions (`fallback_events`), full `ListParams`. Filterable fields:
`id, providerId, fallbackProviderId, providerType, operation, reason, projectId,
conversationId, success, createdAt`. Default order: `createdAt` desc.
**No** `textSearch` on this endpoint.

```json
{
  "items": [
    {
      "id": "fallback_xxxxxxxxxxxxxxxxxxxxxxxx",
      "providerId": "prov_2xxxxxxxxxxxxxxxxxxxx",
      "fallbackProviderId": "prov_2xxxxxxxxxxxxxxxxxxxx",
      "providerType": "llm",
      "operation": "llm.generate",
      "reason": "timeout",
      "projectId": null,
      "conversationId": null,
      "success": true,
      "createdAt": "2026-08-21T13:55:29.737Z"
    }
  ],
  "total": 1,
  "offset": 0,
  "limit": 1
}
```

Semantics: `providerId` = the **primary** that failed, `fallbackProviderId` =
the provider that took over, `reason` = classification of the primary's
failure, `success` = whether the fallback call itself succeeded. Skipped
(circuit-open) chain steps do **not** produce rows; only actual transitions do.

### 4.6 `GET /api/monitoring/provider-stats`

Bucketed aggregates over `provider_call_logs` — the heavy endpoint. Query
params (not `ListParams`):

| Param | Notes |
|---|---|
| `from` / `to` | **Required.** ISO 8601. `from` inclusive, `to` exclusive. Max span **14 days** (`400` beyond) |
| `groupBy` | `hour` (default) or `day` |
| `providerId` | Optional — one provider |
| `operation` | Optional — one operation (e.g. `llm.generate`) |

```json
{
  "from": "2026-08-21T13:45:32.291Z",
  "to": "2026-08-21T14:00:32.381Z",
  "groupBy": "hour",
  "buckets": [
    {
      "bucket": "2026-08-21T13:00:00.000Z",
      "providerId": "prov_2xxxxxxxxxxxxxxxxxxxx",
      "operation": "llm.generate",
      "count": 60,
      "sumDurationMs": 97386,
      "minDurationMs": 210,
      "maxDurationMs": 3096,
      "p50TtftMs": 818,
      "p95TtftMs": 1526.6,
      "p99TtftMs": 1580.3,
      "p95MaxChunkGapMs": 4161.3,
      "stalledCount": 0,
      "rtfOver1Count": 0
    }
  ]
}
```

Notes:
- One row per `(bucket, providerId, operation)`. `bucket` snaps to top of hour/day (UTC).
- `p50TtftMs` / `p95TtftMs` / `p99TtftMs` / `p95MaxChunkGapMs` are `null` for operations without that metric (TTS/ASR have no TTFT).
- `stalledCount` = streamed calls with a max chunk gap > 10 s.
- `rtfOver1Count` = TTS calls that took longer than the audio they produced (real-time factor > 1).
- Percentiles use `percentile_cont` (interpolated — expect floats).
- **Do not poll with wide windows.** A 15-minute `hour`-grouped window is sub-millisecond; a 24-hour `day` window is a table scan over the window (see §6). For sparklines use `GET /metrics` instead — it reads the pre-aggregated `metric_samples` table and is ~100× cheaper.

### 4.7 `GET /api/monitoring/metrics`

Generic time-series over the pre-aggregated `metric_samples` table. Query
params:

| Param | Notes |
|---|---|
| `name` | **Required.** Registered metric name, e.g. `provider_calls_total`, `api_requests_total`, `auth_attempts_total` |
| `from` / `to` | **Required.** ISO 8601, same semantics as provider-stats |
| `step` | `1m` | `15m` (default) | `1h` |
| `labels[k]=v` | Optional — exact label-set match (all provided labels must match; e.g. `labels[provider_id]=prov_2x&labels[ok]=true`) |

```json
{
  "name": "provider_calls_total",
  "from": "2026-08-21T13:47:06.524Z",
  "to": "2026-08-21T14:02:06.611Z",
  "step": "1m",
  "series": [
    {
      "labels": { "ok": "true", "provider_id": "prov_2xxxxxxxxxxxxxxxxxxxx" },
      "points": [
        { "bucket": "2026-08-21T13:48:00.000Z", "count": 7, "sum": 7, "min": null, "max": null },
        { "bucket": "2026-08-21T13:49:00.000Z", "count": 6, "sum": 6, "min": null, "max": null }
      ]
    },
    {
      "labels": { "ok": "false", "provider_id": "prov_2xxxxxxxxxxxxxxxxxxxx" },
      "points": [
        { "bucket": "2026-08-21T13:52:00.000Z", "count": 3, "sum": 3, "min": null, "max": null }
      ]
    }
  ]
}
```

Notes:
- Multiple label sets come back as separate `series` entries — fan a chart per series.
- Points with no activity in a bucket are simply absent (no zero-fill) — fill gaps client-side.
- `min`/`max` are `null` for pure counters.
- Unknown `name` (or a `labels` set with no data) → `200` with an empty `series` array — no existence check.
- Window span is capped server-side at **14 days** for both this endpoint and
  `provider-stats` — `400` ("Window too large") beyond that, and `to` must be
  after `from`.
- Data lags ≤ 60 s (§3).

### 4.8 `GET /api/monitoring/alerts`

Alert history (`alert_events`), full `ListParams`. Filterable fields:
`id, ruleId, scopeKey, severity, status, firedAt, resolvedAt, ackedAt`.
`textSearch` covers `message` + `scopeKey` + `ruleId`. Default order: `firedAt` desc.

`severity` ∈ `info` | `warning` | `critical` — `status` ∈ `firing` | `resolved`.

```json
{
  "items": [
    {
      "id": "alrt_01a024a0-fa3e-759c-8576-48aa36b0421e",
      "ruleId": "provider-down",
      "scopeKey": "provider-down:prov_2xxxxxxxxxxxxxxxxxxxx",
      "scope": { "providerId": "prov_2xxxxxxxxxxxxxxxxxxxx" },
      "severity": "critical",
      "status": "firing",
      "message": "Provider prov_2xxxxxxxxxxxxxxxxxxxx is down (error rate 100% in 10m window)",
      "context": { "samples": 12, "errorRate": 1 },
      "notifications": [
        { "notifierId": "notifier_xxxxxxxxxxxxxxxx", "phase": "fired", "ok": true, "at": "2026-08-21T13:52:13.960Z" },
        { "notifierId": "notifier_xxxxxxxxxxxxxxxx", "phase": "fired", "ok": false, "detail": "timeout", "at": "2026-08-21T13:52:15.960Z" }
      ],
      "firedAt": "2026-08-21T13:52:03.960Z",
      "resolvedAt": null,
      "ackedAt": null,
      "ackedBy": null
    }
  ],
  "total": 31,
  "offset": 0,
  "limit": 100
}
```

Notes:
- The "active alerts" banner is just this list with `filters[status]=firing`.
- `scope` / `context` are free-form per rule (jsonb) — render defensively.
- `notifications` records every delivery attempt (oldest first); `ok: false` rows carry a `detail`.
- A single rule+scope has at most one `firing` row (anti-flap state machine); history rows accumulate.
- The full rule vocabulary is `GET /api/monitoring/rules` (§4.11).

### 4.9 `GET /api/monitoring/alerts/:id`

One alert, same shape as a list item. Unknown id → `404`.

### 4.10 `POST /api/monitoring/alerts/:id/acknowledge`

No body. Returns the updated alert row (200) with `ackedAt` set to now and
`ackedBy` set to the calling operator's id. Acknowledging a resolved alert is
allowed (it just stamps it). Unknown id → `404`. This is the only mutating
operation in the UI surface (besides config).

```json
{
  "id": "alert_xxxxxxxxxxxxxxxxxxxxxxxx",
  "ruleId": "provider-down",
  "status": "firing",
  "severity": "critical",
  "message": "Provider prov_2xxxxxxxxxxxxxxxxxxxx is down (error rate 100% in 10m window)",
  "notifications": [
    { "notifierId": "notifier_xxxxxxxxxxxxxxxx", "phase": "fired", "ok": true, "at": "2026-08-21T13:52:13.960Z" }
  ],
  "firedAt": "2026-08-21T13:52:03.960Z",
  "resolvedAt": null,
  "ackedAt": "2026-08-21T14:02:06.662Z",
  "ackedBy": "operator@example.com"
}
```

### 4.11 `GET /api/monitoring/rules`

The static rule catalog (21 rules) — use it to **drive the config editor**
instead of hardcoding rule ids. Standard auth, no params, no pagination.

```json
{
  "rules": [
    {
      "id": "provider-down",
      "scope": "per_provider",
      "severity": "critical",
      "summary": "Provider appears down: 100% of its calls failed in the window (≥ minSamples), or its circuit breaker is OPEN, or ≥ threshold (default 3) consecutive health-probe failures.",
      "defaultParams": {
        "threshold": 3,
        "windowMinutes": 10,
        "minSamples": 5,
        "forMinutes": 2,
        "resolveAfterGoodChecks": 2,
        "cooldownMinutes": 15,
        "maxUnresolvedHours": 6
      }
    },
    {
      "id": "stream-slow-ttft",
      "scope": "per_provider",
      "severity": "warning",
      "summary": "Streaming time-to-first-token p95 exceeds the threshold (default 10 s; TTS fixed at 3 s) over ≥ minSamples streaming calls in the window.",
      "defaultParams": {
        "threshold": 10000,
        "windowMinutes": 10,
        "minSamples": 10,
        "forMinutes": 2,
        "resolveAfterGoodChecks": 2,
        "cooldownMinutes": 15,
        "maxUnresolvedHours": 6
      }
    }
  ]
}
```

The 21 rule ids: `db-down`, `service-stalled`, `db-pool-saturated`,
`provider-down`, `provider-degraded`, `provider-rate-limited`,
`provider-auth-failed`, `api-5xx-spike`, `api-429-spike`, `auth-429-spike`,
`oauth-refresh-failing`, `imap-poll-failing`, `high-memory`, `event-loop-lag`,
`fallback-active`, `provider-chain-exhausted`, `stream-slow-ttft`,
`stream-stalls`, `stream-abort-rate`, `tts-rtf-degraded`, `asr-final-latency`.

`scope` is `global` or `per_provider` (per-provider rules auto-evaluate for
every provider — no per-provider config needed). `defaultParams` is the
fallback applied when the config has no override for that rule.

### 4.12 `GET /api/monitoring/config`

```json
{
  "config": {
    "notifiers": [],
    "rules": {},
    "retentionDays": 90,
    "probeSettings": { "llmProbe": "models", "asrProbe": "free", "ttsProbe": "free", "cooldownMinutes": 10 },
    "alerting": { "engineIntervalMinutes": 1, "defaultCooldownMinutes": 15 },
    "circuitBreaker": { "failureThreshold": 5, "windowMs": 60000, "cooldownMs": 300000 }
  },
  "version": 1,
  "updatedAt": "2026-08-21T14:00:29.392Z"
}
```

- `notifiers`: a flat array (one schema, required fields depend on `type`):
  - `id` (string, required) and `enabled` (boolean, required — `false` skips the notifier).
  - `type`: `webhook` | `email` | `telegram` | `twilio_sms` | `whatsapp`.
  - `webhook` → `url` (http(s)).
  - `email` → `channelProviderId` + `to` (email address).
  - `telegram` → `channelProviderId` + `chatId`.
  - `twilio_sms` / `whatsapp` → `channelProviderId` + `to` (E.164 phone number).
  - `minSeverity` (optional: `info` | `warning` | `critical`) — only deliver alerts at or above this severity.
- `rules`: **flat** map of rule id → override object (only the params you want to change; e.g. `{ "provider-down": { "minSamples": 10, "cooldownMinutes": 30 } }`). Unknown rule ids are rejected with `400` (not silently ignored).
- `version` is **outside** `config` — the row-level optimistic-lock counter.

### 4.13 `PUT /api/monitoring/config`

**Full replacement** — no partial updates. Body:

```json
{
  "version": 1,
  "config": { "...": "the complete next config object, exactly as in §4.12" }
}
```

- `version` must equal the current row version (from GET) → **`409`** on
  mismatch. Refetch and re-apply on 409.
- `400` on any schema violation (including unknown rule ids in `rules`).
- Returns 200 with the same `{ config, version, updatedAt }` shape; `version`
  is incremented.
- The engine picks up changes on its next tick (≤ 1 min) — no restart.
- The PUT replaces the whole config verbatim — send back every notifier you
  want to keep, unchanged, or it is gone.

### 4.14 `POST /api/providers/test-connection` (cross-reference)

Not a `/api/monitoring/*` endpoint — it lives under `/api/providers` and
requires **`provider:read`** (not `system:monitoring`). It is documented here
because it is the source of the `provider_call_logs` rows the panels above
consume, and it is the UI's "Test connection" action.

**Saved XOR draft** body (exactly one mode, else `400`):

```json
// saved — `voice` is required for ElevenLabs TTS (no safe default voice); other TTS providers default it
{ "providerId": "prov_...", "model": "optional", "voice": "optional (required for ElevenLabs TTS)", "write": true, "bucket": "optional" }

// draft — config validated by the same per-apiType schema as the create endpoint
{ "providerType": "llm", "apiType": "openai", "config": { "apiKey": "...", "baseUrl": "..." }, "model": "required-for-llm" }
```

**Always `200` on a vendor failure** — the body is the structured result the
Console renders:

```json
{
  "ok": false,
  "providerType": "llm",
  "apiType": "openai",
  "protocol": "http",
  "phase": "first-data",
  "latencyMs": 812,
  "errorCode": "auth",
  "errorText": "OpenAI 401: invalid api key (redacted)",
  "detail": { "model": "gpt-4o-mini" }
}
```

`protocol` reflects the transport the test used: `http`, `websocket`, `sdk`,
`local-fs`, or `smtp`. For a **channel** provider it is `http` (Telegram,
Twilio Messaging/Voice, WhatsApp, SendGrid), `sdk` (SES), or `smtp`
(SMTP-IMAP); channel checks are a per-`apiType` sub-strategy table (channels
are config schemas, not provider classes) and always `phase: "auth"`.

Only guard errors are non-200: `400` (bad payload / draft LLM without
`model` / ElevenLabs TTS without `voice` — no safe default voice / unsupported
type), `401/403` (RBAC — `provider:read`), `404` (saved provider not found),
`429` (5 s per-provider cooldown — `Retry-After` in seconds).

Monitoring interplay: a **saved** test writes an ordinary
`provider_call_logs` row (`operation '<type>.test'`) that feeds the
`provider-auth-failed` last-signal branch (a failed auth test keeps the alert
firing) but is **excluded from the circuit breaker**. A **draft** test leaves
zero rows. Saved tests write a `CONNECTION_TEST` audit row; drafts write none.
See [On-demand connection tests](./monitoring.md#on-demand-connection-tests).

---

## 5. Panel → endpoint mapping (P4-04)

| Panel | Endpoint(s) | Suggested poll |
|---|---|---|
| 1. System status (DB / process / services / providers) | `GET /health` (+ `GET /providers` for per-provider probe + breaker + rolling window) | 15–30 s (data cadence is 60 s in prod) |
| 2. Alerts (active banner + history) | `GET /alerts?filters[status]=firing` (banner) · `GET /alerts` (history, with `severity`/`ruleId` filters + `textSearch`) · `POST /alerts/:id/acknowledge` (action) · `GET /rules` (once, cache) | 30 s (engine tick is 1 min) |
| 3. Providers (per-provider detail) | `GET /providers` · `GET /provider-calls?filters[providerId]=...` · `GET /provider-stats?providerId=...&from=...&to=...` | 30 s; stats on demand only |
| 4. Streaming quality (TTFT / stalls / TTS RTF) | `GET /provider-stats` (TTFT p50/p95/p99, `stalledCount`, `rtfOver1Count`) · `GET /metrics?name=provider_calls_total&step=1m` for volume context | on demand; 15-min default window |
| 5. Fallbacks & circuit breakers | `GET /fallback-events` · `GET /providers` (`circuitBreaker` field) · `GET /alerts?filters[ruleId]=fallback-active` / `provider-chain-exhausted` | 30 s |

The alert *delivery* audit (did Telegram/Twilio/whatsapp/webhook actually
deliver) is inside each alert's `notifications` array — no separate endpoint.

## 6. Performance & index evidence

Query plans were measured on an ephemeral Postgres 16 testcontainer with
3,000 `provider_call_logs` rows (3 h), 30 alerts, 50 fallback events,
100 health checks, 120 metric samples, after `ANALYZE`:

| Query (endpoint) | Plan | Time |
|---|---|---|
| `provider-calls` per-provider 15-min window + `COUNT` | Bitmap Index Scan `idx_provider_call_logs_provider_created` | 0.11 ms / 0.09 ms |
| `provider-calls` 1-h window, newest 50 | Index Scan Backward `idx_provider_call_logs_created_at` | 0.06 ms |
| `alerts` firing, newest 100 | (Seq Scan at fixture scale; `idx_alert_events_fired_at` takes over at scale) | 0.03 ms |
| `fallback-events` newest 100 | (Seq Scan at fixture scale; `idx_fallback_events_created_at` covers it) | 0.03 ms |
| `health/history` per-check 1-h window | (Seq Scan at fixture scale; `idx_health_checks_check_created` covers it) | 0.03 ms |
| `metrics` name + window | (Seq Scan at fixture scale; `idx_metric_samples_name_bucket` covers it) | 0.08 ms |
| `provider-stats` 15-min `hour` window | Bitmap Index Scan `idx_provider_call_logs_created_at` | 0.73 ms |
| `provider-stats` 15-min, per-provider | Bitmap Index Scan `idx_provider_call_logs_provider_created` | 0.40 ms |
| `provider-stats` **24 h `day` window (worst case)** | Seq Scan over the window | **4.4 ms at 3k rows** |

Guidance for the UI:
- The seq scans above are a fixture artifact (Postgres correctly seq-scans
  tiny tables); every access pattern has a matching index (verified in
  `drizzle/0068_lively_rage.sql` + `0068_normal_hellcat.sql`).
- All 15-minute-window queries are sub-millisecond. Keep the default
  dashboard windows at **15 minutes**; treat 24-hour views as an explicit
  user action, not a poll.
- Retention (`monitoring_config.retentionDays`, default 90 d, hourly purge)
  bounds `provider_call_logs` growth, so worst-case query cost stays
  linear in window size, not table age.
- For anything "last N minutes" that refreshes often, prefer `GET /metrics`
  (pre-aggregated) over `GET /provider-stats` (re-aggregated per request).

## 7. Out of scope for the UI

- **`GET /metrics` (Prometheus exposition, P4-01)** — a root-level text
  format for Prometheus/Grafana scrapers. **Disabled by default**: 404 unless
  `MONITORING_METRICS_TOKEN` is set; then gated by
  `Authorization: Bearer <that token>` (401 on mismatch). It is registered
  before the auth/rate-limit middleware (like `/health`) and is **not** an API
  route — do not confuse it with the JSON time-series endpoint
  `GET /api/monitoring/metrics` in §4.7.
- **Live process gauges** (RSS, event-loop lag, pool) beyond what
  `GET /health` exposes — scrape `GET /metrics` instead.
- **Streaming push** — there is no WebSocket/SSE channel for monitoring
  data; polling is the designed pattern (§3 cadences make it cheap).
- **Per-project scoping** — monitoring is a system-level surface; provider
  rows carry `projectId` for correlation, but there is no project-scoped
  monitoring API.
