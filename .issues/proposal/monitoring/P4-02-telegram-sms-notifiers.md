---
title: "P4-02 — Telegram + Twilio SMS alert notifiers"
severity: proposal
status: open
created: 2026-08-17
updated: 2026-08-17
assignee: ""
tags: [monitoring, spec, phase-4]
---

# P4-02 — Telegram + Twilio SMS alert notifiers

- **Phase:** 4 — Polish
- **Depends on:** P2-02 (notifier interface + fan-out)
- **Blocks:** —
- **Estimate:** 0.5 dev-day

## Objective

Two more delivery channels for alerts, both reusing **existing channel provider records** for credentials (no new secret storage): Telegram via a `channel` provider row of type `telegram`, SMS via a `channel` provider row of type `twilio_messaging`.

## Scope

### New files
- `src/services/monitoring/notifiers/TelegramNotifier.ts`
- `src/services/monitoring/notifiers/TwilioSmsNotifier.ts`

### Modified files
- `src/http/contracts/monitoring.ts` — notifier `type` union: add `'telegram' | 'twilio_sms'`; per-type required fields (telegram: `channelProviderId` + `chatId`; sms: `channelProviderId` + `to` (E.164 phone))
- `src/services/monitoring/notifiers/AlertNotifier.ts` — extend the notifier `type` union + factory switch that P2-02 introduced (P1-06's config schema documents the Phase-1 union as `'webhook' | 'email'`; P4-02 is where it widens)
- `src/server.ts` — register both in the notifier factory

## Implementation requirements

- Both implement the P2-02 `AlertNotifier` interface; delivery failure semantics identical (recorded in `alert_events.notifications`, never throw).
- **Telegram:** resolve the `channel` provider row (`providerType='channel'`, `apiType='telegram'`), build the existing Telegram Bot API connection class, `sendMessage(chatId, text, parse_mode: 'HTML')` with a 10 s timeout. Message = severity-emoji + rule name + scope + message body (truncated to 3900 chars — Telegram limit 4096, leave headroom).
- **SMS:** resolve the `twilio_messaging` provider row, use the existing Twilio messaging connection (`messages.create(to, body)`). Body truncated to 320 chars (1 SMS segment), plain text, no links in the body (put nothing fancy — SMS is for paging humans).
- Config validation (zod): `channelProviderId` required for both types; `chatId` string for telegram; `to` matching `^\+[1-9]\d{6,14}$` for sms.
- Wrong provider type in config → delivery recorded as failed with detail `'provider type mismatch: expected telegram, found X'` (same pattern as P2-02 email).

## Acceptance criteria

- [ ] E2E: telegram notifier with a fake Bot API (stubbed transport / local http server) receives fired + resolved messages with correct format/length; SMS notifier with stubbed Twilio client delivers truncated body to the configured number.
- [ ] Misconfigured rows (missing provider, wrong type) → failed delivery recorded, pino error, alert row intact.
- [ ] Config PUT with invalid `chatId`/`to` → 400 (zod).
- [ ] Existing suite green.

## Tests

- **Unit:** message formatting/truncation, validation matrix.
- **E2E:** as acceptance criteria (stubs via container override or local http server).

## Out of scope

- Voice-call alerting, per-chat/number routing beyond one target per notifier (configure multiple notifiers if needed), Telegram topic/thread targeting.
