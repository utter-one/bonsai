---
title: "Verbose info-level logging during IMAP polling"
severity: medium
status: open
created: 2026-06-02
updated: 2026-06-02
assignee: ""
tags: [logging, smtp-imap]
---

# Verbose info-level logging during IMAP polling

## Description

`ImapInboundService.processNewMessagesDirect()` and `fetchAndProcessMessage()` emit 6+ `logger.info` calls per poll cycle, even when there are no new messages. With default 30s polling, this generates significant log volume.

## Steps to Reproduce

1. Run the server with a configured SMTP/IMAP provider
2. Check logs during idle periods

## Expected Behavior

Only `debug`-level logs during normal polling; `info` reserved for notable events (new message, connection change, error).

## Actual Behavior

Every poll cycle emits multiple `info`-level logs.

## Notes

Demote lines `ImapInboundService.ts:158, 166, 174, 204, 231, 240, 248` from `info` to `debug`.
