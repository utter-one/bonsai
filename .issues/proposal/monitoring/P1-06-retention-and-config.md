---
title: "P1-06 — RetentionService (rollups + purge) & MonitoringConfigService"
severity: proposal
status: open
created: 2026-08-17
updated: 2026-08-17
assignee: ""
tags: [monitoring, spec, phase-1]
---

# P1-06 — RetentionService (rollups + purge) & MonitoringConfigService

- **Phase:** 1 — Instrumentation & health
- **Depends on:** P1-01, P1-02
- **Blocks:** P1-08, P2-02
- **Estimate:** 1 dev-day

## Objective

Keep the monitoring tables bounded and fast: hourly aggregation of raw call logs into `provider_call_stats_hourly` (so stats endpoints never scan raw rows) and daily purge beyond retention — plus the single source of truth for all monitoring tunables.

## Scope

### New files
- `src/services/monitoring/RetentionService.ts`
- `src/services/monitoring/MonitoringConfigService.ts`

### Modified files
- `src/server.ts` — start both services
- `src/http/contracts/monitoring.ts` — **new**: `monitoringConfigSchema` (zod, shared by this service and P2-03's PUT endpoint)

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
    alerting: { engineIntervalMinutes: number; defaultCooldownMinutes: number };
  }
  ```
- `RuleOverrides = Partial<{ threshold: number; windowMinutes: number; minSamples: number; forMinutes: number; resolveAfterGoodChecks: number; cooldownMinutes: number; maxUnresolvedHours: number; severity: 'info' | 'warning' | 'critical' }>` — the tunable params of a rule (P2-01's evaluator registry defines the per-rule param keys).
- Rule-id validation: P1-06 validates rule keys **structurally** (non-empty string) — the rule registry does not exist yet (P2-01). P2-01 tightens the same schema with a `refine` against the registered rule ids: unknown rule id → 400.
- Env fallbacks (applied only when no DB row exists): `MONITORING_WEBHOOK_URL`, `MONITORING_EMAIL_PROVIDER_ID`, `MONITORING_RETENTION_DAYS`.
- `get(): MonitoringConfig` (cached, validated on load), `reload(): Promise<void>` (re-read + re-validate; invalid config keeps last-good + pino error), `save(config, version): Promise<void>` (optimistic lock — used by P2-03).

### `RetentionService` (`@singleton`)
- **Hourly** (node-cron `0 * * * *`): roll up the previous complete hour of `provider_call_logs` → `provider_call_stats_hourly` via `INSERT ... SELECT` using `percentile_cont` for p50/p95/p99 TTFT + p95 duration; `stalled_count` = rows with `max_chunk_gap_ms > 10000`; `rtf_over_1_count` = TTS rows with `audio_duration_ms > 0 AND duration_ms > audio_duration_ms`. `ON CONFLICT DO NOTHING` for idempotency.
- **Daily** (node-cron `0 3 * * *`): delete from `provider_call_logs`, `health_checks`, `metric_samples` where `created_at < now() - retentionDays`; `provider_call_stats_hourly` purged at 2× retentionDays; `alert_events`, `fallback_events`, `monitoring_config` **never** purged.
- Guard: `isProcessing` flag (house pattern), per-job try/catch with pino error, job duration + rows-affected logged.

## Acceptance criteria

- [ ] First boot with empty DB creates the `monitoring_config` row with defaults; second boot does not clobber a user-modified row.
- [ ] Rollup over a synthetic hour of logs produces exactly the expected aggregate rows (percentiles verified against hand-computed values).
- [ ] Re-running the hourly job for the same hour is idempotent (no duplicate/conflict errors, no double counts).
- [ ] Purge deletes only rows older than retention; alert/fallback rows untouched.
- [ ] `save()` with stale `version` throws `OptimisticLockError`.

## Tests

- **Unit:** config schema validation matrix (valid, missing fields, bad notifier type, webhook notifier missing `url`, email notifier missing `to`/bad email, bad `minSeverity` enum, `RuleOverrides` field types; unknown rule id rejection is covered by P2-01's refine + its tests), env fallback precedence, `save()` optimistic lock.
- **E2E:** insert synthetic `provider_call_logs` rows spanning 2 hours + 100 days old rows → run rollup + purge manually (expose `runNow()` methods for tests) → assert stats + purge results.

## Out of scope

- Weekly/daily metric rollups (hourly is enough for the current endpoints), partitioning (revisit only if load sanity in P4-05 shows it's needed).
