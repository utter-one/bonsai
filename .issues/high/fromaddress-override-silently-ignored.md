---
title: "fromAddress override silently ignored in SMTP/IMAP"
severity: high
status: open
created: 2026-06-02
updated: 2026-06-02
assignee: ""
tags: [bug, smtp-imap, api]
---

# fromAddress override silently ignored in SMTP/IMAP

## Description

`smtpImapSendBodySchema` allows `fromAddress` as an optional override (`smtp-imap-outgoing.ts:9`). `SmtpImapChannelHost` passes it through (`SmtpImapChannelHost.ts:158`). But `SmtpImapConnection.sendEmail()` always uses `smtpAuthUser` as the `from` address (`SmtpImapConnection.ts:67`), silently discarding the override.

The API accepts the parameter but it has no effect. This is confusing and inconsistent.

## Steps to Reproduce

1. Call `POST /api/email/smtp-imap/send` with `fromAddress: "custom@example.com"`
2. Check the sent email's From header

## Expected Behavior

Either the email is sent from `custom@example.com`, or the API rejects the mismatched address with a clear error.

## Actual Behavior

The email is sent from `smtpAuthUser` (the authenticated SMTP user). The `fromAddress` override is silently ignored.

## Notes

Fix: either validate that `fromAddress === smtpAuthUser` and reject mismatches, or remove the `fromAddress` field from the schema. The current behavior exists to avoid OVH "Sender mismatch" 550 errors, but the API contract should reflect that constraint.
