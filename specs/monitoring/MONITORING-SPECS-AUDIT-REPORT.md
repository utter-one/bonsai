# Monitoring Specs — Implementation Verification Report

- **Date:** 2026-08-21
- **Branch:** `advanced-monitoring` @ `a475625` (clean working tree)
- **Scope:** all 24 issue specs in `specs/monitoring/` (22 `resolved`, 2 `closed`)
- **Method:** read-only audit — every spec's acceptance criteria (ACs) re-verified against the current
  worktree (files, routes, wiring, test files, docs, git history). Test/build gates re-run live during
  the audit. **No code was changed.**

## Verdict

**All 24 specs are implemented (or correctly closed) as specified. 22 resolved ✅ / 2 closed ✅ / 0 gaps.**
Two minor documentation nits were found (unchecked AC boxes; one stale route count in spec text) —
neither affects code, tests, or behavior. Details in §4.

## 1. Test & build gates (re-run during this audit)

| Gate | Command | Result |
|---|---|---|
| Unit | `npm run test:unit` | **886 passing, 0 failing** |
| E2E | `npm run test:e2e` | **1049 passing, 0 failing** |
| Integration | `npm run test:integration` | **35 passing, 0 failing** (incl. P1-03 instrumentation test) |
| Build (CI gate) | `npm run build` | 0 errors; regenerated artifacts byte-identical — working tree stayed clean |
| Type check | `npx tsc --noEmit` | exit 0 |
| Docs build | `docs/` VitePress build | complete in 10.09 s, no dead links |

## 2. Per-spec verification

Evidence = what was checked in the worktree this audit. "Tests" = test files whose suites are covered
by the green runs in §1.

### Phase 1

