---
title: "ConversationStorageService bare Error and orphaned uploads"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-31
assignee: ""
tags: [error-handling, resource-leak]
---

# ConversationStorageService bare Error and orphaned uploads

## Description

Multiple HIGH issues in `ConversationStorageService.ts`:

1. **Line 176**: Throws bare `Error`. Breaks convention and error handler mapping.
2. **Line 44-62**: Orphaned storage. Upload succeeds but insert fails. No cleanup.

## Steps to Reproduce

1. Upload storage where DB insert fails
2. Observe orphaned file in storage

## Expected Behavior

Custom error classes. Atomic upload/insert with cleanup on failure.

## Actual Behavior

Bare Error throws. Orphaned files on DB failure.

## Notes

File: `src/services/ConversationStorageService.ts`

## Resolution

1. **Line 176 — Bare `Error`**: Replaced `new Error(...)` with `new InvalidOperationError(...)` to follow project convention and map correctly through the global error handler (409 status).
2. **Lines 44-62 — Orphaned uploads**: Wrapped the DB insert in a try/catch. If the insert fails, the service attempts to delete the already-uploaded storage object via `provider.delete(key)`. Cleanup failures are logged at error level without swallowing the original DB error, which is re-thrown.
