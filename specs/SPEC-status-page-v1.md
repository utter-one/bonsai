# Spec: Status Page — v1 (Current State Endpoint)

Status: **spec** (ready for implementation)
Scope: Bonsai backend — one new read-only REST endpoint aggregating `health_checks` + `providers`
Date: 2026-07-08
Related: `PROPOSAL-production-monitoring.md` (data sources), `src/services/monitoring/` (existing module)

---

## 1. Context & goal

Bonsai Console has a System Health page that will be replaced by a **Status page** showing the
current state of the deployment: core system checks, background services, and every configured
provider — per industry status-page convention (component grid + overall banner).

v1 answers exactly one question: **"What is the state of everything, right now, and over the
last hour?"** — answered from data the backend already persists. The Console renders the page;
the backend serves JSON.

### Fixed decisions (from design discussion)

| # | Decision | Value |
|---|---|---|
| 1 | Visibility | Private — JWT auth, `system:monitoring` permission. No public endpoint in v1. |
| 2 | Renderer | Bonsai Console. Backend serves JSON only (no HTML). |
| 3 | Granularity | One row per **configured provider** (`providers` table drives the list). |
| 4 | Incidents | **Not in v1.** No incident model, no alerts on the page, no timeline. |
| 5 | Data source | **`health_checks` only** (+ `providers` for metadata). No call logs, no circuit breakers, no fallback events, no alert events in v1. |
| 6 | Latency percentiles | **No `p95LatencyMs`** in the availability series — probe latency (db ping, liveness `ping()`) is not user-traffic latency and percentiles are not recombinable across buckets. Real latency percentiles already live in `provider_call_stats_hourly` (call-quality series, existing). The single latest `latencyMs` per row IS kept (freshness tooltip, straight off the raw row). |
| 7 | Schema changes | **None.** v1 is pure read aggregation over existing tables. (The hourly rollup is v2, §9.) |
| 8 | Caching | None in v1. The endpoint is polled by the Console (~30 s); the queries are indexed range scans over a few hundred rows. Revisit only if profiling says so. |

## 2. Scope

### In scope (v1)

- `GET /api/monitoring/status` — current status per check/provider + 1-hour (configurable) status-count window + overall banner status.
- `StatusPageService` + `StatusPageController` + Zod/OpenAPI contracts + e2e tests.

### Out of scope (tracked, not built)

- **v2** — historical buckets: `health_check_stats_hourly` rollup table (counts only, per §9), `RetentionService` rollup + purge with independent 90-day retention, `GET /api/monitoring/status/history`.
- **v3** — incidents (lifecycle, timeline, manual/maintenance), 90-day uptime table (derived from v2 rollups), call-quality history endpoint over `provider_call_stats_hourly`, feeds (JSON/RSS), public exposure.

## 3. Data sources

| Source | Used for | Notes |
|---|---|---|
| `health_checks` (raw 60 s rows, `HealthCheckService`) | Current status, window aggregation | Check names: `db`, `process`, `service_heartbeat:<name>`, `provider:<id>`. Status: `ok \| degraded \| down \| unknown`. Index `idx_health_checks_check_created (check_name, created_at)` covers both queries. |
| `providers` | Provider row identity: `id`, `name`, `provider_type`, `api_type` | Drives `providers[]` (left-join semantics). Small table, read in full. |
| `KNOWN_SERVICE_HEARTBEATS` (`HealthCheckService`) | Label map only | `conversation-timeout`, `processing-deferral`, `scenario-run-executor`, `benchmark-executor`, `imap-inbound`, `oauth2-token-refresh`, `health-checks`. |

The endpoint is **DB-backed** (not the in-memory `HealthCheckService.getSnapshot()`): it survives
restarts, it is the same source as the window aggregation, and fixtures are trivial in e2e.
The existing `GET /api/monitoring/health` (in-memory snapshot) is untouched.

## 4. Status model

### 4.1 Status values

`ok | degraded | down | unknown` — the existing `health_checks.status` vocabulary, no new levels.

