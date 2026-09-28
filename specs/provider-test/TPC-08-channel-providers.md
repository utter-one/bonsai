---
title: "TPC-08 — Channel provider strategies: same-protocol auth checks, zero side effects"
severity: proposal
status: resolved
created: 2026-08-24
updated: 2026-08-27
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

## Resolution (2026-08-27)

Implemented as a **per-`apiType` sub-strategy table** in
`src/services/providers/connectionTest/channelStrategy.ts` (the spec's
`strategies/channel.ts` path — the `strategies/` subdir was removed in the
base-class refactor). Channels are config schemas (no provider class), so
there is no base-class `testConnection()` to own; the tester's `case
'channel'` dispatches to `testChannelConnection(apiType, config)` and records
the `channel.test` row directly via the `CallLogger` (the row's `errorCode` is
the sub-strategy's classified code; the `CallLogger`'s connection-test guard
excludes it from the breaker). `protocol` is set by the tester
(`http` / `sdk` / `smtp`).

Deviations from the draft, each verified against the codebase:

1. **File location** — `channelStrategy.ts` in the `connectionTest/` dir (the
   `strategies/` subdir was deleted in the base-class refactor).
2. **whatsapp** — the codebase's `WhatsAppConnection` uses the **Meta Graph
   API** (`GET {graph}/v17.0/{phoneNumberId}`, `Bearer accessToken`), *not*
   Twilio. Tested those credentials (the spec anticipated this: "if it uses
   different credentials, test those").
3. **ses** — the codebase uses **SESv1** (`@aws-sdk/client-ses` `SESClient`),
   not SESv2. The credential check is SESv1 `ListIdentitiesCommand` (1 free
   call, no side effects) in place of the spec's "SESv2 `GetAccount`". 401/403
   (or the AWS auth error names) → `auth`.
4. **smtp-imap** — SMTP via `nodemailer` `createTransport().verify()`
   (connect → `EHLO` → `AUTH PLAIN` → `QUIT`, **no `MAIL FROM`**); IMAP via a
   raw socket (`LOGIN` → `LOGOUT`, no folders opened) — a raw socket is
   cleaner + transcript-capturable than the production `imap` library (same
   protocol). `phase` is the furthest reached; `detail`
   `{ smtp: 'ok'|'error', imap: 'ok'|'error'|'not-configured' }`.
5. **Test seam** — `setChannelApiBaseForTests` is **`globalThis`-backed**
   (`__TEST_CHANNEL_API_BASE__`) so it crosses the tsx/ESM-vs-CJS module graph
   boundary: the unit world and the e2e (test) world can point the app-world
   channel strategy at a local fake server without importing the app-world
   module.
6. **E2e** — the saved/draft telegram tests run against a **local fake** Bot
   API (401 for `getMe`) via the seam, not the real `api.telegram.org` —
   CI-safe, no external network, and it exercises the full path (endpoint →
   tester → sub-strategy → `auth` → structured result).
