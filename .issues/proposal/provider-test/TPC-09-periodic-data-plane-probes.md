---
title: "TPC-09 — (Optional) Opt-in periodic data-plane probes for ASR/TTS"
severity: proposal
status: open
created: 2026-08-24
updated: 2026-08-24
assignee: ""
tags: [providers, spec, connection-test, phase-3, monitoring, optional]
---

# TPC-09 — (Optional) Opt-in periodic data-plane probes

- **Depends on:** TPC-03, TPC-04, TPC-07
- **Blocks:** (none)
- **Estimate:** 1 dev-day

## Objective

Optionally extend HealthCheckService so ASR/TTS providers can be probed on
their **real data plane** on the 60 s cycle — reusing the TPC-03/TPC-04
strategies — while **keeping Option A's default (control-plane) intact**.

## Scope

### Modified files

- `src/services/monitoring/HealthCheckService.ts` — a
  `dataPlaneProbe(provider)` path calling the ASR/TTS strategies (fresh
  instance, bounded timeout, own per-provider cooldown).
- `src/http/contracts/monitoring.ts` — `probeSettingsSchema`:
  `asrProbe`/`ttsProbe` gain an extra enum value
  (`'data_plane'`), **default stays `'off'`/control-plane**.
- `docs/guide/monitoring.md` — probe-semantics section updated: the
  `data_plane` mode exists, is off by default, and why (session-creation
  rate limits, per-session cost).

## Implementation requirements

1. **Default off.** No behavior change for existing deployments.
2. When enabled per provider (`monitoring_config.probeSettings.asrProbe =
   'data_plane'`): one streaming session + silence per cycle (ASR) / one
   2–3 word synthesis per cycle (TTS), bounded by a per-provider cooldown
   (default ≥ 10 min, configurable) so the 60 s tick never hammers the
   vendor's session quota.
3. Outcomes recorded as `asr.probe`/`tts.probe` rows
   (`operation` suffix `.probe`, distinct from `.test`) feeding the
   last-signal branch; probe failures increment the existing
   `probeFailures` counter (the `provider-down` probe branch keeps
   working).
4. Cost guard: the config UI/contract documents the per-cycle cost
   (one short ASR session ≈ 0.5 s of audio; one short TTS synthesis ≈ 1 ¢
   of audio at most).
5. A `data_plane` probe failure must not be classified as `auth` unless
   the vendor says so (session-limit 429 → `rate_limited`, not
   `auth`).

## Acceptance criteria

- With default config, zero data-plane probes run (e2e-asserted).
- With the opt-in, a dead ASR endpoint flips the provider check to
  `down` via the existing `probeFailures` path within 3 cycles.

## Tests

**Unit** (`tests/unit/monitoring/p1-05b-probes.test.ts` extension):
`data_plane` mode with a fake WS server — ok on first-data; 401 →
`auth`; 429 → `rate_limited`.

**E2e** (`tests/e2e/health-check.test.ts` extension): default config →
no data-plane rows in `provider_call_logs`; opt-in config with a dead
endpoint → provider check `down` after 3 cycles + `asr.probe` rows.

## Out of scope

- Making `data_plane` the default (revisiting Option A), mid-stream
  quality assertions.
