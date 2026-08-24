---
title: "TPC-08 — Channel provider strategies: same-protocol auth checks, zero side effects"
severity: proposal
status: open
created: 2026-08-24
updated: 2026-08-24
assignee: ""
tags: [providers, spec, connection-test, phase-3, channels]
---

# TPC-08 — Channel provider strategies

- **Depends on:** TPC-01, TPC-06
- **Blocks:** (none)
- **Estimate:** 1 dev-day

## Objective

`providerType 'channel'` strategies — one per apiType — verifying
credentials/availability **over the provider's own protocol** with zero
side effects. Channels have no data-plane stream, so "same protocol" = the
vendor API / SMTP / IMAP path the channel uses in production.

## Scope

### New files

- `src/services/providers/connectionTest/strategies/channel.ts` —
  sub-strategies keyed by `apiType` (registered for
  `providerType 'channel'`).

### Modified files

- `src/services/providers/channel/...` — only if a connection class needs a
  small public test hook (e.g. `testCredentials()`); prefer calling
  existing methods.

## Implementation requirements

1. **telegram** (`https`, `protocol 'http'`): Bot API `getMe` (1 call, free).
2. **twilio-messaging / twilio-voice** (`https`): REST `GET
   /2010-04-01/Accounts.json` with the account SID + auth token (1 call,
   free). Both apiTypes share the account credentials — same result for
   both.
3. **whatsapp** (`https`): same Twilio account check as
   twilio-messaging (the WhatsApp channel is Twilio-backed in this codebase)
   — verified against `WhatsAppConnection` at implementation time; if it
   uses different credentials, test those.
4. **sendgrid** (`https`): `GET /api/v3/` (account info; 401 on bad key).
5. **ses** (`sdk`): `SESv2 GetAccount` (1 call, free).
6. **smtp-imap** (`smtp` + `imap`, two phases, both optional):
   - SMTP: connect to `host:port` (TLS per config) → `EHLO` → `AUTH`
     (PLAIN/LOGIN per config) → `QUIT`. **No MAIL FROM, no message sent.**
   - IMAP: connect → `LOGIN` → `LOGOUT`. No folders opened, no flags set.
   - `phase: 'auth'` after the successful `AUTH`/`LOGIN`;
     `detail: { smtp: 'ok'|'skipped'|error, imap: … }`.
7. Side-effect rule (absolute): no message, email, webhook payload, or
   session created. A channel test that would send anything is a defect.
8. `protocol` per sub-strategy: `http` (telegram, twilio-*, whatsapp,
   sendgrid), `sdk` (ses), `smtp`/`imap` (smtp-imap — result reports the
   combined outcome; `phase` is the furthest reached).

## Acceptance criteria

- Zero side effects (review + test-asserted).
- Every apiType covered; a missing sub-strategy → `InvalidOperationError`
  (not a crash).

## Tests

**Unit** (`tests/unit/providers/connection-test-channels.test.ts`, no
network):

- telegram/twilio/sendgrid: fake HTTPS server — 200 → ok; 401/403 →
  `auth`;
- ses: stubbed SDK client — success → ok; `InvalidClientTokenId` →
  `auth`;
- smtp-imap: local fake SMTP (`smtp-server` package or raw socket) —
  AUTH ok → `phase 'auth'`; wrong password → `ok:false 'auth'`;
  fake IMAP LOGIN success/failure;
  **assert no `MAIL FROM` / `A001 SELECT` ever sent** (capture the socket
  transcript).

**E2e** (`tests/e2e/provider-connection-test.test.ts`): saved telegram
provider with a bogus token → 200 `ok:false, errorCode 'auth'`.

## Out of scope

- Outbound-channel fallback (closed P3-05), channel health in the 60 s
  cycle (not part of this plan).
