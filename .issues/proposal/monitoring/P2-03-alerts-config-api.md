---
title: "P2-03 — Alerts + monitoring config API"
severity: proposal
status: open
created: 2026-08-17
updated: 2026-08-17
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
| `PUT /api/monitoring/config` | full-replace body validated against `monitoringConfigSchema` (P1-06); requires `version` in body — mismatch → `OptimisticLockError` (409); on success increments version, persists, calls `reload()` on the config service (engine + notifiers pick it up on next evaluation/delivery), writes `audit_logs` entry (`update_monitoring_config` with before/after summary — **not** raw notifier URLs/secrets in the audit payload) |

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
