---
title: "TPC-07 — Call-log integration and alert-engine interplay"
severity: proposal
status: open
created: 2026-08-24
updated: 2026-08-24
assignee: ""
tags: [providers, spec, connection-test, phase-2, monitoring]
---

# TPC-07 — Call-log rows + alert interplay + docs

- **Depends on:** TPC-01
- **Blocks:** TPC-09
- **Estimate:** 0.5–1 dev-day

## Objective

Make test outcomes first-class in the shipped monitoring pipeline:
`provider_call_logs` rows (feeding the P2-01 last-signal branch), no
breaker influence, and accurate docs.

## Scope

### Modified files

- `src/services/monitoring/CallLogger.ts` — (already in TPC-01) verify the
  breaker-feed exclusion and add the test-row attribution;
- `docs/guide/monitoring.md` —
  - new section: "Testing connections" (endpoint, semantics, cost);
  - Option A (data-plane note) updated to point at the on-demand tester:
    *"The on-demand connection test (POST /api/providers/test-connection)
    exercises the real data plane (ASR/TTS). The 60 s probe deliberately
    stays on the control plane; TPC-09 offers an opt-in periodic
    data-plane probe."*
- `docs/frontend-monitoring-api.md` — the new endpoint in the API
  reference (response shape, guard errors, cooldown).

## Implementation requirements

1. **Row attribution (saved tests only):** `operation =
   '<providerType>.test'` (e.g. `llm.test`, `asr.test`); `model`,
   `statusHttp`, `errorText`, `ok`, `errorCode` filled exactly as for
   production calls; `fallbackProviderId` null.
2. **Last-signal branch interplay:** the 2026-08-24
   `provider-auth-failed` last-signal branch (P2-01 note 20) reads the
   provider's most recent `provider_call_logs` row (24 h lookback). A
   failed test with `errorCode 'auth'` keeps the alert firing after the
   5-min window empties; a successful test auto-resolves it. **No alert
   code changes** — the row is an ordinary row.
3. **Windowed branches stay clean:** test rows are rare (5 s cooldown,
   manual) and `minSamples` guards the percentage branches
   (`provider-down` / `provider-degraded`) — verified, not enforced.
4. **Breaker:** test rows never feed it (TPC-01 guard — assert in the
   integration test).
5. **Draft tests:** no row (no providerId to attribute).

## Acceptance criteria

- The alert engine's documented interplay (above) is reproduced by an
  e2e test, not just asserted.

## Tests

**E2e** (extend `tests/e2e/alert-rule-engine.test.ts` patterns — app-world
`__TEST_CALL_LOGGER__` + engine globals, rows aged via SQL):

- saved LLM test with `auth` failure → `provider-auth-failed` fires via
  the last-signal branch even with the window empty;
- then a successful test → the alert auto-resolves
  (`status 'resolved'`, `resolvedAt` set, after
  `resolveAfterGoodChecks` passes);
- 5 failed `*.test` rows → breaker stays closed (app-world
  `__TEST_BREAKER_REGISTRY__`);
- draft test → zero rows in `provider_call_logs`.

**Docs:** VitePress build passes (no bare `{{ }}`).

## Out of scope

- New alert rules (none needed), windowStats code changes (none needed —
  verified by tests), channel rows (TPC-08), periodic probes (TPC-09).
