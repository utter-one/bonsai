---
title: "No IMAP STARTTLS support"
severity: high
status: open
created: 2026-06-02
updated: 2026-06-02
assignee: ""
tags: [feature, smtp-imap, config]
---

# No IMAP STARTTLS support

## Description

The IMAP config schema (`SmtpImapChannelProvider.ts:26`) only has `secure: boolean` which maps to `tls: boolean` in the `imap` library constructor. This covers implicit TLS (port 993) but not STARTTLS (port 143).

Many email providers (e.g., Yahoo, Fastmail, some corporate servers) require STARTTLS on port 143. The `imap` library supports this via `autotls: 'always'` config option.

## Steps to Reproduce

1. Configure an SMTP/IMAP provider with `imap.port: 143`, `imap.secure: false`
2. Connect

## Expected Behavior

Connection upgrades to TLS via STARTTLS.

## Actual Behavior

Connection may fail or remain unencrypted, depending on server behavior.

## Notes

Add an `autotls` field to `imapConfigSchema` (enum: `'always' | 'required' | 'never'`) and pass it to the `imap` constructor. Default should be `'never'` for backward compatibility.
