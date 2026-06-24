---
title: "No inbound rate limiting for IMAP-dispatched emails"
severity: medium
status: open
created: 2026-06-02
updated: 2026-06-02
assignee: ""
tags: [reliability, smtp-imap]
---

# No inbound rate limiting for IMAP-dispatched emails

## Description

`SmtpImapChannelHost.handleInboundEmail()` is called directly from `ImapInboundService`, bypassing the `IpRateLimiter` that protects webhook endpoints. If a mailbox receives a burst of emails, all are dispatched to the AI concurrently without throttling.

## Steps to Reproduce

1. Send 50+ emails to the monitored IMAP inbox simultaneously
2. IMAP polling picks them up

## Expected Behavior

Emails are dispatched with some rate limiting to avoid overwhelming the AI pipeline.

## Actual Behavior

All emails are dispatched concurrently, potentially causing resource contention.

## Notes

Consider a simple concurrency limiter (e.g., max 5 concurrent dispatches) in `ImapMailboxSession.processNewMessagesDirect()`.
