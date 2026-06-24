---
title: "No persistent UID tracking for IMAP processed messages"
severity: high
status: open
created: 2026-06-02
updated: 2026-06-02
assignee: ""
tags: [bug, smtp-imap, reliability]
---

# No persistent UID tracking for IMAP processed messages

## Description

`processedUids` is an in-memory `Set<number>` (`ImapInboundService.ts:17`). If the process crashes or restarts between fetching a message and marking it `\Seen`, the message remains unseen and gets reprocessed on the next startup. This causes duplicate dispatches to the AI.

## Steps to Reproduce

1. IMAP polling fetches a message, adds UID to `processedUids`
2. Process crashes before `addFlags` completes
3. Process restarts, `processedUids` is empty
4. Same message is fetched and dispatched again

## Expected Behavior

Previously processed messages are not re-dispatched after a restart.

## Actual Behavior

Message is reprocessed and the AI receives a duplicate input.

## Notes

Options: persist processed UIDs to DB (e.g., a new `imap_processed_uids` table), or use a UID range search (`UID minUid:*`) that excludes already-seen messages. DB persistence is more robust.
