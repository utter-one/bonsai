---
title: "Provider Connection Testing — Issue Specs (index)"
severity: proposal
status: open
created: 2026-08-24
updated: 2026-08-24
assignee: ""
tags: [providers, spec, index]
---

# Provider Connection Testing — Issue Specs

Issue-level breakdown of `PROPOSAL-provider-test-connection.md` (repo root).
On-demand "test connection" for each provider type, using the **same
communication protocol as the provider's main functionality** (the provider's
own production code path) to verify authentication and availability.

## Conventions

- IDs: `TPC-{nn}` — matches the filename prefix.
- **Definition of done (every issue):** `npm run build` green, `npm run test:unit`
  green, full e2e suite (`npm run test:e2e`) green, new unit + e2e tests per
  the issue's Tests section, no regressions.
- Unit tests live under `tests/unit/providers/*.test.ts`; e2e suites under
  `tests/e2e/` (house convention).
- House style is binding: tsyringe DI, Zod + `.describe()` + OpenAPI,
  controller/service RBAC split, `RequestContext`, Drizzle migrations only,
  one-line pino loggers, `asyncHandler` on handlers.
- Prerequisite line: `advanced-monitoring` (P1-03 call logs, P1-05b probes,
  P2-01 alert engine incl. the 2026-08-24 last-signal branch).

## Dependency graph

```
TPC-01  (no new deps)
TPC-02  ◄── TPC-01
TPC-03  ◄── TPC-01
TPC-04  ◄── TPC-01
TPC-05  ◄── TPC-01, TPC-03     (optional, opt-in)
```

Phases are independently shippable: TPC-01+02+03 ship the LLM/ASR/TTS/storage
feature end-to-end; TPC-04 adds channel providers; TPC-05 is a monitoring
opt-in and may be deferred.