### 4.2 Severity ordering

`down > degraded > ok`. **`unknown` is neutral** — it is never the "worst" of anything unless
nothing else exists.

### 4.3 "Worst non-unknown" rule (applies to `overall` and `window.worstStatus`)

> The worst non-unknown status in the set (`down > degraded > ok`). Unknown entries are
> ignored so a healthy system with not-yet-known checks still reports `ok`; `unknown`
> only when the set is empty or all-unknown.

This is the **exact semantics already documented** on `healthSnapshotResponseSchema.overall`
in `src/http/contracts/monitoring.ts` — reuse the wording, reuse the behavior.

- `overall`: computed over the `status` of every entry in `checks[]` **and** `providers[]`.
- `window.worstStatus`: computed over the window's non-unknown **row counts** (`down > 0 → down`,
  else `degraded > 0 → degraded`, else `ok > 0 → ok`, else `unknown`). An empty window (total = 0)
  yields `unknown`.

## 5. Endpoint

### 5.1 Signature

```
GET /api/monitoring/status?windowMinutes=60&days=14
```

### 5.2 Query parameters

| Param | Type | Default | Validation | Notes |
|---|---|---|---|---|
| `windowMinutes` | int | `60` | `min 5`, `max 1440` | Out-of-range or non-numeric → **400** (Zod). The *applied* value (after default) is echoed in the response. |
| `days` | int | *(absent)* | `min 1`, `max 90` | Optional. When set, the response includes `daily` — per-UTC-day aggregates for the last N days (today + the preceding N-1 days). Out-of-range or non-numeric → **400**. Absent → no `daily` key (base payload stays lean for the 30 s poll). |

Parsed with a Zod schema against `req.query` (`z.coerce.number().int().min(5).max(1440).default(60)`),
consistent with how `MonitoringController` parses query params.

### 5.3 Auth & permissions

- JWT required (standard middleware chain; the route registers with the controllers, after
  `optionalAuthMiddleware` + rate limiter — no special placement).
- `PERMISSIONS.SYSTEM_MONITORING` (`'system:monitoring'`) enforced at **both** layers
  (defense in depth, house convention):
  - controller: `checkPermissions(req, [PERMISSIONS.SYSTEM_MONITORING])`
  - service: `this.requirePermission(context, PERMISSIONS.SYSTEM_MONITORING)`
- 401 unauthenticated, 403 without permission, 400 invalid query, 500 unexpected.

### 5.4 Response contract (Zod)

New file `src/http/contracts/statusPage.ts`. The shared status enum is **extracted** from
`monitoring.ts` (currently inlined twice in `healthCheckItemSchema.status` and
`healthSnapshotResponseSchema.overall`) into one exported schema and reused by both files —
small refactor, no behavior change:

```ts
// monitoring.ts (extracted, reused by existing schemas)
export const healthCheckStatusSchema = z
  .enum(['ok', 'degraded', 'down', 'unknown'])
  .openapi('HealthCheckStatus')
  .describe('Check status');
```

