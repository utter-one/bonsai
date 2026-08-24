---
title: "TPC-04 — Channel provider connection tests (telegram, twilio, whatsapp, sendgrid, ses, smtp-imap)"
severity: proposal
status: open
created: 2026-08-24
updated: 2026-08-24
assignee: ""
tags: [providers, spec, connection-test, phase-4, channels]
---

# TPC-04 — Channel provider tests

- **Depends on:** TPC-01 (strategy seam)
- **Blocks:** (none)
- **Estimate:** 1 dev-day

## Objective

`providerType: 'channel'` tests using the same protocol the channel uses in
production — auth + availability only, **zero side effects** (no test
messages, calls, or emails to real recipients).

## Scope

### New files

- `src/services/providers/connectionTest/strategies/channel.ts` —
  registered for `providerType 'channel'`; dispatch on `apiType`.

### Modified files

- `src/services/providers/connectionTest/index.ts` (registration)
- `src/services/providers/channel/*.ts` — expose minimal auth-check methods
  where the channel host doesn't already have one (e.g. `testCredentials()`
  on the connection class) instead of reaching into internals from the
  strategy.

## Implementation requirements

Per `apiType` (all calls are free, read-only, or handshakes):

| apiType | Test | Transport |
|---|---|---|
| telegram | Bot API `getMe` (returns bot identity) | HTTP |
| twilio-messaging | `GET /2010-04-01/Accounts/{sid}/Messages.json?PageSize=1` | Twilio REST (Basic auth) |
| twilio-voice | `GET /2010-04-01/Accounts/{sid}/PhoneNumbers.json?PageSize=1` (same account creds) | Twilio REST |
| whatsapp | Meta Cloud API `GET /{graphVersion}/{phone-number-id}` | HTTP (Bearer) |
| sendgrid | `GET /user/account` | HTTP (Bearer) |
| ses | AWS SDK `ListIdentitiesCommand` (max 1 page) | AWS SDK (HTTP) |
| smtp-imap | SMTP: TCP connect + `EHLO` + `STARTTLS` + `AUTH` with stored creds (no mail); IMAP: connect + `LOGIN` (no fetch). Both directions reported in `detail: { smtp: 'ok', imap: 'ok' | 'failed: …' }` | raw SMTP/IMAP |

Rules:

1. No outbound content of any kind; a `detail` field names what was checked.
2. `protocol` reported per apiType (`'http' | 'smtp' | 'imap'`).
3. Auth failure → `errorCode 'auth'` (so a future `provider-auth-failed`
   scope extension to channel providers works unchanged); network →
   `'network'`; anything else per `classifyThirdPartyError`.
4. Credentials resolved via `secretRefUtils.resolveObject` exactly like the
   channel hosts do at startup (single source of truth for secret refs).
5. Saved tests recorded with `operation 'channel.test'` (same TPC-01 rules,
   incl. breaker exclusion).

## Acceptance criteria

- All seven apiTypes covered; each exercises the production transport.
- smtp-imap failure modes covered: SMTP auth reject vs IMAP auth reject
  reported independently in `detail`.
- Zero side effects (code review + unit assertion that no send/fetch call is
  invoked on the fakes).

## Tests

**Unit:** one fake per transport — Telegram Bot API fake (200/401),
Twilio REST fake (200/401/403), WhatsApp/SendGrid fake (200/401), SES fake
(SDK inject), SMTP/IMAP fake servers (local `smtp-server`/`imapflow`
test servers or a minimal socket server): valid AUTH → ok; wrong password →
`auth`; closed port → `network`.

**E2e:** saved `telegram` provider with a bogus token → 200 `ok:false`,
`errorCode 'auth'` (Telegram returns a deterministic 401 — no real token
needed); saved `smtp-imap` with a dead SMTP host → `ok:false 'network'`,
`detail.imap` reported. (Both deterministic without vendor creds.)

## Out of scope

- Outbound delivery tests (send a real message to a test number/chat);
  webhook-reachability tests (inbound side is covered by channel health
  checks / P1-05 service staleness).
