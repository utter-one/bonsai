---
title: "No spam or attachment handling for inbound IMAP"
severity: medium
status: open
created: 2026-06-02
updated: 2026-06-02
assignee: ""
tags: [feature, smtp-imap]
---

# No spam or attachment handling for inbound IMAP

## Description

SES filters spam (`disposition === 'spam'`) and supports fetching raw MIME from S3 for full message inspection. SMTP/IMAP processes every unseen message as valid input, with no spam filtering and no attachment awareness.

## Steps to Reproduce

1. A spam email arrives in the IMAP inbox
2. IMAP polling picks it up and dispatches it to the AI

## Expected Behavior

Spam-flagged messages are skipped. Attachments are at least logged or handled.

## Actual Behavior

Spam is processed like any other email. Attachments are invisible to the system.

## Notes

Could check IMAP flags for spam indicators, or integrate with server-side spam filtering. For attachments, at minimum log their presence and filenames.
