---
title: "P2-04 — RBAC completion: role matrix, audit integration, 403 coverage"
severity: proposal
status: open
created: 2026-08-17
updated: 2026-08-17
assignee: ""
tags: [monitoring, spec, phase-2]
---

# P2-04 — RBAC completion: role matrix, audit integration, 403 coverage

- **Phase:** 2 — Alerting
- **Depends on:** P1-08 (permission introduced), P2-03 (all monitoring routes exist)
- **Blocks:** — (end of Phase 2)
- **Estimate:** 0.5 dev-day

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
- [ ] 403 matrix test: every monitoring endpoint (11 routes by now: 6 read P1-08 + alerts ×3 + config ×2) × every role (`super_admin`, `developer`, `support`, `content_manager`, `viewer`) → expected 200/403 asserted, plus 401 unauthenticated on each.
- [ ] Audit entries for ack + config PUT verified (present, correct fields, no secrets in payload).
- [ ] Full e2e suite green.

## Tests

- **E2E:** the 403/401 matrix table above (parameterized over routes × roles), audit assertions.

## Out of scope

- New roles, per-project monitoring permissions (monitoring is system-wide by design), Console UI authorization (P4-04, same API so same guarantees).
