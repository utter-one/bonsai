---
title: "Monitoring & Resilience — Issue Specs (index)"
severity: proposal
status: open
created: 2026-08-17
updated: 2026-08-17
assignee: ""
tags: [monitoring, spec, index]
---

# Monitoring & Resilience — Issue Specs

Issue-level breakdown of `specs/PROPOSAL-production-monitoring.md`. One file per implementation step; IDs (`P{phase}-{nn}`) match the filename prefix and are used for cross-referencing in this folder.

## Conventions

- IDs: `P{phase}-{nn}` — matches the filename prefix.
- **Definition of done (every issue):** `npm run build` green, **`npm run test:unit` green**, full e2e suite (`npm run test:e2e`) green, new unit + e2e tests added per the issue's Tests section, no regressions in the ~636 existing e2e tests.
- Unit tests live under `tests/unit/monitoring/*.test.ts` (the unit runner picks up `tests/unit/**/*.test.ts` recursively); e2e suites under `tests/e2e/` per house convention.
- House style is binding: tsyringe DI, Zod + `.describe()` + OpenAPI, controller/service split, `RequestContext` + RBAC on all endpoints, Drizzle migrations only (never `db:push`), one-line pino loggers, `asyncHandler` on handlers.
- Phases are independently shippable; within a phase, respect the dependency arrows below. Arrows list **direct** dependencies only (mirrors each spec's `Depends on` line; `Blocks` lines are the exact inverse).

## Dependency graph

```
Phase 1 (foundation)
  P1-01  (no deps)
  P1-02  ◄── P1-01
  P1-03  ◄── P1-02
  P1-04  ◄── P1-02
  P1-05  ◄── P1-01, P1-02, P1-03
  P1-06  ◄── P1-01, P1-02
  P1-07  ◄── P1-02
  P1-08  ◄── P1-01, P1-02, P1-05, P1-06
  P1-09  ◄── P1-02, P1-05, P1-06
  P1-05b ◄── P1-03, P1-05, P1-06   (gap remediation, 2026-08-19)

Phase 2 (alerting)
  P2-01  ◄── P1-02, P1-03, P1-04, P1-05, P1-07
  P2-02  ◄── P2-01, P1-06
  P2-03  ◄── P2-01, P2-02
  P2-04  ◄── P1-08, P2-03

Phase 3 (failover)
  P3-01  ◄── P1-03
  P3-02  ◄── P1-01
  P3-03  ◄── P3-01, P3-02
  P3-04  ◄── P3-01, P3-02
  P3-05  ◄── P1-03, P3-02
  P3-06  ◄── P2-01, P3-03, P3-04, P3-05

Phase 4 (polish)
  P4-01  ◄── P1-02
  P4-02  ◄── P2-02
  P4-03  ◄── P1-03, P2-03
  P4-04  ◄── P1-08, P2-03, P3-06
  P4-05  ◄── everything
```

## Index

### Phase 1 — Instrumentation & health (foundation)

| ID | File | Title |
|---|---|---|
| P1-01 | [P1-01-db-migration.md](P1-01-db-migration.md) | Monitoring DB migration (7 tables + `providers.fallbacks`) |
| P1-02 | [P1-02-core-infra.md](P1-02-core-infra.md) | Error classification, CallLogger, MetricsRegistry, HeartbeatRegistry, MonitoringContext |
| P1-03 | [P1-03-provider-instrumentation.md](P1-03-provider-instrumentation.md) | Instrument all 3rd-party call sites + streaming phase measurement |
| P1-04 | [P1-04-request-outcome-middleware.md](P1-04-request-outcome-middleware.md) | Request-outcome logging, requestId, API request metrics, pino redaction |
| P1-05 | [P1-05-health-check-service.md](P1-05-health-check-service.md) | HealthCheckService, `/health/ready`, background-service heartbeats |
| P1-05b | [P1-05b-asr-tts-provider-probes.md](P1-05b-asr-tts-provider-probes.md) | ASR/TTS provider liveness probes (closes the P1-05 probe-coverage hole) |
| P1-06 | [P1-06-retention-and-config.md](P1-06-retention-and-config.md) | RetentionService (rollups + purge), MonitoringConfigService |
| P1-07 | [P1-07-rate-limit-instrumentation.md](P1-07-rate-limit-instrumentation.md) | 429 rejection metrics + warn logging in both rate limiters |
| P1-08 | [P1-08-readonly-endpoints.md](P1-08-readonly-endpoints.md) | Read-only MonitoringController endpoints + `SYSTEM_MONITORING` permission |
| P1-09 | [P1-09-graceful-shutdown.md](P1-09-graceful-shutdown.md) | Graceful shutdown (signals, drain, flush, pool close) |

### Phase 2 — Alerting

| ID | File | Title |
|---|---|---|
| P2-01 | [P2-01-alert-rule-engine.md](P2-01-alert-rule-engine.md) | AlertRuleEngine: rules, state machine, hysteresis, default rules |
| P2-02 | [P2-02-notifiers.md](P2-02-notifiers.md) | Alert notifiers (webhook, email via channel provider) |
| P2-03 | [P2-03-alerts-config-api.md](P2-03-alerts-config-api.md) | Alerts + monitoring config API (list/get/ack/PUT config) |
| P2-04 | [P2-04-rbac-completion.md](P2-04-rbac-completion.md) | Role matrix, audit-log integration, 403 coverage |

### Phase 3 — Failover

| ID | File | Title |
|---|---|---|
| P3-01 | [P3-01-circuit-breaker.md](P3-01-circuit-breaker.md) | CircuitBreaker + registry, wired into CallLogger outcomes |
| P3-02 | [P3-02-fallback-resolver-provider-api.md](P3-02-fallback-resolver-provider-api.md) | Fallback chains: validation, resolver, provider API contract |
| P3-03 | [P3-03-llm-failover.md](P3-03-llm-failover.md) | FailoverLlmProvider + ConversationRunner integration |
| P3-04 | [P3-04-tts-asr-storage-failover.md](P3-04-tts-asr-storage-failover.md) | TTS/ASR/storage failover wrappers |
| P3-05 | [P3-05-outbound-channel-fallback.md](P3-05-outbound-channel-fallback.md) | ~~Outbound channel fallback~~ (closed 2026-08-20 — not implemented, reverted) |
| P3-06 | [P3-06-fallback-events-rules.md](P3-06-fallback-events-rules.md) | `fallback_events` endpoint + failover alert rules |

### Phase 4 — Polish

| ID | File | Title |
|---|---|---|
| P4-01 | [P4-01-prometheus-metrics-endpoint.md](P4-01-prometheus-metrics-endpoint.md) | `GET /metrics` Prometheus exposition + token gate |
| P4-02 | [P4-02-telegram-sms-notifiers.md](P4-02-telegram-sms-notifiers.md) | Telegram + Twilio SMS + WhatsApp alert notifiers |
| P4-03 | [P4-03-webhook-dead-letter.md](P4-03-webhook-dead-letter.md) | ~~Webhook dead-letter table + replay endpoint~~ (closed 2026-08-20 — overkill for v1) |
| P4-04 | [P4-04-console-hooks.md](P4-04-console-hooks.md) | Console (separate repo) monitoring page — backend sufficiency check |
| P4-05 | [P4-05-docs-env-load-sanity.md](P4-05-docs-env-load-sanity.md) | Docs, env examples, AGENTS.md, load sanity check |
