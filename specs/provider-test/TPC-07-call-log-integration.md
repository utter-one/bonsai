---
title: "TPC-07 — Call-log integration and alert-engine interplay"
severity: proposal
status: resolved
created: 2026-08-24
updated: 2026-08-26
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

## Resolution (2026-08-26)

No source changes were needed. The CallLogger attribution (operation
`<type>.test`, breaker feed excluded for any `operation`/context ending in
`.test`) shipped in TPC-01; the alert engine's last-signal branch shipped in
P2-01. TPC-07 is the verification + docs spec, and the interplay is now
proven end-to-end:

- **`tests/e2e/provider-connection-test-monitoring.test.ts`** (3 e2e tests,
  reuses the app-world seams from `alert-rule-engine.test.ts`):
  1. **Last-signal interplay** — a saved ollama LLM test against a stateful
     local server (401 → then 200): the failed auth test records an ordinary
     `llm.test` row; the row is aged 30 min (outside the 5-min rule window,
     so the windowed auth count is 0 and only the last-signal branch can fire
     — proving the branch, not the window); `provider-auth-failed` fires
     (`message` contains "last observed signal", `context.lastSignalErrorCode
     === 'auth'`); a successful test then auto-resolves it. No alert code
     changes.
  2. **Breaker exclusion** — 5 failed `*.test` rows (inserted via the
     app-world `CallLogger.record`) leave the provider's breaker **not open**;
     a control (5 failed non-test rows on a different provider) **does** open
     it — proving the `.test` exclusion specifically.
  3. **Draft zero rows** — a draft `storage/local` test leaves **zero** rows
     in `provider_call_logs` (un-stamped instances record nothing).

  Cross-test hygiene: the CallLogger's in-memory buffer survives
  `resetDatabase()`, so `beforeEach` does `flushNow()` then `resetDatabase()`
  so row-count assertions are not polluted by other suites.

- **Docs** — `docs/guide/monitoring.md`: new *On-demand connection tests*
  subsection (endpoint, semantics, cost, call-log/breaker/audit interplay)
  + the *data-plane liveness* note now points at the tester (60 s probe stays
  on the control plane; TPC-09 is the opt-in periodic data-plane probe).
  `docs/guide/monitoring-api.md`: new §4.14 cross-reference for
  `POST /api/providers/test-connection` (response shape, guard errors,
  cooldown, monitoring interplay). VitePress build passes.

## Out of scope

- New alert rules (none needed), windowStats code changes (none needed —
  verified by tests), channel rows (TPC-08), periodic probes (TPC-09).
