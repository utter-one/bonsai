---
title: "No health endpoint for IMAP connection status"
severity: low
status: open
created: 2026-06-02
updated: 2026-06-02
assignee: ""
tags: [feature, smtp-imap, observability]
---

# No health endpoint for IMAP connection status

## Description

There is no way to check IMAP connection status from outside the application. The `/health` endpoint is a simple ping. A dedicated endpoint or log would help with monitoring and debugging.

## Expected Behavior

An endpoint or structured log exposes per-provider IMAP connection state (connected, disconnected, error count).

## Actual Behavior

Connection status is only visible in logs.

## Notes

Could add a GET endpoint (e.g., `/api/email/smtp-imap/status`) that returns connection state per provider. Useful for ops monitoring.
