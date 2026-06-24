---
title: "No session cleanup on shutdown for SmtpImapChannelHost"
severity: medium
status: open
created: 2026-06-02
updated: 2026-06-02
assignee: ""
tags: [bug, smtp-imap, lifecycle]
---

# No session cleanup on shutdown for SmtpImapChannelHost

## Description

`SmtpImapChannelHost` maintains `emailSessionMap` and `sessionTimeoutMap` with active timers. There is no `stop()` method to clean up these resources on server shutdown. `ImapInboundService` has a `stop()` method; the channel host should match.

## Steps to Reproduce

1. Start the server with active email sessions
2. Stop the server

## Expected Behavior

Timers are cleared, sessions are cleaned up, and the process exits cleanly.

## Actual Behavior

Timers may fire during shutdown, causing errors. (Partially mitigated by `unref()`.)

## Notes

Add a `stop()` method that clears all timers and unregisters sessions. Wire it into the server shutdown sequence alongside `ImapInboundService.stop()`.
