---
title: "TPC-03 — Call-log integration: test outcomes feed the alert engine's last-signal branch"
severity: proposal
status: open
created: 2026-08-24
updated: 2026-08-24
assignee: ""
tags: [providers, spec, connection-test, phase-3, monitoring]
---

# TPC-03 — Call-log integration + alert interplay

- **Depends on:** TPC-01 (recording), P2-01 as amended 2026-08-24 (last-signal branch, note 20)
- **Blocks:** TPC-05
- **Estimate:** 0.5–1 dev-day

## Objective

Make saved-provider test outcomes first-class signals for the alert engine,
and document the split between on-demand data-plane tests (this feature)
and periodic control-plane probes (Option A).

## Scope

### Modified files

- `src/services/monitoring/AlertRuleEngine.ts` — **verify** (and pin with
  tests) that `queryProviderLastSignals` already treats `*.test` rows like
  any other call-log row (it queries `provider_call_logs` unfiltered by
  operation — expected: no code change). If a change is needed (e.g. a
  `windowStats` exclusion so sparse tests don't skew the 100%-failure
  branch), implement it here and note it.
- `docs/guide/monitoring.md`:
  - "What the provider probes actually measure" section: add the
    data-plane cross-reference — on-demand validation exists via
    `POST /api/providers/test-connection` (TPC-01…03); periodic probes
    remain control-plane by design (Option A).
  - Rule table: `provider-auth-failed` row — extend "resolves only once a
    call **or probe** from the provider succeeds" with "**or a successful
    connection test**".
- `docs/frontend-monitoring-api.md` — endpoint reference section for the
  Console (request/response examples for both modes, error-code table,
  cooldown/429 behavior).
- `.issues/proposal/monitoring/P2-01-alert-rule-engine.md` — implementation
  note: `*.test` rows are valid last-signal sources (operator workflow:
  fix creds → Test → alert clears).

## Implementation requirements

1. Test rows use the production `ProviderCallEntry` shape
   (`operation: '<type>.test'`, real `errorCode`/`statusHttp`/`durationMs`)
   — no schema change, no migration.
2. **Exclusion check (finding to verify in this issue):** the
   `provider-down` 100%-of-recent-calls branch must not be triggered by a
   burst of manual failed tests alone in a window where production traffic
   is healthy. Decide + pin: either (a) tests are already harmless because
   `minSamples: 5` + mixed ok rows dilute the ratio, or (b) `windowStats`
   excludes `operation LIKE '%.test'`. Whichever is chosen, the unit test
   asserts the behavior.
3. Breaker exclusion is already required by TPC-01 (re-verified here at the
   engine boundary, not just the CallLogger boundary).

## Acceptance criteria

- A failed auth test keeps `provider-auth-failed` firing past the window
  (last-signal branch); a successful test auto-resolves it
  (`status 'resolved'`, `resolvedAt` set, after `resolveAfterGoodChecks`
  passes).
- A burst of failed tests on a healthy provider does not open the breaker
  and does not fire `provider-down` via the 100% branch.
- Docs updated and consistent (probe semantics + rule table + API reference).

## Tests

**Unit:** `windowStats` behavior with mixed `*.test` rows (per the chosen
exclusion semantics); last-signal query returns the newest row regardless of
operation (existing query — assert with a `*.test` row as the newest).

**E2E** (extends `tests/e2e/alert-rule-engine.test.ts`):

- seed an aged auth failure (firing via last-signal), then record a failed
  `asr.test` auth row → still firing (message cites the newer test signal);
  then record an ok `asr.test` row → auto-resolves.
- 5 failed `llm.test` rows + 10 ok production rows in window →
  `provider-down` does not fire.

## Out of scope

- New alert rules for test failures (the existing provider rules suffice);
  periodic data-plane probing (TPC-05).