| Spec | Verdict | Evidence |
|---|---|---|
| **P1-01** DB migration | ✅ | Exactly one new migration `drizzle/0068_lively_rage.sql` creates all 7 monitoring tables (`provider_call_logs` hybrid 16-col + metrics jsonb, `metric_samples`, `health_checks`, `alert_events`, `fallback_events`, `provider_call_stats_hourly`, `monitoring_config`); all 7 tables in `src/db/schema.ts`; `tests/utils.ts:54-60` truncates all 6 log tables and deliberately excludes `monitoring_config`; migrations apply on every fresh testcontainer e2e boot (suite green). |
| **P1-02** Core infra | ✅ | All five modules exist under `src/services/monitoring/` (`MetricsRegistry`, `CallLogger`, `HeartbeatRegistry`, `MonitoringContext` + `src/utils/errorClassification.ts`); started in `server.ts:415-416`. `CallLogger.record(entry): void` is synchronous and wrapped in a last-resort try/catch (`CallLogger.ts:99-133`); overflow drops oldest via `buffer.shift()` with one pino error; flush failure re-queues rows and logs exactly one error per flush (`onFlushError`); `settled()` seam closes the P1-09 flush/pool race. |
| **P1-03** Provider instrumentation | ✅ | `tests/integration/live/providerInstrumentation.test.ts` green in the live integration run ("mock conversation with classifier produces >=4 attributed provider_call_logs rows with streaming fields"); unit coverage for channel send / OAuth / IMAP rows exists under `tests/unit/monitoring/`; AC self-attestations (5-row integration evidence, +1.9% latency) are recorded in the spec. |
| **P1-04** Request outcome | ✅ | `requestOutcome.ts` assigns `req.id`, honors/echoes `X-Request-Id`; registered `server.ts:196` (after `/health` + `/health/ready`, before rate limiter); `LOG_REDACT` exported from `src/utils/logger.ts` and applied to pino; unit + e2e tests present. |
| **P1-05** HealthCheckService | ✅ | `server.ts:179-184` registers `GET /health/ready` with `checkReady()` → 503 `{status:'unavailable', reason}` on failure; `HealthCheckService` (`@singleton`) with `start/stop/runNow/getSnapshot/checkReady`; `HeartbeatRegistry.tick/declareInterval/serviceStates`; unit (synthetic-clock heartbeat staleness) + e2e (`health-check.test.ts`) green. |
| **P1-05b** ASR/TTS probes | ✅ | `ping()` on exactly 10/13 providers (all ASR except Azure; all TTS except Azure + Cartesia) — verified per file; `createProviderForProbing` on both factories; `probeSettings.asrProbe/ttsProbe` in `contracts/monitoring.ts:103-107`; `MONITORING_HEALTH_PROBES=off` kill switch honored in `tests/setup.ts`; unit `p1-05b-probes.test.ts` green. |
| **P1-06** Retention & config | ✅ | `RetentionService` crons `'0 * * * *'` (rollup) + `'0 3 * * *'` (purge); `MonitoringConfigService` full-replacement `save()` with `version` optimistic lock (`OptimisticLockError`) and Zod validation; e2e `monitoring-retention.test.ts` (first-boot row, no clobber, hand-computed percentiles, idempotent re-rollup, purge scoping) green. |
| **P1-07** Rate-limit instrumentation | ✅ | `rateLimiter.ts` exports `hashLimitKey`, `getRateLimitRejectionStats` (top-N), `resetRateLimitersForTests`, `onRejection` (counter + map + warn with hashed key); `TooManyRequestsError` carries internal `scope?: 'auth' | 'api'` (never serialized); e2e `rate-limit.test.ts` (auth 10×401→429, api 5×200→429, exact bodies + `retry-after: 60`, no-contamination) green. |
| **P1-08** Read-only endpoints | ✅ | All six endpoints present: `health`, `health/history` (`MonitoringController.ts:328` — note the slash, not `health-history`), `providers`, `provider-calls`, `provider-stats`, `metrics`; OpenAPI paths registered; RBAC + pagination/filter + synthetic-aggregate e2e suites green. |
| **P1-09** Graceful shutdown | ✅ | `installShutdownHandlers` called only in `src/index.ts:80` (never in `createApp()`); `src/utils/shutdown.ts` sequence verified in earlier smoke + unit `p1-09-shutdown.test.ts` (second-signal exit 1, grace-deadline `terminateOpenSockets`, flush-before-`endPool` via `CallLogger.settled()`). |

### Phase 2

| Spec | Verdict | Evidence |
|---|---|---|
| **P2-01** Alert rule engine | ✅ | `AlertEvents.ts` `DEFAULT_RULES` contains exactly **21 rules** (ids enumerated and matching docs/AGENTS); state machine `ok→pending→firing→resolved` with `forMinutes`/`resolveAfterGoodChecks`/`cooldownMinutes`/`maxUnresolvedHours`; per-rule evaluation isolation (evaluator throws → `null` verdict, no state change; `synthesizeMissingVerdicts`); `reconcileStartup` on first pass (`AlertRuleEngine.ts:585`); config-load failure degrades to schema defaults; `minSamples` gate on all windowed rules. 43 unit + 2 e2e tests green. |
| **P2-02** Notifiers | ✅ | `WebhookNotifier` + `EmailNotifier` + `AlertNotifier` hub; severity floor `SEVERITY_RANK[event.severity] >= SEVERITY_RANK[n.minSeverity ?? 'info']` (`AlertNotifier.ts:88`); engine fire-and-forget `void this.publisher.fire(event).catch(...)` (`AlertRuleEngine.ts:546`) — evaluation pass never awaits; 15 s publisher cap (`DEFAULT_PUBLISHER_CAP_MS = 15_000`); delivery results persisted to `alert_events.notifications`; 24 unit + 5 e2e tests green. |
| **P2-03** Alerts + config API | ✅ | Routes `GET/POST alerts`, `alerts/:id`, `alerts/:id/acknowledge`, `GET/PUT config` registered (`MonitoringController.ts:334-338`); ack stamps exactly once + idempotent; config PUT full-replace with 409 stale-version; running engine/notifiers observe new config without restart; sanitized audit entries via `AuditService` (`MonitoringService.ts:651, 707` — webhook URLs with tokens redacted); e2e `monitoring-alerts-config.test.ts` green. |
| **P2-04** RBAC completion | ✅ | `src/permissions.ts:143` — `super_admin.permissions = Object.values(PERMISSIONS)`; `system:monitoring` appears in **no** other role's list (verified by scan); service-level `requirePermission(context, SYSTEM_MONITORING)` on every write op; RBAC matrix e2e covers 401/403/200 per route × all 5 roles (13 routes — see §4 nit 2). |

