---
title: "UserInputProcessor hardcoded limits and wrong log IDs"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-29
assignee: ""
tags: [data-integrity, logging]
---

# UserInputProcessor hardcoded limits and wrong log IDs

## Description

Multiple HIGH issues in `UserInputProcessor.ts`:

1. **Line 75**: Hardcoded `limit: 100`. Silently truncates knowledge categories.
2. **Lines 172/176**: Non-null assertion `sampleCopyClassifier!` unsafe. Runtime crash risk.
3. **Lines 211/219**: Logger uses `session.id` as `conversationId`. Wrong ID.

## Steps to Reproduce

1. Process input with more than 100 knowledge categories
2. Observe silent truncation

## Expected Behavior

Configurable or no limit. Safe null handling. Correct log IDs.

## Actual Behavior

Truncated categories. Unsafe assertions. Wrong IDs in logs.

## Notes

File: `src/services/live/UserInputProcessor.ts`
