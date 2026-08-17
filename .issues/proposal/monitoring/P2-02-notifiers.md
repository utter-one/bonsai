---
title: "P2-02 — Alert notifiers (webhook, email via channel provider)"
severity: proposal
status: open
created: 2026-08-17
updated: 2026-08-17
assignee: ""
tags: [monitoring, spec, phase-2]
---

# P2-02 — Alert notifiers (webhook, email via channel provider)

- **Phase:** 2 — Alerting
- **Depends on:** P2-01 (publisher seam), P1-06 (config)
- **Blocks:** P2-03 (notification visibility in API), P4-02
- **Estimate:** 1 dev-day

## Objective

Deliver alerts out of the process. Webhook first (works with Slack/Discord/PagerDuty/ntfy/Make out of the box), email second — reusing an existing channel provider record so **no new credentials are stored anywhere**.

## Scope

### New files
- `src/services/monitoring/notifiers/AlertNotifier.ts` — interface + `NotifyingPublisher` (wraps P2-01's `LogAndPersistPublisher`)
- `src/services/monitoring/notifiers/WebhookNotifier.ts`
- `src/services/monitoring/notifiers/EmailNotifier.ts`

### Modified files
- `src/server.ts` — construct `NotifyingPublisher` (notifiers from config) and inject as the active publisher
- `src/http/contracts/monitoring.ts` — notifier config validation already in P1-06 schema; add delivery-result type

## Implementation requirements

### Interface
```ts
interface AlertNotifier {
  readonly type: 'webhook' | 'email';
  deliver(event: AlertEvent, phase: 'fired' | 'resolved'): Promise<{ ok: boolean; detail?: string }>;
}
```
- `NotifyingPublisher`: on fire/resolve → persist (P2-01 behavior) then fan out to all **enabled** notifiers with severity ≥ the notifier's `minSeverity` (default `info` = all severities). The notifier list is resolved from `MonitoringConfigService.get()` **on every delivery** — `PUT /config` changes take effect without a restart. Per-notifier 10 s timeout, **1 retry** for webhook on network error only. Delivery results appended to the `alert_events.notifications` jsonb: `[{ notifierId, phase, ok, detail?, at }]`.
- **Never throw, never block the engine**: notifier failures → pino error + recorded result. Alert history is complete even if every notifier is down (PROPOSAL risk §5).

### WebhookNotifier
- POST JSON to configured `url`: `{ event: 'alert_fired' | 'alert_resolved', ruleId, severity, scopeKey, scope, message, context, firedAt, resolvedAt? }`.
- Headers: `Content-Type: application/json`, `User-Agent: bonsai-backend-monitoring/1.0`. No auth header (the URL itself may carry a token — document that; never log the URL).
- Success = 2xx. Non-2xx → `{ ok: false, detail: 'HTTP ' + status }`.

### EmailNotifier
- Config: `channelProviderId` pointing at an existing `providers` row with `providerType='channel'` (sendgrid | ses | smtp-imap). Resolve config via `SecretRefUtils` (same path the channel hosts use) — no new secret storage.
- Reuse the existing connection classes' send methods directly (instantiate per delivery — they're lightweight; do **not** re-enter the channel host's conversation machinery — this is a raw email send, not a conversation). If a connection class doesn't expose a usable raw-send method, extract one into a small shared `src/channels/email/shared/EmailSender.ts` used by both (keep the extraction minimal).
- Subject: `[Bonsai][{SEVERITY}] {rule name} — {scopeKey}`; body: plain text `message` + context summary + firedAt/resolvedAt.
- `to` from notifier config (email address — P1-06's per-type `.refine` already enforces `to: email` + `channelProviderId` for email notifiers).

## Acceptance criteria

- [ ] Webhook: fired + resolved events received by a local HTTP test server with the documented payload shape; non-2xx and connection-refused cases recorded as failed deliveries without affecting the alert row.
- [ ] Email: with an SMTP channel provider fixture (test SMTP sink or mocked transporter), delivery attempt occurs and result is recorded; invalid `channelProviderId` (missing/wrong type) → delivery recorded as failed with a clear detail, pino error.
- [ ] Severity filtering (`minSeverity` = floor, not exact match): a notifier with `minSeverity: 'warning'` receives `warning` and `critical` events but **not** `info`; a `critical`-only-floor notifier receives only `critical`.
- [ ] `alert_events.notifications` always reflects actual delivery attempts (including failures).
- [ ] Engine latency unaffected: a 10 s-hanging webhook does not delay the next rule evaluation — the engine invokes `fire()` **without awaiting** inside the evaluation pass (unhandled-rejection-safe: `fire()` never throws), while the publisher itself awaits all notifiers with a 15 s overall cap before it completes (cap + pino warn on overrun).

## Tests

- **Unit:** notifier selection (enabled/severity filter), payload shape, retry-once-on-network-only logic, timeout cap.
- **E2E:** local webhook receiver (spin a tiny http server in the test) end-to-end via the engine; email with a mocked transporter (stub the connection class via tsyringe override or a test double registered in the container).

## Out of scope

- Telegram/SMS notifiers (P4-02), per-rule notifier overrides (definitively **not** supported — the P1-06 schema reserves no hook; a later need is a separate config-shape change with its own spec; fan-out stays global-per-severity), notification dedup beyond cooldown (already in engine).
