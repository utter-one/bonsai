---
title: "ToolExecutor bare Error throws and type safety bypasses"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-29
assignee: ""
tags: [error-handling, type-safety]
---

# ToolExecutor bare Error throws and type safety bypasses

## Description

Multiple HIGH issues in `ToolExecutor.ts`:

1. **Line 145**: `fetch()` no timeout. Hangs indefinitely.
2. **Line 99**: `llmSettings as any`. Bypasses type safety.
3. **Lines 223/234**: `any[]` cast and `value: any`.
4. **Lines 77/119/175**: Throws bare `Error`. Breaks convention.

## Steps to Reproduce

1. Execute an HTTP tool against a slow endpoint
2. Observe indefinite hang

## Expected Behavior

Fetch timeout. Typed operations. Custom error classes.

## Actual Behavior

No timeout. `any` casts. Bare Error throws.

## Notes

File: `src/services/live/ToolExecutor.ts`
