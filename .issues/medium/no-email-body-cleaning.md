---
title: "No email body cleaning for signatures and quoted replies"
severity: medium
status: open
created: 2026-06-02
updated: 2026-06-02
assignee: ""
tags: [feature, smtp-imap, ai-context]
---

# No email body cleaning for signatures and quoted replies

## Description

Inbound emails are passed to the AI as-is (`ImapInboundService.ts:234`). Reply chains include quoted history (prefixed with `>`) and email signatures. This pollutes the AI context with stale conversation history and noise, and may cause the AI to respond to outdated content.

## Steps to Reproduce

1. User replies to an email with previous conversation history
2. IMAP polling extracts the full body text
3. Body is dispatched to the AI

## Expected Behavior

Only the new content (above the quoted reply and signature) is sent to the AI.

## Actual Behavior

The full body including quoted history and signatures is sent to the AI.

## Notes

Consider stripping content after common delimiters (`> `, `-- `, `__`, `On [date], [name] wrote:`) before dispatching. Could be a configurable option per provider.