```ts
// statusPage.ts
import { providerTypeSchema } from './provider';
import { healthCheckStatusSchema } from './monitoring';

/** Aggregated status counts for one check over the request window. Always present —
 *  a check with no rows in the window is an all-zero window with worstStatus 'unknown'. */
export const statusWindowSchema = z
  .object({
    total: z.number().int().min(0).describe('Number of health_checks rows for this check in the window'),
    ok: z.number().int().min(0).describe('Rows with status ok'),
    degraded: z.number().int().min(0).describe('Rows with status degraded'),
    down: z.number().int().min(0).describe('Rows with status down'),
    unknown: z.number().int().min(0).describe('Rows with status unknown'),
    worstStatus: healthCheckStatusSchema
      .describe('Worst non-unknown status among window rows (down > degraded > ok); unknown when the window has no non-unknown rows'),
  })
  .openapi('StatusWindow')
  .describe('Windowed status aggregation for one check');

export const statusCheckGroupSchema = z
  .enum(['core', 'service', 'other'])
  .openapi('StatusCheckGroup')
  .describe("'core' = db/process, 'service' = service_heartbeat:*, 'other' = any future check type");

export const statusCheckSchema = z
  .object({
    name: z.string().describe('Raw check name (db, process, service_heartbeat:<name>)'),
    label: z.string().describe('Display label (see label map)'),
    group: statusCheckGroupSchema,
    status: healthCheckStatusSchema.describe('Latest check status; unknown when the check has never run'),
    latencyMs: z.number().int().nullable().describe('Latest check duration in ms, when measured'),
    detail: z.record(z.string(), z.unknown()).nullable().describe('Latest check detail payload (raw jsonb passthrough)'),
    checkedAt: z.coerce.date().nullable().describe('When the latest check ran; null when the check has never run'),
    window: statusWindowSchema,
  })
  .openapi('StatusCheck')
  .describe('Current state of one system/background-service check');

export const statusProviderSchema = z
  .object({
    id: z.string().describe('Provider id'),
    name: z.string().describe('Provider display name'),
    providerType: providerTypeSchema.describe('Provider category: asr, tts, llm, embeddings, storage, channel'),
    apiType: z.string().describe('API vendor (openai, azure, elevenlabs, …)'),
    status: healthCheckStatusSchema.describe('Latest provider:<id> check status; unknown when the provider has never been checked'),
    latencyMs: z.number().int().nullable().describe('Latest probe duration in ms, when measured'),
    detail: z.record(z.string(), z.unknown()).nullable().describe('Latest probe detail payload (raw jsonb passthrough)'),
    checkedAt: z.coerce.date().nullable().describe('When the latest probe ran; null when never checked'),
    window: statusWindowSchema,
  })
  .openapi('StatusProvider')
  .describe('Current state of one configured provider');

export const statusPageQuerySchema = z.object({
  windowMinutes: z.coerce.number().int().min(5).max(1440).default(60)
    .describe('Window for status-count aggregation in minutes (default 60)'),
});

export const statusPageResponseSchema = z
  .object({
    generatedAt: z.coerce.date().describe('Server time when the response was built'),
    windowMinutes: z.number().int().min(5).max(1440).describe('Applied window (defaulted)'),
    overall: healthCheckStatusSchema
      .describe('Global status: the worst non-unknown status across all checks and providers (down > degraded > ok). Unknown entries are ignored so a healthy system with not-yet-known checks still reports ok; unknown only when there are no entries or all are unknown'),
    checks: z.array(statusCheckSchema).describe('Core + background-service checks (never provider:*)'),
    providers: z.array(statusProviderSchema).describe('One entry per row in the providers table'),
  })
  .openapi('StatusPageResponse')
  .describe('Current status-page payload');

export type StatusPageQuery = z.infer<typeof statusPageQuerySchema>;
export type StatusPageResponse = z.infer<typeof statusPageResponseSchema>;
```

### 5.5 Response example

