---
title: "P4-02 — Telegram + Twilio SMS + WhatsApp alert notifiers"
severity: proposal
status: resolved
created: 2026-08-17
updated: 2026-08-20
assignee: ""
tags: [monitoring, spec, phase-4]
---

# P4-02 — Telegram + Twilio SMS + WhatsApp alert notifiers

- **Phase:** 4 — Polish
- **Depends on:** P2-02 (notifier interface + fan-out)
- **Blocks:** —
- **Estimate:** 1 dev-day (was 0.5 for telegram+sms; +0.5 for WhatsApp)

## Objective

Three more delivery channels for alerts, all reusing **existing channel provider records** for credentials (no new secret storage): Telegram via a `channel` provider row of type `telegram`, SMS via a row of type `twilio_messaging`, WhatsApp via a row of type `whatsapp` (Meta Cloud API).

**Scope decision (2026-08-19, user):** Twilio Voice alerting was analyzed and **rejected** — voice calls are costlier and noisier than text channels; not implemented. (A one-shot TwiML `<Say>` call was the analyzed approach; see channel analysis in the branch history if this is ever revisited.)

## Scope

### New files
- `src/services/monitoring/notifiers/alertMessage.ts` — shared plain-text alert formatter (severity emoji, rule, scope, message, timestamps, truncation)
- `src/services/monitoring/notifiers/ChannelNotifier.ts` — single notifier for all three channels (per-channel strategy table: accepted provider apiType, text budget, recipient field, send). Post-implementation simplification (2026-08-20): the original per-channel class design (TelegramNotifier / TwilioSmsNotifier / WhatsAppNotifier) was consolidated into this one class after a duplication analysis — the three classes shared ~58% byte-identical boilerplate (provider load/validation, secret resolution, timeout, call-log recording, error handling, test seams); only the send differs per channel.

