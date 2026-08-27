---
title: "TPC-09 — (Optional) Opt-in periodic data-plane probes for ASR/TTS"
severity: proposal
status: closed
created: 2026-08-24
updated: 2026-08-27
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

## Closed (2026-08-27) — won't do: superseded by the monitoring module

Not implemented, by decision. The periodic provider-availability signal TPC-09
would add is **already provided by the monitoring module's
`HealthCheckService`** on its 60 s cycle (`MONITORING_HEALTH_INTERVAL_MS`),
per `monitoring_config.probeSettings` (P1-05b/P1-06):

- **LLM** — `llmProbe`: `'models'` (`enumerateModels()`) or `'one_token'`
  (1-token `generate()`) on a fresh instance.
- **ASR/TTS** — `asrProbe`/`ttsProbe`: the provider's **zero-cost `ping()`**
  liveness endpoint on a fresh, uninitialised instance.
- **Storage** — `list('', 1)`.
- Providers with **no free liveness endpoint** (Azure ASR/TTS, Cartesia TTS)
  fall back to `provider_call_logs` inference instead of a probe.
- All probe rows are **cooldown-gated** (default 10 min) and feed the same
  `provider-down`/`provider-degraded` alert branches as on-demand tests.

A per-cycle **data-plane** probe (a real ASR streaming session / a short TTS
synthesis) would add vendor cost + session-quota pressure for a marginal
availability signal the zero-cost liveness probes already deliver. Revisit
only if a vendor's liveness endpoint is found to be unreliable as an
availability signal for its data plane.
