---
title: "TPC-05 — (optional) Periodic data-plane probes: opt-in `asrProbe: 'session'` / `ttsProbe: 'synth'`"
severity: proposal
status: open
created: 2026-08-24
updated: 2026-08-24
assignee: ""
tags: [providers, spec, connection-test, phase-5, monitoring, optional]
---

# TPC-05 — Periodic data-plane probes (opt-in)

- **Depends on:** TPC-01 (strategies), TPC-03 (recording + docs)
- **Blocks:** (none)
- **Estimate:** 1 dev-day
- **Status note:** optional / deferrable — ships only if operators ask for
  idle-provider data-plane coverage; defaults stay control-plane (Option A).

## Objective

Let an operator **opt in**, per `monitoring_config.probeSettings`, to running
the TPC-01 data-plane test on the probe cadence for ASR/TTS — closing the
last idle-provider gap ("probe ok ≠ data plane ok") for accounts whose
session quota tolerates it.

## Scope

### Modified files

- `src/http/contracts/monitoring.ts` — `probeSettingsSchema`:
  `asrProbe: 'session' | 'free' | 'off'` (default `'free'`),
  `ttsProbe: 'synth' | 'free' | 'off'` (default `'free'`). Full-replacement
  PUT semantics + optimistic locking unchanged.
- `src/services/monitoring/HealthCheckService.ts` — `maybeProbe()`: when the
  setting is `'session'`/`'synth'`, run the corresponding TPC-01 strategy
  (fresh instance, same cooldown) instead of `ping()`; probe failure
  accounting (`probeFailures`) unchanged — a failed data-plane probe counts
  exactly like a failed control-plane probe (3 consecutive →
  `provider-down` probe branch).
- `docs/guide/monitoring.md` — probe settings table + the Option A section
  gains the opt-in explanation and the quota warning.
- `.issues/proposal/monitoring/P1-05b-asr-tts-provider-probes.md` — note:
  opt-in data-plane probes shipped as TPC-05.

## Implementation requirements

1. **Defaults never change:** `'free'` stays the default; a fresh install
  behaves exactly as today (Option A stands by default).
2. **Quota protection:** the existing per-provider probe cooldown applies
  unchanged; additionally, a `'session'`/`'synth'` probe that fails with
  `rate_limited` does **not** increment `probeFailures` (a quota hit is not
  a down signal — it would otherwise convert a rate-limit into a false
  `provider-down`); the check is marked `degraded` with
  `detail.reason 'probe rate-limited'` instead.
3. Data-plane probe rows reuse the TPC-01/03 recording
  (`operation 'asr.test'` / `'tts.test'` — they are the same test, just
  scheduled); last-signal semantics unchanged.
4. LLM/storage already probe the real work path (`one_token` / `list`);
  no change for those types.

## Acceptance criteria

- `asrProbe: 'session'` on a provider with valid creds: check `ok` via the
  WS session path; with broken creds: 3 consecutive failures →
  `provider-down` probe branch fires (existing rule, no change).
- A `rate_limited` data-plane probe does not trip the probe-failure counter.
- Default config → zero behavior change (e2e asserts the probe still calls
  `ping()` under `'free'`).

## Tests

**Unit:** `maybeProbe` dispatch — `'session'`/`'synth'` → strategy,
`'free'` → `ping()`, `'off'` → skip; `rate_limited` outcome does not
increment `probeFailures`.

**E2E:** config switch to `'session'` for a provider whose ASR strategy is
stubbed in the app-world test seam → health snapshot reflects the
data-plane outcome; flip back to `'free'` → `ping()` path again.

## Out of scope

- Per-provider (vs global) probe-mode override (the global setting is v1;
  per-provider is a follow-up if requested); per-minute session quotas
  tracking/adaptation (fixed cooldown only).
