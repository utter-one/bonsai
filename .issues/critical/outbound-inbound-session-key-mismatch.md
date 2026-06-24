---
title: "Outbound/Inbound session key mismatch breaks reply threading"
severity: critical
status: resolved
created: 2026-06-02
updated: 2026-06-02
assignee: ""
tags: [bug, smtp-imap, ses, threading]
---

# Outbound/Inbound session key mismatch breaks reply threading

## Description

When an outbound email is sent via `POST /api/email/smtp-imap/send`, the session is keyed by `${projectId}:${recipientEmail}` (`SmtpImapChannelHost.ts:174`). When an inbound reply arrives via IMAP polling, the session lookup uses `${projectId}:${threadId}` where `threadId` is a hashed Message-ID (`SmtpImapChannelHost.ts:243`).

These keys will never match. A reply to an outbound email creates a **new** session/conversation instead of continuing the existing one.

SES has the same bug (`SesChannelHost.ts:327` keys by `${projectId}:${body.to}`).

## Steps to Reproduce

1. Send an outbound email via `POST /api/email/smtp-imap/send` to `user@example.com`
2. Note the returned `conversationId`
3. Have `user@example.com` reply to the email
4. IMAP polling picks up the reply

## Expected Behavior

The reply is dispatched to the existing conversation from step 2.

## Actual Behavior

A new session and conversation are created; the reply is not connected to the original outbound conversation.

## Notes

Fix: outbound should key by the same `ThreadIdResolver` output, or store the generated Message-ID as the thread key. Both `SmtpImapChannelHost` and `SesChannelHost` are affected.