### Modified files
- `src/http/contracts/monitoring.ts` — notifier `type` union: add `'telegram' | 'twilio_sms' | 'whatsapp'`; `to` becomes per-type (email vs E.164); new `chatId` field; per-type required-field `superRefine` (finding 2)
- `src/services/monitoring/notifiers/AlertNotifier.ts` — extend the notifier `type` union + the fan-out dispatch (currently a 2-way ternary — becomes a 5-way map, finding 6)
- `src/server.ts` — no change needed (notifiers are injected into `NotifyingPublisher`'s constructor; the three new ones join it there)

## Implementation requirements

- All three implement the P2-02 `AlertNotifier` interface; delivery failure semantics identical (recorded in `alert_events.notifications`, never throw, 10 s per-delivery timeout like email).
- **Direct sends, not connection reuse (finding 4).** `TelegramConnection.sendMessage` and `TwilioMessagingConnection.sendMessage` swallow errors (catch → log → record → no rethrow) and are gated on the CAL `end_ai_generation_output` message type — a notifier reusing them could never report `{ok: false}`. The notifiers therefore send directly: Telegram/WhatsApp via raw `fetch` to the exact endpoints/requests the connections use, SMS via the `twilio` SDK `messages.create`.
- **Call-log rows (finding 4).** Each notifier records its own `channel.send_message` row via `getProviderCallRecorder()` with the same fields the connections' `recordSend` uses (`providerType: 'channel'`, apiType per provider, `ok`, `statusHttp`, error). A `setCallRecorderForTests` seam on each notifier (default = container accessor) keeps unit tests hermetic. Broken alert channels still feed `provider-degraded`/`provider-down` exactly like normal traffic.
- **Telegram:** resolve the `channel` provider row (`providerType='channel'`, `apiType='telegram'`), parse with `telegramChannelProviderConfigSchema`, `POST https://api.telegram.org/bot{botToken}/sendMessage` with `{chat_id, text}` and a 10 s timeout. Plain text — **no `parse_mode`** (finding 5: `event.message` is free-form error text; escaping for HTML is a bug factory, and the severity emoji conveys the level). Message truncated to 3900 chars (Telegram limit 4096, headroom).
- **SMS:** resolve the `twilio_messaging` provider row, parse with `twilioMessagingChannelProviderConfigSchema`, `messages.create({body, from: config.fromNumber, to: config.to})`. Body truncated to 320 chars (1 SMS segment), plain text. Note: Twilio trial accounts can only send to verified numbers (documented in the notifier JSDoc, not enforced).
- **WhatsApp:** resolve the `whatsapp` provider row, parse with `whatsAppChannelProviderConfigSchema`, `POST https://graph.facebook.com/v17.0/{phoneNumberId}/messages` with `{messaging_product: 'whatsapp', to, type: 'text', text: {body}}` + Bearer `accessToken`. Body truncated to 4000 chars (Meta hard limit 4096 UTF-16 code units, headroom). **Policy caveat (documented in JSDoc, not enforced):** business-initiated conversations outside the 24 h customer-service window require a pre-approved Meta message template — delivery will fail with a Graph API error until one is approved; the failure lands in `alert_events.notifications` like any other.
- **Message format (shared `alertMessage.ts`):**
  ```
  🚨 Bonsai alert: provider-down — provider-down:prov_123
  <event.message>
  fired: 2026-08-19T12:00:00.000Z
  ```
  Severity emoji: critical `🚨`, warning `⚠️`, info `ℹ️`; resolved phase swaps the emoji for `✅` and the word for `resolved`, plus a `resolved:` timestamp line. Truncation cuts the message line (header always intact) and appends `…(truncated)`.
- **Config validation (zod, finding 2):** `to` changes from `z.string().email()` to a plain string with a per-type `superRefine`:
  | type | required | `to` format |
  |---|---|---|
  | `webhook` | `url` | — |
  | `email` | `channelProviderId` + `to` | valid email |
  | `telegram` | `channelProviderId` + `chatId` | — |
  | `twilio_sms` | `channelProviderId` + `to` | E.164 `^\+[1-9]\d{6,14}$` |
  | `whatsapp` | `channelProviderId` + `to` | E.164 `^\+[1-9]\d{6,14}$` |

  Existing env-synthesized notifiers (webhook + email, P1-06) remain valid. **Contract delta for the Console:** `type` enum gains 3 values, `to` is no longer schema-level email (per-type instead), new optional `chatId`.
- **Wrong provider type in config → delivery recorded as failed** with detail `'provider type mismatch: expected <type>, found <apiType>'` (same pattern as P2-02 email). Missing provider → `'channel provider not found: <id>'`.
- **Test seams (finding 8):** `setFetchForTests(fn | null)` on Telegram/WhatsApp (replaces `globalThis.fetch` for the notifier's send only); `setMessagesCreateForTests(fn | null)` on SMS (replaces the Twilio `messages.create` call); `setCallRecorderForTests(rec | null)` on all three. Provider-row read + secret resolution + schema parse stay real in e2e (P2-02 email pattern).

## Acceptance criteria

- [x] E2E: telegram notifier (fetch seam) receives fired + resolved messages with correct format/length; SMS notifier (messages.create seam) delivers truncated body with correct from/to; WhatsApp notifier (fetch seam) delivers to the Graph API URL with correct payload.
- [x] Misconfigured rows (missing provider, wrong type) → failed delivery recorded with the expected detail, pino error, alert row intact.
- [x] Config PUT with invalid `chatId`/`to` (or missing per-type fields) → 400 (zod refine).
- [x] Call-log rows (`channel.send_message`) recorded for ok and failed sends (unit).
- [x] Existing suite green (env-synthesized webhook/email configs still validate).

## Tests

- **Unit** (`tests/unit/monitoring/p4-02-notifiers.test.ts`): per-type config-refine matrix (all 5 types × valid/invalid); message format + truncation (3900/320/4000); per-notifier success/failure/timeout-seam/mismatch/missing-provider; call-log row assertions via the recorder seam.
- **E2E** (`tests/e2e/alert-notifiers-p4-02.test.ts`): real provider rows + real engine (high-memory, `cooldownMinutes: 0`) + the live `NotifyingPublisher` (`__TEST_ALERT_PUBLISHER__`); seams capture the outbound send; assert format, notification ledger rows, mismatch failure, and config-API 400s. Config restored to defaults in `after()` (the row persists across `resetDatabase()`).

## Out of scope

- Voice-call alerting (user decision 2026-08-19 — rejected after analysis; see Objective)
- Per-chat/number routing beyond one target per notifier (configure multiple notifiers if needed)
- Telegram topic/thread targeting; WhatsApp template management (operator must pre-approve the template in Meta Business Manager)
- Env-var fallback for the new types (webhook/email only — P1-06 synthesis unchanged)
- Twilio-via-WhatsApp delivery (a `twilio_messaging` row can already send to `whatsapp:+…` numbers — a possible future `to` prefix, not v1)

## Review findings (2026-08-19, soundness review)

1. **WhatsApp added, voice rejected** — user decision after channel analysis: implement telegram + twilio_sms + whatsapp; twilio_voice explicitly out.
2. **`to` field collision** — the current `notifierConfigSchema.to` is `z.string().email().optional()`; E.164 numbers would fail it. Resolution: plain string + per-type `superRefine` (matrix above). Frontend-visible: `to` is per-type now; new `chatId` field.
3. **E.164 regex** — `^\+[1-9]\d{6,14}$` (spec value kept; matches the ITU-T range used by Twilio/Meta).
4. **Connection reuse is unworkable** — see Implementation requirements. The spec draft said "build the existing connection class"; corrected to direct sends + self-recorded `channel.send_message` rows (identical fields to the connections' `recordSend`).
5. **Telegram plain text** — spec draft said `parse_mode: 'HTML'`; corrected to no parse mode (escaping free-form error text is a bug factory).
6. **Fan-out dispatch** — `NotifyingPublisher.fanOut` currently does `type === 'webhook' ? webhook : email`; becomes a 5-way switch. The `AlertNotifier` interface union widens accordingly.
7. **Truncation budgets** — telegram 3900 (spec), sms 320 (spec), whatsapp 4000 (new; Meta limit 4096).
8. **Test seams** — fetch seam (telegram/whatsapp) + messages.create seam (sms) + call-recorder seam (all three); provider reads stay real in e2e.
9. **WhatsApp policy** — 24 h window / template approval is an operational prerequisite, documented in JSDoc; failed deliveries are observable in `alert_events.notifications` (no special handling).
10. **No env fallback for new types** — P1-06 synthesis is unchanged (webhook/email only); new types are config-only.
11. **minSeverity reuse** — no new floor logic; the publisher's existing `minSeverity` filter applies to the new types unchanged (a `critical`-floor voice alternative was the main use case for voice; operators can set `minSeverity: 'critical'` on any notifier instead).
12. **Twilio SMS from-number** — comes from the provider row's `fromNumber` (the Twilio-owned number), not the notifier config; the notifier config only carries the recipient `to`.

## Implementation notes (2026-08-19)

- **Tests:** 29 unit (`tests/unit/monitoring/p4-02-notifiers.test.ts`: config-refine matrix, message format + truncation, per-notifier success/failure/timeout/mismatch, five-way publisher dispatch) + 6 e2e (`tests/e2e/alert-notifiers-p4-02.test.ts`: real provider rows + live engine + live publisher, fetch/messages.create seams, fired + resolved phases, mismatch failure, config-API 400s).
- **WhatsApp provider rows:** `whatsAppChannelProviderConfigSchema` is a `strictObject` requiring `appSecret` + `verifyToken` even though sending only needs `phoneNumberId` + `accessToken` — fixture rows in tests must include the inbound-only fields.
- **Abandoned sends are unrecorded:** a timeout abandons the in-flight send (same semantics as EmailNotifier), so no `provider_call_logs` row is written for that attempt; the failure is still visible in `alert_events.notifications` (`ok: false`, detail `…timed out…`).
- **`chatId` is any non-empty string** — numeric user id, `@channel` handle, or `-100…` supergroup id (validated at schema level only).
- **Fan-out:** `NotifyingPublisher.notifierFor()` is a 5-way switch (finding 6); the publisher's 15 s cap, minSeverity floor and ledger semantics are unchanged and apply to the new types as-is.
- **Consolidation (2026-08-20, post-implementation analysis):** the three per-channel notifiers were replaced by one `ChannelNotifier` class (strategy table keyed by notifier type). Shared class logic: provider load + apiType validation, `SecretRefUtils` resolution, per-delivery timeout (abandon-on-timeout, no call-log row for abandoned sends), one `channel.send_message` call-log recording implementation (`timedSend`), error→`DeliveryResult` + pino (now with `channelType` in the log line). Per-channel strategy: `apiType`, `label` (timeout message), `textLimit` (3900/320/4000), `recipientField` (`chatId`/`to`), `send` (Bot API fetch / Twilio SDK / Graph API fetch). Publisher DI deps dropped from 7→5 (`channelNotifier` serves three config types). Error detail strings are byte-identical to the pre-consolidation notifiers, so all existing assertions hold. `WebhookNotifier` and `EmailNotifier` deliberately stay separate (webhook: no provider row/secret/call-log, transport retry; email: per-delivery connection transport, connection-level call log, subject + context-JSON body, `SessionManager` dep). One TS 6.0.3 gotcha found during the refactor: an inline arrow is NOT accepted where the contextual property type is a *named alias* of a function type — the `ChannelSendContext.record` property uses an inlined function type on purpose.
