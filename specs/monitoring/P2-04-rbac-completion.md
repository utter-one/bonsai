---
title: "P2-04 — RBAC completion: role matrix, audit integration, 403 coverage"
severity: proposal
status: resolved
created: 2026-08-17
updated: 2026-08-19
assignee: ""
tags: [monitoring, spec, phase-2]
---

# P2-04 — RBAC completion: role matrix, audit integration, 403 coverage

- **Phase:** 2 — Alerting
- **Depends on:** P1-08 (permission introduced), P2-03 (all monitoring routes exist)
- **Blocks:** — (end of Phase 2)
- **Estimate:** 0.5 dev-day

## Implementation notes (2026-08-19, soundness review)

1. **`src/permissions.ts` already matches the default matrix exactly — no source change needed.** Verified against the grants: `super_admin` = `Object.values(PERMISSIONS)` (includes `system:monitoring`); `developer` has `system:config` + `audit:read` + `analytics:read` but **not** `system:monitoring`; `content_manager`/`support`/"viewer` have no `system:*` grants. This issue is *proof*, not a grant change: the e2e matrix plus a source-level drift-guard test (asserting `SYSTEM_MONITORING` appears in `ROLES.super_admin.permissions` and in **no** other role's list) lock the matrix. If the review later wants `developer` read-only, that is a `system:monitoring:read`/`:write` split — a new issue, not this one.
2. **The 12 routes (verified in `MonitoringController.registerRoutes`)**: `GET /health`, `GET /health/history`, `GET /providers`, `GET /provider-calls`, `GET /provider-stats`, `GET /metrics`, `GET /alerts`, `GET /alerts/:id`, `POST /alerts/:id/acknowledge`, `GET /config`, `PUT /config`, `GET /rules` (the rule catalog added by the P2-03 addendum — static, 200 on a clean DB, no params).
3. **Deterministic 200s for super_admin**: the six P1-08 read routes return 200 on a clean DB (already proven by the P1-08 suite) — **except `GET /provider-stats` (requires a bounded `from`/`to` window) and `GET /metrics` (requires `name` of a registered metric + `from`/`to`)**, which 400 without params; the matrix supplies a 1-hour window (+ `name=api_request_total`) per request. `GET /alerts/:id` + the ack POST need one seeded `alert_events` row (re-seeded per test via `resetDatabase`); `PUT /config` round-trips the GET'd config unchanged (no-op content, version bumps) → 200.
4. **401 vs 403 ordering**: `checkPermissions` throws `UnauthorizedError` *before* the permission check, so unauthenticated requests get 401 on all 12 routes, never 403.
5. **Audit readability is broad by design**: `audit:read` is granted to *all five roles* (incl. viewer). The "no escalation" guarantee tested here is the inverse: the viewer can read the ack + config audit entries via `GET /api/audit-logs` (action/entityType filters), the config entry's payload is sanitized (`hasUrl: true`, no tokenized URL — the P2-03 PUT that created it carried a token in the webhook URL), and the viewer is still 403 on every monitoring route.
6. **Suite file**: `tests/e2e/monitoring-rbac.test.ts` — the spec's referenced `monitoring.test.ts` does not exist (same correction as P2-03 finding 10). A dedicated file keeps the 11×5 matrix self-contained; P2-03 keeps its own single-viewer 403 test.
7. **Role fixtures**: four non-admin operators with P2-04-specific ids (`developer-p204@…`, `support-p204@…`, `content-manager-p204@…`, `viewer-p204@…`) created once in `before()` (operators survive `resetDatabase`); each logs in via `POST /api/auth/login` for a per-role agent.
8. **Config hygiene**: the audit test's config PUT (webhook with a token) persists across resets — the suite's `after()` restores the clean default config, same pattern as P2-03's suite.
9. **Source-level drift guard** (acceptance "grants match the matrix exactly"): a test asserts `PERMISSIONS.SYSTEM_MONITORING ∈ ROLES.super_admin.permissions` and `∉ ROLES[r].permissions` for all other roles — a future grant drift fails the suite even if the HTTP matrix would still pass.

## Objective

Finalize who can see/change monitoring, and prove it: the `system:monitoring` permission was introduced in P1-08 for the read endpoints; this issue locks the role matrix, verifies audit coverage for every mutating operation, and adds the full 403 matrix.

## Scope

### Modified files
- `src/permissions.ts` — role→permission grants (see matrix below)
- `tests/e2e/monitoring.test.ts` — RBAC suite

## Implementation requirements

### Role matrix (default; overridable in PR review if the user prefers)
| Role | `system:monitoring` (read endpoints) | `system:monitoring` (write: ack, config PUT) |
|---|---|---|
| `super_admin` | ✅ | ✅ |
| `developer` | ❌ (open question Q3 in proposal — **default off**) | ❌ |
| `content_manager` / `support` / `viewer` | ❌ | ❌ |

Implementation note: house RBAC grants whole permission strings per role, not per-method — so if the default is "no one but super_admin", there is nothing to split: one permission, super_admin only. If the matrix review decides `developer` should get read-only access, the permission must be split (`system:monitoring:read` / `system:monitoring:write`) — do that in this issue, not P1-08.

### Audit coverage
Every mutating monitoring operation writes an `audit_logs` row: alert acknowledge (P2-03), config update (P2-03). This issue verifies the entries carry the right `operatorId`, `action`, and entity ids, and that they are themselves readable via the existing audit endpoints (no permission escalation — audit reading follows its own existing rules).

## Acceptance criteria

- [ ] Grants in `src/permissions.ts` match the matrix exactly.
- [ ] 403 matrix test: every monitoring endpoint (12 routes by now: 6 read P1-08 + alerts ×3 + config ×2 + rule catalog ×1) × every role (`super_admin`, `developer`, `support`, `content_manager`, `viewer`) → expected 200/403 asserted, plus 401 unauthenticated on each.
- [ ] Audit entries for ack + config PUT verified (present, correct fields, no secrets in payload).
- [ ] Full e2e suite green.

## Tests

- **E2E:** `tests/e2e/monitoring-rbac.test.ts` (8 tests, implemented 2026-08-19):
  1. Source-level drift guard — `system:monitoring` in `ROLES.super_admin.permissions`, in no other role.
  2. super_admin → 200 on all 12 routes (provider-stats/metrics supplied their required query windows; alert row seeded per test; the matrix is driven by the `ROUTES` table — test titles render `ROUTES.length`).
  3–6. developer / content_manager / support / viewer → 403 on all 12 routes.
  7. Unauthenticated → 401 on all 12 routes.
  8. Audit visibility — viewer reads the `ACKNOWLEDGE_ALERT` + `UPDATE_MONITORING_CONFIG` entries via `GET /api/audit-logs` (correct action/entityType/entityId/userId), config entry sanitized (`hasUrl`, no tokenized URL), viewer still 403 on monitoring routes.

Suite results at implementation time: e2e 1004 passing (1004 = 996 + 8), unit 695, integration 35, build clean.

## Addendum (2026-08-19, P2-03 rule-catalog endpoint)

`GET /api/monitoring/rules` (the P2-03 addendum) became the 12th route under `system:monitoring`. The `ROUTES` matrix table picked it up (super_admin 200 / four roles 403 / unauthenticated 401 — no extra assertions needed: static endpoint, 200 on a clean DB). Test titles now interpolate `ROUTES.length` instead of hardcoding the count, so a future route addition can't silently desync the titles.

## Out of scope

- New roles, per-project monitoring permissions (monitoring is system-wide by design), Console UI authorization (P4-04, same API so same guarantees).
