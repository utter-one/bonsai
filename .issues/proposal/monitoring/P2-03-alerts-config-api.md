---
title: "P2-03 — Alerts + monitoring config API"
severity: proposal
status: resolved
created: 2026-08-17
updated: 2026-08-19
assignee: ""
tags: [monitoring, spec, phase-2]
---

# P2-03 — Alerts + monitoring config API

- **Phase:** 2 — Alerting
- **Depends on:** P2-01, P2-02
- **Blocks:** P2-04, P4-03, P4-04
- **Estimate:** 1 dev-day

## Objective

The history-and-control surface for alerting: query alert events (with the full notification trail), acknowledge them, and manage the monitoring config (notifiers, rule overrides, retention) with optimistic locking.

## Scope

### Modified files
- `src/http/controllers/MonitoringController.ts` — new routes
- `src/http/contracts/monitoring.ts` — request/response schemas
- `src/services/monitoring/MonitoringConfigService.ts` — `save(config, version)` specified in P1-06, wired here

## Implementation requirements

| Route | Spec |
|---|---|
| `GET /api/monitoring/alerts` | `listParamsSchema` + dedicated filters: `status` (`firing` \| `resolved`), `severity`, `ruleId`, `scopeKey`; newest `fired_at` first; paginated `{ items, total }`; items include the `notifications` array |
| `GET /api/monitoring/alerts/{id}` | single event, 404 `NotFoundError` when missing |
| `POST /api/monitoring/alerts/{id}/acknowledge` | stamps `acked_at` + `acked_by` (operator id from `req.context`); idempotent (second ack → 200, no overwrite); writes an `audit_logs` entry (`acknowledge_alert`, entity = alert id) |
| `GET /api/monitoring/config` | current config + `version` |
| `PUT /api/monitoring/config` | body `{ version, config }` — `config` validated against `monitoringConfigSchema` (P1-06), `version` int ≥ 1; mismatch → `OptimisticLockError` (409); on success increments version, persists, and the shared `@singleton` config cache is updated by `save()` itself (engine + notifiers pick it up on next evaluation/delivery — no separate `reload()` needed, finding 2), writes `audit_logs` entry (`UPDATE_MONITORING_CONFIG` with before/after summary — **not** raw notifier URLs/secrets in the audit payload, finding 5) |

All routes: `checkPermissions(req, [PERMISSIONS.SYSTEM_MONITORING])` + service-level `requirePermission` (house defense-in-depth). GETs and PUT both require the permission in this phase (role matrix refinement in P2-04).

Contracts: zod, `.describe()` on every field, `.openapi('Name')` on reusable sub-schemas before modifiers, response models named `*MonitoringResponse`.

## Acceptance criteria

- [ ] Alerts list returns firing + resolved events with `notifications` populated from P2-02 deliveries; all filters + pagination behave per house conventions.
- [ ] Ack stamps fields exactly once, records audit entry, 404s on unknown id.
- [ ] `PUT /config` validates the full schema (invalid notifier type / unknown rule id override / retention < 7 → 400), optimistic-locks on stale version (409), bumps version on success, and the running engine/notifiers observe the new config without a restart (e.g. disabling a rule stops new fires; changing a webhook URL changes delivery target — verify in test).
- [ ] Config PUT writes an audit_logs entry that does not leak notifier URLs containing tokens.
- [ ] Swagger shows all five routes with correct schemas.
- [ ] Existing e2e suite green.

## Tests

- **E2E** (extend `tests/e2e/monitoring.test.ts`):
  - alerts list/get with fixtures (insert `alert_events` rows directly in `beforeEach`);
  - acknowledge happy path + idempotency + 404 + audit entry present;
  - config GET → PUT round-trip: change retention + disable a rule + add a webhook notifier → assert DB row version bump, `reload()` effect (config service returns new values), audit entry, 409 with stale version, 400 with invalid payload;
  - 403 for non-super-admin (placeholder until P2-04 finalizes the matrix).

## Out of scope

- Partial rule updates (full-replace PUT only — simpler + auditable), per-rule notifier overrides, role matrix changes (P2-04).

## Soundness review (2026-08-19)

Spec verified against the P1/P2 codebase before implementation. Findings (referenced inline as `finding N`):