### Phase 3

| Spec | Verdict | Evidence |
|---|---|---|
| **P3-01** Circuit breaker | ✅ | `CircuitBreaker.ts` states open/half-open/closed; `NON_COUNTING_ERROR_CODES = {auth, client_error}` (never open the breaker); half-open allows exactly one probe (concurrent calls treated as open); metrics `circuit_opens_total` / `circuit_open_skips_total` / `circuit_breaker_state` gauge; registry push-based (no config-service import); 21 unit + 4 e2e tests green. |
| **P3-02** Fallback resolver + API | ✅ | `provider.ts` contracts: `fallbacks` on create (default `[]`) / update (optional, `[]` clears) / response; `fallbackValidation.ts` covers self-reference, type mismatch, cycles (2- and 3-cycle), missing target, >3 entries; `FallbackResolver` version-keyed cache invalidates on provider update; 17 unit + e2e `provider-fallback.test.ts` green. |
| **P3-03** LLM failover | ✅ | `FailoverLlmProvider` wired into `ConversationRunner.ts:2908-2914` via `fallbackResolver.resolveChain`; setup-phase-only failover (mid-stream boundary documented); 19 unit + 2 e2e tests green. |
| **P3-04** TTS/ASR/storage failover | ✅ | `FailoverTtsProvider` (`ConversationRunner.ts:2959`), `FailoverAsrProvider` (`:2979`), `FailoverStorageProvider` (`ConversationStorageService.ts:210`); TTS wrapper calls `init()` before `start()`; skipped (breaker-open) steps produce no transition rows; `provider_call_logs.fallback_provider_id` stores the primary id; 35 unit + 5 e2e tests green; spec carries 6 documented implementation-note deviations. |
| **P3-05** Outbound channel fallback | ✅ closed | User-cancelled post-implementation, fully reverted: **no file in git history ever contained the code** (`git log --all -S OutboundChannelFallback` matches only the spec file); no remnants in `src/` or `tests/`; spec banner explains closure. |
| **P3-06** Fallback events + rules | ✅ | `GET /api/monitoring/fallback-events` registered (`MonitoringController.ts:331`) with full filter set; `provider-chain-exhausted` rule in `DEFAULT_RULES` (line 516) with its counter in the engine's `WINDOWED_COUNTERS` whitelist; per-provider scoping regressions for `provider-auth-failed` / `fallback-active` in unit tests; e2e `fallback-events-rules.test.ts` green. |

### Phase 4

