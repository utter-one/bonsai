---
title: "P1-09 — Graceful shutdown"
severity: proposal
status: open
created: 2026-08-17
updated: 2026-08-17
assignee: ""
tags: [monitoring, spec, phase-1]
---

# P1-09 — Graceful shutdown

- **Phase:** 1 — Instrumentation & health
- **Depends on:** P1-02 (flush hooks), P1-05 (HealthCheckService `stop()` in the sequence)
- **Blocks:** — (independent; do last in Phase 1 so flush targets exist)
- **Estimate:** 0.5 dev-day

## Objective

Today there are **no `SIGTERM`/`SIGINT` handlers** — a `docker compose stop` or k8s rolling deploy kills active WebSocket/voice conversations mid-sentence and loses buffered monitoring data. Add an orderly shutdown sequence.

## Scope

### New files
- `src/utils/shutdown.ts` — `installShutdownHandlers(deps)` (keeps `src/index.ts` thin)

### Modified files
- `src/index.ts` — install handlers after `startServer`
- All six background services — **verified: all six already expose a public `stop(): void`** (`ConversationTimeoutService`, `ScenarioRunExecutorService` in `src/services/testing/`, `BenchmarkExecutorService`, `ImapInboundService`, `OAuth2TokenRefreshService`, `ProcessingDeferralService`) — nothing to add, just call them in the shutdown sequence
- `src/channels/websocket/WebSocketChannelHost.ts` — extend the existing `close()` (today it only closes the WSS server) to also explicitly close each tracked active socket with code 1001 "going away" before closing the server
- `src/channels/twilio-voice/TwilioVoiceChannelHost.ts` — close active media-stream connections + cancel pending outbound-call bookkeeping

## Implementation requirements

Sequence on first `SIGTERM`/`SIGINT` (idempotent — second signal forces `process.exit(1)`):

1. Log `shutting down` (info) with signal name.
2. Stop the six background services (`stop()` each) — no new work starts.
3. Stop `HealthCheckService` loop.
4. Stop accepting new HTTP connections (`server.close()`) — in-flight requests finish.
5. **Drain**: close WebSocket + Twilio voice connections, giving active conversations up to `SHUTDOWN_GRACE_MS` (env, default 10000) to finish their current turn; then force-close the remainder (pino warn with count).
6. **Flush**: `await CallLogger.flushNow()` + `MetricsRegistry.flushNow()` (bounded 5 s each).
7. Close the pg pool (expose `endPool()` from `src/db/index.ts`).
8. `process.exit(0)`.

Hard outer timeout: 30 s from signal to `process.exit(1)` regardless of where it's stuck (timer set at signal receipt, cleared on clean exit).

## Acceptance criteria

- [ ] `docker compose stop backend` (or `kill -TERM <pid>`) produces the ordered log lines: services stopped → connections closed → buffers flushed (0 pending) → pool closed → exit 0, with total time < `SHUTDOWN_GRACE_MS` + 5 s when idle.
- [ ] An active WebSocket conversation at signal time is closed with 1001 and its in-flight turn completes or is force-closed at the grace deadline — no dangling `pg` handles, no hung process (verified in a manual smoke test, documented in PR description).
- [ ] Second signal during shutdown exits 1 immediately.
- [ ] No effect on normal startup or the e2e suite (handlers installed only in `src/index.ts`, not in `createApp()` — tests don't trigger them).

## Tests

- **Unit:** shutdown sequence with stubbed deps (each step called in order; double-signal behavior; hard timeout fires).
- **Manual smoke (recorded in PR):** `docker compose up` → open a WS conversation → `docker compose stop` → assert log order + no crash loop on restart.

## Out of scope

- PreStop hooks / k8s manifests (deploy concern), draining the DB pool of idle-only connections before step 4 (unnecessary), in-flight Twilio call teardown via Twilio API (best-effort local close is enough; the call simply ends).
