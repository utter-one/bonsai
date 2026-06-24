---
title: "ConversationService missing permissions and type violations"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-31
assignee: ""
tags: [security, type-safety]
---

# ConversationService missing permissions and type violations

## Description

Multiple HIGH issues in `ConversationService.ts`:

1. **Line 187**: `setConversationMetadata` no permission check or `requireProjectNotArchived`. FIXED: added `requireProjectNotArchived`. (No permission check needed — internal method called by trusted channel hosts, not exposed via REST API.)
2. **Line 205/219**: `updateConversationEventMetadata` returns `undefined` on catch instead of `null`. FIXED: all return paths now return `null`. Caller in ConversationRunner updated with null guard.
3. **Line 232/251**: `updateMessageEvent` returns `undefined` on catch instead of `null`. FIXED: all return paths now return `null`. Caller in ConversationRunner updated with null guard.
4. **Line 56**: `context` optional for write op. Missing permission check. FALSE POSITIVE: internal method called by trusted channel hosts and ConversationRunner, not exposed via REST API. Optional context is by design for auditing when available.

## Steps to Reproduce

1. Call setConversationMetadata without proper permissions
2. Observe no permission enforcement

## Expected Behavior

Permission checks on all write operations. Consistent return types.

## Actual Behavior

Missing permissions. Type violations on error paths.

## Notes

File: `src/services/ConversationService.ts`