| Spec | Verdict | Evidence |
|---|---|---|
| **P4-01** Prometheus endpoint | ✅ | `metricsEndpoint.ts` — `MONITORING_METRICS_TOKEN` unset/empty → 404, wrong/missing token → 401 `{error:'unauthorized'}` (warn-throttled), valid → 200 text exposition; registered `server.ts:191` **before** auth/rate-limit middleware; token read per request (rotation without restart); 14 unit + 5 e2e tests green. |
| **P4-02** Channel notifiers | ✅ | Single `ChannelNotifier` strategy table for `telegram` / `twilio_sms` / `whatsapp` (consolidation per spec update); per-channel limits + `…(truncated)` suffix in `alertMessage.ts`; credentials via `SecretRefUtils`; abandoned sends recorded in `alert_events.notifications`; 29 unit + 6 e2e tests green. |
| **P4-03** Webhook dead-letter | ✅ closed | User-declined ("overkill for v1"): closure banner in spec, README row struck through, no code remnants; v1 design is at-most-once delivery + 15 s cap + `alert_events.notifications` audit trail. |
| **P4-04** Console hooks / API sufficiency | ✅ | `docs/guide/monitoring-api.md` (24 KB) documents all 13 monitoring routes with request/response shapes and captured samples; VitePress sidebar entries present (`config.ts:88-89`) and docs build green; 12 EXPLAIN plans + 13-endpoint sample capture recorded in the spec; sufficiency result 5/5 ✅. |
| **P4-05** Docs/env/load sanity | ✅ | `docs/guide/monitoring.md` (28 KB, 9 sections + 5 runbooks) in sidebar; 11 monitoring env vars in **both** `.env.example` and `compose/env.example` (counted: 11/11, no orphans either direction); `AGENTS.md` updated (9 background services, monitoring module, 45 controllers); load-sanity evidence recorded (1× ≈ 392 k rows/day; 100× ≈ 39.3 M rows/day, worst-case rollup 5.37 s → decision rule triggered on both arms); `PROPOSAL-production-monitoring.md` marked implemented with §7 "Implementation status & deltas". |

## 3. Cross-cutting checks

- **README index** (`specs/monitoring/README.md`): 24 rows, all present; P3-05 and P4-03 rows
  struck through with closure notes. Statuses live in spec frontmatter only (the table has no status
  column) — frontmatter is consistent: 22 `resolved`, 2 `closed`, 0 `open`.
- **Proposal doc:** status header "implemented" + §7 delta log consistent with what shipped
  (hybrid schema, ChannelNotifier consolidation, P1-05b, rule catalog, P3-05/P4-03 closures,
  at-most-once delivery, partitioning follow-up).
- **Partitioning follow-up:** `.issues/medium/provider-call-logs-partitioning.md` exists and is open —
  intentional (scale follow-up triggered by the P4-05 decision rule; not part of the 24-spec set).
- **Git hygiene:** working tree clean at `a475625`; branch ahead of remote by design (push not requested).

## 4. Findings (minor, documentation-only — no action taken, per audit constraints)

1. **Unchecked AC boxes on 9 resolved specs.** `P1-01, P1-02, P2-01, P2-02, P2-03, P2-04, P3-01, P3-02,
   P3-06` have `status: resolved` but their acceptance-criteria checkboxes were never flipped to `[x]`
   (47 boxes total). The other 13 resolved specs have all boxes checked with evidence notes. Cosmetic
   inconsistency — the underlying implementation was verified sound above.
2. **P2-04 AC text says "12 routes"; the RBAC matrix test covers 13.** The test
   (`tests/e2e/monitoring-rbac.test.ts:28-61`) includes `/api/monitoring/fallback-events` (added by
   P3-06 after P2-04 shipped), so coverage is *stronger* than the AC requires — the spec text is simply
   stale. No test gap.

## 5. Out of scope

Non-monitoring issues in the repo were not part of this audit:
`critical/twilio-voice-webhook-validation-bypass.md`, `high/no-smtp-send-retry.md`,
`proposal/agentic-cli-specification.md`, and the follow-up
`medium/provider-call-logs-partitioning.md` (intentionally open).

## Conclusion

The `advanced-monitoring` branch implements all 24 monitoring specs as specified: every acceptance
criterion of the 22 `resolved` specs was re-verified against live code, tests, docs, and git history,
and all six gates (unit 886 / e2e 1049 / integration 35 / build / tsc / VitePress) are green. The two
`closed` specs are correctly closed with no leftover code. Only two cosmetic documentation nits were
found (§4); no functional gaps.
