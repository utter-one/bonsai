---
title: "No IDLE mode logging for IMAP connections"
severity: low
status: open
created: 2026-06-02
updated: 2026-06-02
assignee: ""
tags: [logging, smtp-imap]
---

# No IDLE mode logging for IMAP connections

## Description

The `imap` library supports IDLE for real-time server push. The current implementation uses `keepalive: true` (NOOP-based) with polling as fallback. There's no log indicating whether the server supports IDLE or which mode is active.

## Expected Behavior

On connection, log whether IDLE is available and which keepalive mode is being used.

## Actual Behavior

No indication of which mode is active.

## Notes

Check `imap.serverSupports('IDLE')` after connection and log the result. Helps with debugging polling latency issues.