1. **No migration needed.** `acked_at`/`acked_by` already exist on `alert_events` (P1-01, `0068`). Ack = `UPDATE … WHERE id = ? AND acked_at IS NULL RETURNING`; rowCount 0 → re-SELECT → 404 `NotFoundError` or 200 with the existing ack (idempotent, no overwrite).
2. **`save()` already refreshes the shared cache.** Since P2-02, `MonitoringConfigService.save()` ends with `this.cache = parsed` on the `@singleton` — the spec's separate `reload()` call is redundant and is skipped.
3. **PUT body is nested `{ version, config }`.** A flat `{ …configFields, version }` merge would require `.extend()` on the `superRefine`d `monitoringConfigSchema` (Zod-interaction risk, muddier OpenAPI). Nested envelope: `version: z.number().int().min(1)` + `config: monitoringConfigSchema`.
4. **Audit actions are uppercase (house style).** `AuditService` writes `CREATE`/`UPDATE`/`DELETE` via `logChange({ action, … })` — the spec's snake_case actions become `ACKNOWLEDGE_ALERT` (`entityType: 'alert_event'`) and `UPDATE_MONITORING_CONFIG` (`entityType: 'monitoring_config'`), via `logChange` (the house `logUpdate` hardcodes `action: 'UPDATE'`).
5. **Audit sanitization: only `url` is sensitive.** Webhook URLs may carry tokens; email `to` and `channelProviderId` are not secrets. The before/after summary maps each notifier to `{ id, type, enabled, minSeverity, channelProviderId, to, hasUrl: boolean }` — `url` is replaced by `hasUrl: true`. Rule overrides and all other fields are included verbatim.
6. **All service methods land in `MonitoringService`** (controller stays thin, one service per controller — house style). It gains `MonitoringConfigService` + `AuditService` injections. `getConfig` reads the row (version/updatedAt live on the row, not the parsed `MonitoringConfig` type) + `configService.get()` for the validated config.
7. **Response model naming follows the file's existing convention** (`healthHistoryListResponseSchema`, `providerCallListResponseSchema`), not the spec's rigid `*MonitoringResponse` suffix: `alertEventResponseSchema`, `alertEventListResponseSchema`, `monitoringConfigResponseSchema`, `monitoringConfigUpdateRequestSchema`, `alertIdParamsSchema`, `alertNotificationResponseSchema`.
8. **Alerts list uses the house dynamic-filter pattern**: `columnMap` = `id`, `ruleId`, `scopeKey`, `severity`, `status`, `firedAt`, `resolvedAt`, `ackedAt`; `textSearch` over `message` + `scopeKey` + `ruleId`; default order `desc(firedAt)` (spec: newest `fired_at` first — not `createdAt`). `notifications` is part of the item shape.
9. **Timestamps use `z.coerce.date()`** (file convention — Drizzle rows carry `Date` objects).
10. **E2E file**: the spec says "extend `tests/e2e/monitoring.test.ts`" — that file does not exist (P1-08's suite is `monitoring-endpoints.test.ts`). New suite `tests/e2e/monitoring-alerts-config.test.ts` instead; the viewer-403 pattern is reused from there (`createViewerAgent()`).
11. **Hot-pickup e2e design (acceptance criterion).** One test drives everything through the API under test: PUT config (webhook → receiver A, `high-memory` override `threshold: 1`/`forMinutes: 0`/`cooldownMinutes: 0`) → engine fires → A receives; PUT config v2 (URL → receiver B, `threshold: 1 TB`) → engine resolves → **B receives the resolved payload** (proves the new URL without restart); PUT config v3 (`threshold: 1`) → re-fire → B receives. Separate test for "disable stops fires": `high-memory` disabled with a would-fire override → `runNow` → no row; PUT enabling it → `runNow` → fires.
12. **Disabling a rule that is already firing leaves the key in `firing` state** (the engine skips disabled rules entirely — no auto-resolve on disable). Acceptable: re-enabling while the condition still holds keeps it firing (anti-flap — no duplicate event), and it resolves once the condition clears. Documented here, not in the API contract.

## Implementation notes (2026-08-19)

1. **Audit summary shape**: `{ version, retentionDays, probeSettings, alerting, rules, notifiers: [{ id, type, enabled, minSeverity?, channelProviderId?, to?, hasUrl? }] }` — stored in `oldEntity`/`newEntity` of the `UPDATE_MONITORING_CONFIG` row; `ACKNOWLEDGE_ALERT` rows carry `{ alertId, ackedAt, ackedBy }` in `newEntity`.
2. **Ack 404 vs idempotent-200 ordering**: the guarded UPDATE runs first (one round trip for the common path); only on rowCount 0 is the row re-selected to distinguish missing (404) from already-acked (200, existing stamps returned, no overwrite).
3. **`runNow()` is a no-op while an interval pass is in flight** (`isProcessing` guard). e2e assertions on fire/resolve *rows* after `runNow()` must poll (`waitFor`) — the 1 s interval picks up the evaluation within a second. Receiver-based assertions (webhook payloads) are naturally immune: the delivery lands whenever the evaluating pass runs.
4. **Config tests run last in the suite.** `monitoring_config` persists across `resetDatabase()` (like operators), so a saved `high-memory` threshold-1 override would let the 1 s engine interval fire in the background and pollute row-count assertions in later tests. The suite's `after()` settles the key (unmeetable threshold) and restores the clean default config via the API under test.
