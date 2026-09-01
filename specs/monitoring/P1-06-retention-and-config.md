---
title: "P1-06 — RetentionService (rollups + purge) & MonitoringConfigService"
severity: proposal
status: resolved
created: 2026-08-17
updated: 2026-08-19
assignee: ""
tags: [monitoring, spec, phase-1]
---

# P1-06 — RetentionService (rollups + purge) & MonitoringConfigService

- **Phase:** 1 — Instrumentation & health
- **Depends on:** P1-01, P1-02
- **Blocks:** P1-08, P1-09, P2-02
- **Estimate:** 1 dev-day

## Objective

Keep the monitoring tables bounded and fast: hourly aggregation of raw call logs into `provider_call_stats_hourly` (so stats endpoints never scan raw rows) and daily purge beyond retention — plus the single source of truth for all monitoring tunables.

## Scope

### New files
- `src/services/monitoring/RetentionService.ts`
- `src/services/monitoring/MonitoringConfigService.ts`
- `src/http/contracts/monitoring.ts` — **new**: `monitoringConfigSchema` (zod, shared by this service and P2-03's PUT endpoint)

### Modified files
- `src/server.ts` — start `RetentionService` (`MonitoringConfigService` is a lazy singleton — no start hook; first `get()` loads + upserts the row)
- `src/services/monitoring/HealthCheckService.ts` — probe policy becomes config-driven (`probeSettings.llmProbe` + `cooldownMinutes`), per P1-05 soundness finding #1; `MONITORING_HEALTH_PROBES=off` stays a hard kill switch (see finding 6)
- `tests/setup.ts`, unit + e2e tests (see Tests)

## Implementation requirements

### `MonitoringConfigService` (`@singleton`)
- Loads the `monitoring_config` singleton row (`id='global'`); if absent, synthesizes from defaults + env overrides and **upserts** the row on first load (idempotent).
- Config shape (zod, every field `.describe()`d):
  ```ts
  {
    notifiers: { id: string; type: 'webhook' | 'email';   // P4-02 extends the union with 'telegram' | 'twilio_sms'
                 channelProviderId?: string; url?: string; to?: string;   // url: z.string().url() when webhook; to: z.string().email() when email
                 minSeverity?: 'info' | 'warning' | 'critical';  // default 'info' = deliver all severities
                 enabled: boolean }[];
    // per-type refinement (zod `.refine`): type='webhook' requires `url` (http/https);
    // type='email' requires `channelProviderId` + `to` (email address); else 400 on save.
    rules: Record<string, { enabled?: boolean } & RuleOverrides>;  // rule id → override (all fields optional)
    retentionDays: number;            // integer, min 7, default 90
    probeSettings: { llmProbe: 'models' | 'one_token' | 'off'; cooldownMinutes: number }; // default models/10
    alerting: { engineIntervalMinutes: number;   // default 1 (proposal: engine runs 1/min)
                defaultCooldownMinutes: number }; // default 15 (proposal: per-key re-fire cooldown)
  }
  ```
  Every field is `.default()`-ed so `monitoringConfigSchema.parse({})` yields the full default config (used for first-boot synthesis).
- `RuleOverrides = Partial<{ threshold: number; windowMinutes: number; minSamples: number; forMinutes: number; resolveAfterGoodChecks: number; cooldownMinutes: number; maxUnresolvedHours: number; severity: 'info' | 'warning' | 'critical' }>` — the tunable params of a rule (P2-01's evaluator registry defines the per-rule param keys).
- Rule-id validation: P1-06 validates rule keys **structurally** (non-empty string) — the rule registry does not exist yet (P2-01). P2-01 tightens the same schema with a `refine` against the registered rule ids: unknown rule id → 400.
- Env fallbacks (applied only when no DB row exists): `MONITORING_WEBHOOK_URL`, `MONITORING_EMAIL_PROVIDER_ID` **+ `MONITORING_EMAIL_TO`** (an email notifier needs both — `to` alone is invalid per the per-type refine; the notifier is synthesized only when both are set), `MONITORING_RETENTION_DAYS` (applied only when it parses to an integer ≥ 7, else ignored + pino warn — an out-of-range env value must not produce an invalid row).
- `get(): Promise<MonitoringConfig>` (lazy — first call loads + upserts the default row; cached afterwards), `reload(): Promise<void>` (re-read + re-validate; invalid config keeps last-good + pino error), `save(config, version): Promise<void>` (validates → reads row → version compare → conditional UPDATE → `OptimisticLockError` on 0 rows; house pattern from `ProviderService`. Used by P2-03.) First load with a *broken* existing row: in-memory synthesized defaults + pino error — the user's row is never clobbered on load (finding 7).

### `RetentionService` (`@singleton`)
- **Hourly** (node-cron `0 * * * *`): roll up the previous complete hour of `provider_call_logs` → `provider_call_stats_hourly` via CTE + `INSERT ... SELECT ... ON CONFLICT DO NOTHING` (idempotent). Groups by the 5-key PK `(hour_bucket, provider_id, operation, ok, COALESCE(error_code, 'none'))`. Aggregates: `count`, `sum/min/max(duration_ms)`, `p95_duration_ms = percentile_cont(0.95)`, `p50/p95/p99_ttft_ms` + `p95_max_chunk_gap_ms` percentiles, `stalled_count` = rows with `metrics->>'maxChunkGapMs' > 10000`, `rtf_over_1_count` = rows with `provider_type = 'tts'` AND `metrics->>'audioDurationMs' > 0` AND `duration_ms > metrics->>'audioDurationMs'`. Variant fields come from the `metrics` jsonb (camelCase per `CallMetrics`, cast `(metrics->>'ttftMs')::float8`). **NULL semantics:** `percentile_cont` does *not* skip NULLs (they sort first and can null out p50 in mixed groups), so the TTFT and chunk-gap percentiles are computed in separate CTE aggregations filtered `WHERE ttft IS NOT NULL` / `WHERE max_chunk_gap IS NOT NULL` and `LEFT JOIN`ed back on the 5 keys (finding 2). The previous-hour boundary is computed in SQL (`date_trunc('hour', now()) - interval '1 hour'`) so the tz-less timestamp columns and app clock never disagree; the job body is `runRollupForHour(hourStart)` — the explicit-window form is the test seam.
- **Daily** (node-cron `0 3 * * *`): delete from `provider_call_logs`, `health_checks`, `metric_samples` where `created_at < now() - retentionDays`; `provider_call_stats_hourly` purged at 2× retentionDays (on `hour_bucket`); `alert_events`, `fallback_events`, `monitoring_config` **never** purged. `retentionDays` read from `MonitoringConfigService.get()`; job body `runPurgeNow(retentionDays?)` — the explicit-days form is the test seam.
- Guard: per-job `isRollingUp`/`isPurging` flags (two flags, not one — the daily 03:00 fire coincides with the hourly fire; a single flag would skip a job), per-job try/catch with pino error, job duration + rows-affected (`QueryResult.rowCount`) logged.

## Acceptance criteria

- [x] First boot with empty DB creates the `monitoring_config` row with defaults; second boot does not clobber a user-modified row. — e2e `first boot creates the monitoring_config row with a valid config` + `reload() picks up user-modified rows (no clobber)` (tests/e2e/monitoring-retention.test.ts).
- [x] Rollup over a synthetic hour of logs produces exactly the expected aggregate rows (percentiles verified against hand-computed values). — e2e `hourly rollup aggregates the window` (8 fixture rows across 3 PK groups; p95 duration 480, TTFT p50/p95/p99 2500/4700/4940, chunk-gap p95 14255, stalled 1, rtf_over_1 1 per group — `closeTo(…, 0.01)` because percentile interpolation is double precision).
- [x] Re-running the hourly job for the same hour is idempotent (no duplicate/conflict errors, no double counts). — same e2e test re-runs the bucket and asserts the row set is unchanged.
- [x] Purge deletes only rows older than retention; alert/fallback rows untouched. — e2e `runPurgeNow() deletes retention-aged rows…` (100-day-old rows in all 4 targets gone, 1-hour-old row + 200-day-old `alert_events` row survive; `hour_bucket < 2×retention` for stats).
- [x] `save()` with stale `version` throws `OptimisticLockError`. — e2e `save() validates input and enforces optimistic locking` (valid update bumps version; stale version throws; `retentionDays: 1` throws ZodError).

## Tests

- **Unit:** config schema validation matrix (valid, missing fields → defaults, retentionDays < 7 / non-integer, bad notifier type, webhook missing `url` / non-http(s), email missing `to` / bad email / missing `channelProviderId`, bad `minSeverity` enum, `RuleOverrides` field types; unknown rule id rejection is covered by P2-01's refine + its tests), env fallback synthesis (pure `synthesizeDefaults()` — no DB), config-driven probe behaviour in `HealthCheckService` (`llmProbe` off / one_token / config `cooldownMinutes`) with stubbed factories + fake config service. No unit test touches a real DB (`save()` locking needs one — e2e).
- **E2E:** first-boot default row (fresh container per run; app-world instance exposed on `globalThis` by `tests/setup.ts` per the P1-04 pattern) + reload after a user-modified row (no clobber); insert synthetic `provider_call_logs` rows in an explicit 1-hour window (hand-computable durations/ttft) + 100-day-old rows across all purge-target tables + 185-day-old stats bucket → `runRollupForHour` + `runPurgeNow` (the test seams) → assert aggregates, idempotent re-run, purge results (alert rows untouched); `save()` with stale version throws `OptimisticLockError`.

## Out of scope

- Weekly/daily metric rollups (hourly is enough for the current endpoints), partitioning (revisit only if load sanity in P4-05 shows it's needed).

## Soundness review (2026-08-17)

Findings from verifying this spec against the codebase before implementation (all reconciled into the spec above):

1. **`p95_max_chunk_gap_ms` was missing from the rollup description.** The P1-01 schema has the column, but the original rollup text only listed TTFT p50/p95/p99, p95 duration, `stalled_count`, `rtf_over_1_count`. The rollup now also computes `percentile_cont(0.95)` over `metrics->>'maxChunkGapMs'` (non-NULL rows).
2. **"`percentile_cont` skips missing keys as NULL" is false.** Postgres ordered-set aggregates include NULL inputs (NULLS FIRST on ascending order): in a mixed group (e.g. streaming rows that errored before the first chunk have no `ttftMs`), the p50 position can land in the NULL region and return NULL even when non-NULL values exist; p95/p99 are only affected when the NULL fraction exceeds 5%/1%. **Resolution:** the TTFT and chunk-gap percentiles are computed in separate CTE aggregations filtered `WHERE <key> IS NOT NULL`, then `LEFT JOIN`ed back onto the main aggregation on the 5-key group — exact, hand-computable values (acceptance criterion 2) in a single idempotent `INSERT ... SELECT`.
3. **`rtf_over_1_count` needs `provider_type` in the rollup base.** The predicate is "TTS rows with `audioDurationMs > 0` AND `duration_ms > audioDurationMs`" — duration fields alone cannot identify TTS rows, so the base CTE selects `provider_type` too. `stalled_count` stays unfiltered (`maxChunkGapMs` only ever appears on LLM streaming rows).
4. **`alerting` defaults were undefined.** Filled from the proposal: engine runs 1/min (`engineIntervalMinutes: 1`, proposal §3.3 line 114), per-key re-fire cooldown default 15 min (`defaultCooldownMinutes: 15`, proposal §3.3 hysteresis note). P2-01's own rule defaults (cooldown 15, forMinutes 2, resolveAfterGoodChecks 2) stay consistent.
5. **An env-synthesized email notifier is invalid without `to`.** `MONITORING_EMAIL_PROVIDER_ID` alone would produce an email notifier failing the per-type refine (`channelProviderId` + `to` required). **Resolution:** added `MONITORING_EMAIL_TO`; the email notifier is synthesized only when both vars are set. `MONITORING_RETENTION_DAYS` is applied only when it parses to an integer ≥ 7 (else ignored + pino warn) — an out-of-range env value must not yield an invalid row.
6. **`probeSettings` wiring touches `HealthCheckService` (P1-05, already shipped).** Per P1-05 soundness finding #1: `probeSettings.llmProbe` — `'off'` → no LLM probe (inference only), `'models'` → `enumerateModels()` (default, free), `'one_token'` → `generate([{role:'user', content:'Hi'}], { maxTokens: 1 })` (costs money — proposal: opt-in, so the default stays `'models'`); `cooldownMinutes` (default 10) replaces the hard-coded `PROBE_COOLDOWN_MS`; `RECENT_SUCCESS_SKIP_MS` stays hard-coded 10 min. **`MONITORING_HEALTH_PROBES=off` remains a hard env kill switch** (env beats config) — the e2e env sets it because the test DB synthesizes a default config row with `llmProbe='models'`, and config-driven probes alone would send real outbound requests against fake provider configs in e2e. The config is read per cycle via `MonitoringConfigService.get()` in a try/catch: on load failure the hard-coded defaults apply + pino warn (a DB blip must not stop inference-based provider checks). `HealthCheckService.ts` added to the modified-files list; existing p1-05 unit tests pass a fake config service as the new 5th constructor arg.
7. **First load with a broken existing DB row was undefined** (the spec only covered *reload* keeping last-good). **Resolution:** first load with an invalid row keeps the in-memory synthesized defaults + pino error and never overwrites the user's row — repair is via P2-03's PUT (validated before write). Concurrent first boots are safe: `INSERT ... ON CONFLICT (id) DO NOTHING` + re-select.
8. **`get()` must be async** (`Promise<MonitoringConfig>`): first call loads (DB round-trip) + upserts; later calls hit the cache. `MonitoringConfigService` therefore has no lifecycle — it is a lazy singleton and `server.ts` starts only `RetentionService`. `save(config, expectedVersion)` = validate (ZodError propagates → P2-03 maps to 400 via the global error handler) → `get()` (ensures row) → read version → `UPDATE ... SET config, version = version + 1, updated_at WHERE id = 'global' AND version = $expected` → 0 rows → `OptimisticLockError` (house pattern from `ProviderService`); the cache is refreshed on success.
9. **Notifier `id` on synthesis:** `generateId('notf')` — raw string prefix, same pattern as the P1-01..P1-05 monitoring prefixes (`hchk`, `clgl`, `msmp`), which are deliberately not added to `ID_PREFIXES`.
10. **Test allocation corrected.** The original spec put "`save()` optimistic lock" under unit tests, but the unit runner has no reliable DB (the `src/db` dotenv leak hits a shared local Postgres — pre-existing issue, out of scope here). The schema matrix + env synthesis are pure (unit); `save()` locking, rollup aggregates, idempotency, purge, first-boot row, and no-clobber reload all run against testcontainers (e2e), using the app-world singletons exposed on `globalThis` from `tests/setup.ts` (established P1-04 pattern) and the explicit-window seams `runRollupForHour(hourStart)` / `runPurgeNow(retentionDays?)`. `resetDatabase()` already truncates all six purge-target monitoring tables and deliberately keeps `monitoring_config`, so the config row persists across suites within a run — the "first-boot" test asserts the row exists with a valid shape rather than exact defaults (an earlier suite may have `save()`d a different config).
11. **Raw-SQL `Date` parameters are TZ-broken against tz-less columns (implementation finding).** The e2e rollup test failed on this dev host (Europe/Warsaw): pg serializes a raw `Date` parameter in the *host* timezone (`'2026-08-15T12:00:00.000+02:00'`), and Postgres **drops the offset** when casting to a tz-less `timestamp` — the window landed 2 h off and the rollup matched 0 rows. Drizzle query-builder inserts are unaffected (cached prepared statements send binary timestamp values → stored as the session wall clock, i.e. UTC). **Fix:** `RetentionService` passes boundaries as UTC ISO strings (`hourStart.toISOString()`, `cutoff.toISOString()`), and `rollupPreviousHour()` fetches the SQL-computed boundary as `::text` + explicit `Z` (never a pg-parsed `Date`). Regression coverage: the e2e rollup test runs on any host TZ while the test DB session is UTC.
12. **pg parses naive-timestamp *results* as host-local (implementation finding).** `postgres-date` uses the local `Date` constructor for tz-less values, so `HealthCheckService.fetchRecentCallStats()` returned `lastSuccessAt`/`lastFailureAt`/`lastCallAt` shifted by the host offset, skewing the age-of-call comparisons (the 10-min recent-success skip and the 24 h inference window) on non-UTC hosts. Production containers run UTC/UTC so this is latent, but the fix is cheap: the three `max(created_at)` values are fetched `::text` and reconstructed as `new Date(text.replace(' ', 'T') + 'Z')`.

## Implementation (2026-08-17)

- `src/http/contracts/monitoring.ts` — `monitoringConfigSchema` + sub-schemas (`notifierConfigSchema`, `ruleOverrideSchema`, `probeSettingsSchema`, `alertingSettingsSchema`), all fields `.describe()`d. **Zod v4 note:** nested object fields with their own field-level defaults use factory-function defaults (`.default(() => probeSettingsSchema.parse({}))`) — a literal `.default({})` inserts an empty object and skips the nested defaults. `parse({})` yields the full default config.
- `src/services/monitoring/MonitoringConfigService.ts` — lazy `@singleton` (no lifecycle, not started in `server.ts`); async `get()`/`reload()`/`save(config, expectedVersion)`; `synthesizeDefaults()` applies the env overrides (finding 5); first-load broken-row path = in-memory defaults + pino error (finding 7); `save()` = validate → `get()` → version compare → `UPDATE … WHERE and(id = 'global', version = $expected)` → 0 rows → `OptimisticLockError`.
- `src/services/monitoring/RetentionService.ts` — `start()` schedules `0 * * * *` (rollup) + `0 3 * * *` (purge), `stop()` destroys both; per-job `isRollingUp`/`isPurging` guards; rollup = 4 CTEs (`base`, `main_agg`, `ttft_agg`, `gap_agg`) + single `INSERT … SELECT … LEFT JOIN … ON CONFLICT DO NOTHING`; purge covers the 4 retention-target tables only. Boundaries as UTC ISO strings (finding 11).
- `src/services/monitoring/HealthCheckService.ts` — probe policy config-driven (finding 6): `getProbeSettings()` per cycle (try/catch → `DEFAULT_PROBE_SETTINGS`), `llmProbe` `off`/`models`/`one_token` branches, `cooldownMinutes` from config; `MONITORING_HEALTH_PROBES=off` stays a hard env kill switch. `fetchRecentCallStats()` reads timestamps as text (finding 12).
- `src/server.ts` — `container.resolve(RetentionService).start()` after `HealthCheckService`.
- `tests/setup.ts` — exposes `globalThis.__TEST_MONITORING_CONFIG__` + `globalThis.__TEST_RETENTION_SERVICE__` (app-world singletons, P1-04 pattern).
- Tests: `tests/unit/monitoring/p1-06-retention-config.test.ts` (17 tests: schema matrix, env synthesis, config-driven probe policy) + `tests/e2e/monitoring-retention.test.ts` (6 tests: first-boot row, no-clobber reload, save() locking, rollup aggregates + idempotency, purge, config-driven purge). Chai 6 note: `.property(name, value)` no longer deep-compares object/array values — tests use `.to.deep.equal` / scalar `.property` instead. `AGENTS.md` background services 7 → 8.