```json
{
  "generatedAt": "2026-07-08T12:00:00.000Z",
  "windowMinutes": 60,
  "overall": "degraded",
  "checks": [
    {
      "name": "db",
      "label": "Database",
      "group": "core",
      "status": "ok",
      "latencyMs": 3,
      "detail": { "poolTotal": 10, "poolIdle": 8, "poolWaiting": 0 },
      "checkedAt": "2026-07-08T11:59:41.000Z",
      "window": { "total": 60, "ok": 58, "degraded": 2, "down": 0, "unknown": 0, "worstStatus": "degraded" }
    },
    {
      "name": "process",
      "label": "Application",
      "group": "core",
      "status": "ok",
      "latencyMs": null,
      "detail": null,
      "checkedAt": "2026-07-08T11:59:41.000Z",
      "window": { "total": 60, "ok": 60, "degraded": 0, "down": 0, "unknown": 0, "worstStatus": "ok" }
    },
    {
      "name": "service_heartbeat:scenario-run-executor",
      "label": "Scenario Run Executor",
      "group": "service",
      "status": "ok",
      "latencyMs": null,
      "detail": null,
      "checkedAt": "2026-07-08T11:59:41.000Z",
      "window": { "total": 60, "ok": 60, "degraded": 0, "down": 0, "unknown": 0, "worstStatus": "ok" }
    }
  ],
  "providers": [
    {
      "id": "prov_123",
      "name": "OpenAI (primary)",
      "providerType": "llm",
      "apiType": "openai",
      "status": "down",
      "latencyMs": 210,
      "detail": { "error": "ECONNREFUSED" },
      "checkedAt": "2026-07-08T11:59:41.000Z",
      "window": { "total": 60, "ok": 47, "degraded": 0, "down": 13, "unknown": 0, "worstStatus": "down" }
    },
    {
      "id": "prov_456",
      "name": "Local Whisper",
      "providerType": "asr",
      "apiType": "local",
      "status": "unknown",
      "latencyMs": null,
      "detail": null,
      "checkedAt": null,
      "window": { "total": 0, "ok": 0, "degraded": 0, "down": 0, "unknown": 0, "worstStatus": "unknown" }
    }
  ]
}
```

### 5.6 Field semantics & ordering

- **`checks[]`** — one entry per distinct `check_name` seen in `health_checks`, excluding
  `provider:*` rows. `group`: `db`/`process` → `core`; `service_heartbeat:*` → `service`;
  anything else → `other` (forward compatibility). **Order: all `core` first, then `service`,
  then `other`, each group sorted by `name` ascending.**
- **`providers[]`** — one entry per row in `providers`, **sorted by `name` ascending
  (case-insensitive), `id` as tiebreaker.** A provider with no `provider:<id>` health-check
  rows ever → `status: 'unknown'`, `latencyMs/detail/checkedAt: null`, zero window.
- **Orphan checks** — a `provider:<id>` row whose id no longer exists in `providers` is
  **dropped** (the providers table drives the join, not the other way round).
- **`window`** — always present (never null). Counts rows with
  `created_at >= now() - windowMinutes` for that exact `check_name`.
- **`detail`** — raw jsonb passthrough of the latest row. Private endpoint; no redaction in v1.

### 5.7 Label map

| Check name | Label |
|---|---|
| `db` | `Database` |
| `process` | `Application` |
| `service_heartbeat:conversation-timeout` | `Conversation Timeout Service` |
| `service_heartbeat:processing-deferral` | `Processing Deferral Service` |
| `service_heartbeat:scenario-run-executor` | `Scenario Run Executor` |
| `service_heartbeat:benchmark-executor` | `Benchmark Executor` |
| `service_heartbeat:imap-inbound` | `IMAP Inbound` |
| `service_heartbeat:oauth2-token-refresh` | `OAuth2 Token Refresh` |
| `service_heartbeat:health-checks` | `Health Checks` |
| `service_heartbeat:<other>` | title-cased suffix (e.g. `foo-bar-baz` → `Foo Bar Baz`) |
| `provider:<id>` | the provider's `name` (join) |
| anything else | the raw check name |

The static map lives in `StatusPageService` and covers the `KNOWN_SERVICE_HEARTBEATS` list;
unknown future names fall back per the table (the endpoint must never fail on an unrecognized
check name).

### 5.8 Daily aggregates (`?days=N`) — v1.1

Per-UTC-day aggregates across **all** checks and providers (global strip, not per-entry —
per-entry history is the v2 rollup endpoint). When `days` is provided the response gains:

```jsonc
"daily": [                                   // exactly N buckets, oldest first, today (UTC) last
  {
    "date": "2026-07-09",                    // YYYY-MM-DD, UTC calendar day
    "total": 1440,                           // health_checks rows on that day (all checks + providers)
    "ok": 1400, "degraded": 40, "down": 0, "unknown": 0,
    "status": "degraded",                    // worst non-unknown across the day's rows; unknown when no non-unknown rows
    "uptimePct": 97.22                       // STRICT: ok / (total - unknown) * 100, 2 decimals; null when no non-unknown rows
  }
]
```

