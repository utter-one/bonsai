---
title: "No SMTP send retry on transient failure"
severity: high
status: open
created: 2026-06-02
updated: 2026-06-02
assignee: ""
tags: [reliability, smtp-imap]
---

# No SMTP send retry on transient failure

## Description

`SmtpImapConnection.sendEmail()` (`SmtpImapConnection.ts:82-87`) catches SMTP errors and logs them, but does not retry. A transient network issue or SMTP server hiccup results in the AI response being silently lost.

SES uses the AWS SDK which has built-in retry logic. SMTP/IMAP has no equivalent.

## Steps to Reproduce

1. AI generates a response that triggers `sendEmail`
2. SMTP server is temporarily unavailable or returns a 4xx transient error
3. Error is logged, no retry occurs

## Expected Behavior

The email is retried with exponential backoff (2-3 attempts) before giving up.

## Actual Behavior

The email send fails once and the AI response is lost.

## Notes

Consider using nodemailer's built-in retry or implementing a simple retry wrapper with exponential backoff (e.g., 1s, 3s, 9s). Only retry on transient (4xx) errors, not permanent (5xx) failures.
