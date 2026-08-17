---
title: "P3-05 — Outbound channel fallback (per-request `fallbackChannelProviderId`)"
severity: proposal
status: open
created: 2026-08-17
updated: 2026-08-17
assignee: ""
tags: [monitoring, spec, phase-3]
---

# P3-05 — Outbound channel fallback (per-request `fallbackChannelProviderId`)

- **Phase:** 3 — Failover
- **Depends on:** P1-03 (call-log rows for channel sends), P3-02 (`FallbackEventService`)
- **Blocks:** P3-06
- **Estimate:** 0.75 dev-day

## Objective

If the caller's outbound channel provider is down (e.g. WhatsApp Graph API outage while Twilio Messaging is healthy), the outbound attempt retries once on a fallback channel the caller specifies alongside — instead of silently dropping the message (SMS) or surfacing a dead-end error (voice call).

**Design note (verified against the codebase):** channel providers are **not** agent-owned. Every outbound endpoint (`POST /api/twilio/messaging/send`, WhatsApp, Telegram, SendGrid, SES, `smtp-imap`, Twilio voice call) receives `channelProviderId` per request (query param or body, API-key auth) and resolves the `providers` row at call time. There is no `agents` channel column to validate a fallback against at write time. The fallback therefore lives **in the request**, next to the primary: `fallbackChannelProviderId`. (An agent-level default column is a possible follow-up — out of scope here.) **No DB migration for this issue.**

## Scope

### New files
- `src/services/channels/OutboundChannelFallback.ts` — validation + single-attempt helper

### Modified files (one handler-level integration each, all behind the shared helper)
- `src/channels/twilio-messaging/TwilioMessagingChannelHost.ts` — `handleOutgoingMessage` accepts optional `fallbackChannelProviderId` (query param, same transport as `channelProviderId`)
- `src/channels/whatsapp/WhatsAppChannelHost.ts` — outbound send handler
- `src/channels/telegram/TelegramChannelHost.ts` — outbound send handler
- `src/channels/email/sendgrid/SendGridChannelHost.ts` / `src/channels/email/ses/SesChannelHost.ts` / smtp-imap outbound handler — send handlers
- `src/channels/twilio-voice/TwilioVoiceChannelHost.ts` — outbound call handler (body field)
- Inbound webhook paths: **unchanged** (inbound has no fallback concept — the webhook arrives where it arrives)

## Implementation requirements

- Each outbound handler validates the optional `fallbackChannelProviderId` **at request time** (400 on any failure):
  - provider row exists;
  - `providerType = 'channel'`;
  - `fallbackChannelProviderId !== channelProviderId` (the primary — checkable now that both are in the request).
- `OutboundChannelFallback.tryFallback({ primaryProviderId, fallbackProviderId, fallbackApiType, operation, payload, context })`:
  - `operation` = `channel.send_message` | `channel.outbound_call`;
  - build the same kind of send call on the fallback provider — dispatch on the fallback row's **`apiType`** (the channel kind; verified apiType strings in tests: `twilio_messaging` | `whatsapp` | `telegram` | `sendgrid` | `ses` | `smtp_imap` | `twilio_voice`); `providerType` is just `'channel'` and carries no dispatch info — the dispatch map is `apiType` → connection class (the same classes each channel host already uses). Payload: message payload for `channel.send_message`, call params for `channel.outbound_call`;
  - **exactly one attempt** (no retry inside the fallback, no second fallback);
  - record a `fallback_events` row via `FallbackEventService` (P3-02): `provider_id`=primary, `fallback_provider_id`=fallback, `operation`, `reason`=primary's errorCode, `project_id`/`conversation_id` from context (null where the endpoint is conversation-less), `success` stamped true only on fallback success;
  - metrics: `fallback_attempts_total{provider_id}`, `fallbacks_executed_total{provider_id}` (executed = actually attempted).
- Semantics per operation:
  - **send_message:** fallback success → message delivered (idempotency note: if the primary *actually* delivered despite a client-side timeout, the user gets the message twice — accepted trade-off, documented; SMS is the main case). Fallback failure → original primary error surfaces (response unchanged: 502 for the call endpoint, conversation `markAsFailed` path for message-driven conversations).
  - **outbound_call:** fallback success → call connects on the other channel; the session/conversation bootstrap that normally stores the initiating channel provider receives the **fallback** provider id, so the conversation's metadata reflects the channel actually in use for the session's duration. Fallback failure → 502 as today.
- Call-log rows: primary attempt (P1-03, `ok=false`) + fallback attempt (same `operation`, `fallback_provider_id` set) — no new logging code, the helper passes the right provider id.
- Without `fallbackChannelProviderId` in the request: behavior **byte-identical** to today (primary failure surfaces exactly as it does now).

## Acceptance criteria

- [ ] All 6 outbound endpoints accept the optional field; invalid fallback (missing provider / wrong type / same as primary) → 400 with a clear message; OpenAPI documents the field on all 6.
- [ ] E2E: primary SMS provider with bad credentials + `fallbackChannelProviderId` pointing to a (also bad-credentials) provider → outbound send → 2 `channel.send_message` call-log rows + 1 `fallback_events` row (`success=false`) + original 502 surfaced.
- [ ] E2E: primary fails, fallback = working channel double (connection-class stub) → message delivered via fallback, `fallback_events.success=true`, 200 to the caller.
- [ ] E2E (voice): primary `calls.create` fails (bad auth token), fallback voice provider works → call connected, session metadata carries the fallback provider id.
- [ ] No fallback param → existing channel e2e tests green unchanged.
- [ ] Inbound webhook handling untouched (no code path change).

## Tests

- **Unit:** fallback validation matrix (missing / wrong type / same-as-primary), helper dispatch per `apiType`, single-attempt guarantee, event + metric recording.
- **E2E:** as acceptance criteria (channel doubles at the connection-class level: bad credentials for the failure path, stubbed success for the fallback path).

## Out of scope

- Agent-level fallback default column (follow-up — needs a decision on where per-agent channel preferences would live), inbound fallback, multi-hop channel fallback, per-project channel fallback, channel health probes (channels are inferred from call logs, P1-05).