- **Buckets are always complete** — zero-filled via a `generate_series` LEFT JOIN (a day with
  no rows is `{total: 0, ..., status: 'unknown', uptimePct: null}`), so the Console can render
  N cells unconditionally.
- **All day math runs in Postgres on the DB clock** (`date_trunc('day', now())`, the same clock
  that stamped the rows); dates come back as `to_char(…, 'YYYY-MM-DD')` strings so pg's
  local-timezone DATE parsing is never involved.
- **`uptimePct` is strict**: degraded and down count as non-uptime; `unknown` rows are excluded
  from the denominator (unmeasured checks must not drag uptime down).
- Computed on the fly from `health_checks` (no rollup — v2 territory). At the 60 s cadence
  that's ~1.4 k rows/day, so 90 days ≈ 130 k rows — a cheap indexed range scan; days beyond
  the configured `retentionDays` simply come back zero-filled.

## 6. Implementation

### 6.1 Files

| File | Change |
|---|---|
| `src/services/monitoring/StatusPageService.ts` | **new** — `@injectable()`, extends `BaseService`. Method: `getStatus(context: RequestContext, windowMinutes?: number): Promise<StatusPageResponse>` (context required, per convention). `requirePermission(context, PERMISSIONS.SYSTEM_MONITORING)` at the top. One-liner pino logs (no `event` field). |
| `src/http/controllers/StatusPageController.ts` | **new** — `@singleton()`. `static getOpenAPIPaths(): RouteConfig[]` (tags `['Monitoring']`, 200/400/401/403 responses, `request.query: statusPageQuerySchema`), `registerRoutes(router: Router)` wiring `GET /api/monitoring/status` via `asyncHandler`. Handler: `checkPermissions(req, [PERMISSIONS.SYSTEM_MONITORING])` → `statusPageQuerySchema.parse(req.query)` → service call → `res.status(200).json(…)`. |
| `src/http/contracts/statusPage.ts` | **new** — schemas from §5.4 (`.describe()` on every field, `.openapi()` on reusable sub-schemas *before* modifiers). |
| `src/http/contracts/monitoring.ts` | **refactor** — extract `healthCheckStatusSchema`, replace the two inlined enums. No response-shape change. |
| `src/server.ts` | **register** `container.resolve(StatusPageController).registerRoutes(app)` with the other controllers. |
| `tests/e2e/status-page.test.ts` | **new** — see §7. |

No changes to `src/db/schema.ts`, `drizzle/`, `RetentionService`, or `monitoring_config`.

### 6.2 Queries (run in parallel, `Promise.all`)

All three are cheap on existing indexes. Timestamps are tz-less `timestamp` columns — pass
boundaries as **ISO strings computed from UTC** (house TZ discipline from `RetentionService`),
never raw `Date` parameters.

```sql
-- Q1: latest row per check name  (index: idx_health_checks_check_created)
SELECT check_name, status, latency_ms, detail, created_at
FROM (
  SELECT DISTINCT ON (check_name) check_name, status, latency_ms, detail, created_at
  FROM health_checks
  ORDER BY check_name, created_at DESC
) latest;

-- Q2: window aggregation  (range scan on the same index; ~checks/min × window rows)
SELECT check_name,
       COUNT(*)::int                                            AS total,
       COUNT(*) FILTER (WHERE status = 'ok')::int               AS ok,
       COUNT(*) FILTER (WHERE status = 'degraded')::int         AS degraded,
       COUNT(*) FILTER (WHERE status = 'down')::int             AS down,
       COUNT(*) FILTER (WHERE status = 'unknown')::int          AS "unknown"
FROM health_checks
WHERE created_at >= $1            -- (now() - windowMinutes) as UTC ISO string
GROUP BY check_name;

-- Q3: provider identity (tiny table)
SELECT id, name, provider_type, api_type FROM providers;
```

Merge in the service:

