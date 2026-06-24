---
title: "OperatorService password hash leak and plain Error throws"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-31
assignee: ""
tags: [security, error-handling]
---

# OperatorService password hash leak and plain Error throws

## Description

Multiple HIGH issues in `OperatorService.ts`:

1. **Line 294**: Throws plain `Error` instead of typed error. Same at line 370.
2. **Lines 197-203/354-357**: `updatePayload` typed as `any` with `undefined` values. Drizzle writes NULL, overwriting data.

## Steps to Reproduce

1. Update an operator with partial data
2. Observe existing fields overwritten with NULL

## Expected Behavior

Typed error classes. Partial updates should only touch provided fields.

## Actual Behavior

Plain Error throws. All fields overwritten on update.

## Notes

File: `src/services/OperatorService.ts`
