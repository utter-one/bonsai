---
title: "P4-03 — Webhook dead-letter table + replay endpoint"
severity: proposal
status: open
created: 2026-08-17
updated: 2026-08-17
assignee: ""
tags: [monitoring, spec, phase-4]
---

# P4-03 — Webhook dead-letter table + replay endpoint

- **Phase:** 4 — Polish
- **Depends on:** P1-03 (webhook call sites + call-log rows), P2-03 (API conventions)
- **Blocks:** —
- **Estimate:** 1.5 dev-days

## Objective

When inbound webhook processing throws after signature validation (bug, transient DB blip, unhandled provider error), the payload is currently lost with a 500 to the carrier (which may or may not retry). Capture failed payloads in a dead-letter table with an operator-triggered replay.

## Scope

### New files
- `src/services/monitoring/WebhookDeadLetterService.ts`

### Modified files
- `src/db/schema.ts` + **own migration** (next free number at `db:generate` time — `0069` if P1-01's `0068` is the latest when this lands; rule: one feature per migration file):
  - `webhook_failures`: `id text pk`, `channel text` (`whatsapp`|`telegram`|`twilio_voice`|`twilio_messaging`|`email`), `channel_provider_id`, `project_id text null`, `payload jsonb notNull`, `error text`, `received_at timestamp`, `status text notNull default 'new'` (`new`|`replayed`|`discarded`), `replayed_at timestamp null`, `replayed_by text null`. Indexes: `(status, received_at)`, `(received_at)`.
- Channel hosts — capture point in each inbound handler's catch block (the one that currently returns 500):
  - `src/channels/whatsapp/WhatsAppChannelHost.ts`, `src/channels/telegram/TelegramChannelHost.ts`, `src/channels/twilio-voice/TwilioVoiceChannelHost.ts` (webhook leg), `src/channels/twilio-messaging/*` webhook, email IMAP inbound is **excluded** (polling, retried next cycle — no dead-letter needed).
- `src/http/controllers/MonitoringController.ts` — two routes
- `src/http/contracts/monitoring.ts` — schemas

## Implementation requirements

### Capture
- Only **unhandled processing errors** (post signature-validation) are captured; signature failures (401/403) and validation failures (400) are not (they're expected carrier behavior, and spamming the dead-letter with forged payloads is a DoS vector — bound the table: capture capped at 10k rows; when full, discard oldest `discarded`-eligible rows + pino error).
- Capture is best-effort: if the insert itself fails (DB down), pino error with the payload truncated to 2KB — never mask the original 500.
- Payload stored as received (parsed JSON body + relevant headers minus auth-sensitive ones; **decision:** no signature headers are stored — instead a sha256 of the raw body as `payload_hash` for referenceability).

### Replay
- `POST /api/monitoring/webhook-failures/{id}/replay`: re-injects the stored parsed body into the **same internal processing function** the webhook handler calls (each host must expose `processInbound(parsedBody, meta): Promise<void>` — extract the handler body behind that seam in this issue; the HTTP handler becomes validate-signature → `processInbound`). Sets `status='replayed'`, `replayed_at`, `replayed_by`. **Decision (replay failure):** the enum stays 3-valued (`new|replayed|discarded`) — on replay failure the row returns to `status='new'` with `error` updated to the new error + pino error (it is not `discarded` — nobody decided it unprocessable).
- `POST /api/monitoring/webhook-failures/{id}/discard`: `status='discarded'` (operator decided it's unprocessable).
- `GET /api/monitoring/webhook-failures`: `listParamsSchema` + `status`/`channel` filters, newest first.
- All three routes: `system:monitoring` permission.

### Idempotency note (documented in code + P4-05 docs)
Replay may duplicate side effects if the original attempt partially executed (e.g. conversation created but message not persisted). Conversation-level idempotency is out of scope; replay is a best-effort operator tool, and the stored payload hash lets ops check for duplicates.

## Acceptance criteria

- [ ] Forced processing error in a webhook handler (test double that throws in `processInbound`) → 500 returned to carrier + row in `webhook_failures` with payload + error.
- [ ] Replay of a now-healthy payload → side effect occurs exactly once more, row `replayed` with operator stamped; replay while still broken → row back to `new` with updated error.
- [ ] Discard works; 404 on unknown id; RBAC 401/403 as with the rest.
- [ ] Signature-failure webhooks do NOT create dead-letter rows.
- [ ] Table bound at 10k (unit test with synthetic overflow).
- [ ] Existing channel e2e suites green (seam extraction changes no behavior).

## Tests

- **Unit:** capture cap/overflow, replay status transitions, payload_hash computation.
- **E2E:** full capture → replay → success flow per at least 2 channel types (whatsapp + telegram, via their existing e2e fixtures), discard, RBAC, 404.

## Out of scope

- Automatic retry policy (operator-triggered only — matches the proposal), consumer-side dedup/idempotency keys. **Webhook alert rules are follow-ups after this issue lands** (not part of it — the `webhook_failures` table does not exist until P4-03 merges, so they cannot ship with P3-06's Phase-3 rule set either): candidate `webhook-dead-letter` (warning, ≥5 `webhook_failures` rows in 10 min) and `webhook-failures` (warning, 5xx on `channel.webhook` call-log rows in 10 min).