1. `checks[]` ← Q1 rows where `check_name` ∈ {`db`, `process`} (core) or starts with
   `service_heartbeat:` (service) or anything else (other); each joined with its Q2 row
   (missing Q2 row → zero window).
2. `providers[]` ← Q3 rows (join key `provider:<id>` into Q1 for current status, into Q2 for
   the window); missing Q1 row → `unknown` current; missing Q2 row → zero window.
3. Q1 `provider:*` rows with no Q3 match → discarded.
4. `overall` ← worst non-unknown over all `checks[].status` + `providers[].status` (§4.3).
5. `generatedAt` ← `new Date()` at response build; `windowMinutes` ← applied value.

### 6.3 Performance

- Q1: `DISTINCT ON` over the `(check_name, created_at)` index — one backward index scan per
  check name (~20 names).
- Q2: range scan bounded by the window; 20 checks/min × 60 min = ~1,200 rows worst case;
  1,440 min (max) = ~29k rows — still a single index range scan + hash aggregation.
- Q3: full scan of a small table.
- No caching (decision 8). Expected cost at a 30 s Console poll cadence: negligible.

## 7. E2E test plan (`tests/e2e/status-page.test.ts`)

Conventions: `beforeEach(resetDatabase)`, `authed()`/`unauthed()`, `expect(res.status).to.equal(…)`
style. **Live-loop hazard**: in tests `HealthCheckService` ticks every 1 s and writes real
`db` / `process` / `service_heartbeat:*` rows, and `MONITORING_HEALTH_PROBES=off` means
provider probes never run. Therefore:

- Derivation logic is tested with **fixture check names the live service never writes**
  (e.g. `service_heartbeat:fixture-service`, `provider:<fixture-provider-id>` where the provider
  row is created via the fixture API) — per the existing health-history fixture convention.
- Assertions on live `db`/`process` rows check **shape only** (status ∈ enum, label map,
  group `core`), never exact values.

Cases:

1. **Auth**: unauthenticated → 401; authenticated operator without `system:monitoring` → 403.
2. **Validation**: `windowMinutes=abc` → 400; `windowMinutes=0` → 400; `windowMinutes=10000` → 400;
   `windowMinutes=90` → 200 with `windowMinutes: 90` echoed; omitted → 200 with `windowMinutes: 60`.
3. **Empty deployment**: no providers, no `health_checks` rows seeded → 200, `checks: []`,
   `providers: []`, `overall: 'unknown'`.
4. **Current status mapping**: seed `service_heartbeat:fixture-service` rows (latest `down`) →
   entry has `status: 'down'`, correct `label`, `group: 'service'`, `checkedAt` = latest row's.
5. **Window aggregation**: seed 10 rows for a fixture check within the window (7 ok, 2 degraded,
   1 down) + 5 rows older than the window → `window` reflects only the in-window rows
   (`total: 10`, `worstStatus: 'down'`), counts exact.
6. **Window edge**: check with rows only outside the window → zero window, `worstStatus: 'unknown'`.
7. **Provider join**: create two fixture providers (names `Zeta LLM`, `alpha tts`), seed
   `provider:<idA>` rows (`ok`) but not `<idB>` → `providers[0].name === 'alpha tts'` (sort order),
   provider A `status: 'ok'` with populated `checkedAt`, provider B `status: 'unknown'`,
   `checkedAt: null`, zero window.
8. **Orphan check**: seed `provider:deleted_id` rows (no matching provider) → absent from
   response.
9. **Overall**: all seeded fixture entries `ok` → `overall: 'ok'` even with `unknown` entries
   present; one seeded `down` → `overall: 'down'`; everything `unknown` → `overall: 'unknown'`.
10. **Ordering & grouping**: mixed fixture checks (`service_heartbeat:fixture-*`) → `core`
    entries (live `db`/`process`) first, then services sorted by name; deterministic across two
    consecutive calls.
11. **`detail` passthrough**: seed a row with `detail: { foo: 'bar' }` → returned verbatim.

