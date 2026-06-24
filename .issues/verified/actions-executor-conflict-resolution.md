---
title: "ActionsExecutor broken conflict resolution and double pushing"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-29
assignee: ""
tags: [data-integrity, conversation]
---

# ActionsExecutor broken conflict resolution and double pushing

## Description

Multiple HIGH issues in `ActionsExecutor.ts`:

1. **Lines 163-176**: Conflict resolution broken. Inconsistent filtering.
2. **Lines 187-188**: Clears resolvedEffects, discarding prior deduplication.
3. **Lines 202-211**: Double-pushing when both go_to_stage and end_conversation conflicts exist.

## Steps to Reproduce

1. Execute actions with conflicting go_to_stage and end_conversation
2. Observe double-pushed effects

## Expected Behavior

Deterministic conflict resolution. Single effect per type.

## Actual Behavior

Broken deduplication. Double effects on conflicts.

## Notes

File: `src/services/live/ActionsExecutor.ts`
