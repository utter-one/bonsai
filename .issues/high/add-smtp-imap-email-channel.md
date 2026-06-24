---
title: "Add SMTP/IMAP as third email channel"
severity: high
status: in_progress
created: 2026-06-02
updated: 2026-06-02
assignee: ""
tags: [feature, email, channel]
---

# Add SMTP/IMAP as third email channel

## Description

Add SMTP/IMAP as a third email channel alongside SES and SendGrid. Unlike the existing push-based channels (webhooks), IMAP is pull-based — requires a background service connecting to IMAP mailboxes, detecting new messages, and dispatching them.

## Files to Create (6)

1. `src/services/providers/channel/SmtpImapChannelProvider.ts` — Zod config schema
2. `src/channels/email/smtp-imap/SmtpImapConnection.ts` — extends EmailConnectionBase, nodemailer for SMTP
3. `src/channels/email/smtp-imap/SmtpImapChannelHost.ts` — HTTP host for outgoing send endpoint
4. `src/channels/email/smtp-imap/SmtpImapCommunicationChannel.ts` — implements ICommunicationChannel
5. `src/services/SmtpImapInboundService.ts` — background IMAP polling/IDLE service
6. `src/http/contracts/smtp-imap-outgoing.ts` — Zod schemas for outgoing send endpoint

## Files to Modify (5)

7. `src/server.ts` — register channel host + start background service
8. `src/channels/ChannelCatalog.ts` — inject + register channel
9. `src/apiKeyFeatures.ts` — add `'smtp_imap'` to type and array
10. `src/http/contracts/provider.ts` — add to provider config union
11. `src/channels/email/shared/EmailConnectionBase.ts` — add `'smtp_imap'` to connectionType union

## Dependencies

- `nodemailer` — SMTP sending
- `imap` — IMAP connection + IDLE
- `@types/imap` — TypeScript definitions
- `mailparser` — already a dependency

## Config Schema

- `fromAddress` — sender email
- `smtp.host`, `smtp.port`, `smtp.secure`, `smtp.auth.user`, `smtp.auth.pass` — SMTP config
- `imap.host`, `imap.port`, `imap.secure`, `imap.auth.user`, `imap.auth.pass` — IMAP config (optional for send-only)
- `imap.pollingIntervalMs` — fallback polling interval when IDLE unavailable
- `threadingStrategy` — `'messageId' | 'senderSubject'`

## Design Decisions

- SMTP and IMAP allow different credentials
- Provider discovery: scan providers table for `apiType: 'smtp_imap'` with IMAP config on startup
- One provider = one mailbox; multiple providers for multiple mailboxes
- Credentials stored plain in config JSONB, encrypted by MASTER_ENCRYPTION_KEY on startup
- TLS: simple `secure` boolean (`true` → TLS, `false` → STARTTLS)

## Notes

- `nodemailer` is SMTP-only; IMAP requires the `imap` library
- `SmtpImapInboundService` should be named `ImapInboundService` (purely receiving)
- IMAP connection stability (reconnections, IDLE timeouts, server compatibility) is the main risk area
- Background service should follow pattern of `ConversationTimeoutService` / `ScenarioRunExecutorService`