## 8. Edge cases & behaviors (normative)

| Case | Behavior |
|---|---|
| Fresh install, first cycle not yet run | 200; `checks`/`providers` per data present; missing → `unknown`/zero window; `overall: 'unknown'` when nothing is known. |
| `MONITORING_HEALTH_PROBES=off` (test env) or probe cooldown | Provider rows show `unknown` until a probe or inference writes a `provider:<id>` row — expected, not an error. |
| Provider type with no liveness endpoint (Azure ASR/TTS, Cartesia) | Status comes from the call-log **inference** path `HealthCheckService` already implements (it still writes the `provider:<id>` row) — no special handling here. |
| Provider deleted after checks exist | Row disappears from `providers[]` (providers table drives); orphan check rows dropped. |
| Unknown future check name (new service heartbeat, new check type) | Included with `group: 'other'` (or `service` if `service_heartbeat:`-prefixed), label = fallback rule. The endpoint must never 500 on unknown names. |
| `windowMinutes` larger than table history | Window counts reflect available rows only (`total` < expected cadence). No extrapolation. |
| Two rows with identical `created_at` for one check | `DISTINCT ON … ORDER BY check_name, created_at DESC` — tie broken arbitrarily by the index; acceptable (same-second rows are indistinguishable anyway). |
| High `detail` payload | Passthrough; bounded upstream by the check writers. No size guard in v1. |

## 9. Roadmap (context for v1 contract choices)

**v2 — historical buckets** (schema change, separate PR):

- `health_check_stats_hourly` — PK `(hour_bucket, check_name)`, columns
  `total, ok_count, degraded_count, down_count, unknown_count` (**counts only — no latency
  percentiles**, per decision 6; purely recombinable so day/month granularity is exact).
- `RetentionService`: second rollup in the hourly cron (idempotent
  `INSERT … SELECT … ON CONFLICT DO NOTHING`, same TZ discipline as the existing
  `provider_call_stats_hourly` rollup) + purge line with an independent
  `historyRetentionDays` config key (default **90**).
- `GET /api/monitoring/status/history?granularity=hour|day&from=&to=&checkName?` — flat
  buckets `{ bucket, checkName, total, ok, degraded, down, unknown, uptimePct }`;
  `hour` capped at 7 days, `day` at 90 (the 90-day uptime table); complete hours only —
  "now" stays the v1 endpoint.
- Optional in v2: call-quality history endpoint over the **existing**
  `provider_call_stats_hourly` (error rate, p95 duration, TTFT per provider-hour).

**v3** — incidents (lifecycle/timeline/manual/maintenance), 90-day uptime table rendering,
feeds, public exposure.

## 10. Decisions log

| # | Question | Decision |
|---|---|---|
| 1 | Endpoint path | `GET /api/monitoring/status` (existing monitoring namespace, no new top-level route) |
| 2 | Contract file | new `statusPage.ts`; shared `healthCheckStatusSchema` extracted into `monitoring.ts` |
| 3 | `windowMinutes` param | kept (default 60, 5–1440) |
| 4 | `detail` jsonb | included, raw passthrough (private endpoint) |
| 5 | Checks shape | flat `checks[]` with `group` discriminator (`core`/`service`/`other`) — Console groups for rendering |
| 6 | `window` nullability | never null; all-zero + `worstStatus: 'unknown'` when empty |
| 7 | Current `latencyMs` per row | kept (single latest value, not a percentile) |
| 8 | Orphan `provider:*` checks | dropped |
| 9 | `overall` semantics | reuse the existing documented `healthSnapshotResponseSchema.overall` semantics verbatim |
| 10 | Caching | none in v1 |
| 11 | `days` param (v1.1) | optional, 1–90; `daily` omitted when absent — keeps the base 30 s-poll payload lean |
| 12 | Daily bucket scope (v1.1) | global per-UTC-day (all checks + providers), zero-filled, strict `uptimePct`; per-entry daily history deferred to the v2 rollup endpoint |
