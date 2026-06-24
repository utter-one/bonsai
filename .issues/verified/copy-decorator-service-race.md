---
title: "CopyDecoratorService dead code and TOCTOU race"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-31
assignee: ""
tags: [race-condition, data-integrity]
---

# CopyDecoratorService dead code and TOCTOU race

## Description

Multiple HIGH issues in `CopyDecoratorService.ts`:

1. **Line 124**: `whereCondition` can never be undefined. Dead code.
2. **Line 194**: `updateData.name` can be undefined. Error message shows 'undefined'.
3. **Lines 165-173/216-223**: TOCTOU race between app-level and SQL-level version check.

## Steps to Reproduce

1. Perform concurrent updates to the same decorator
2. Observe race condition between version checks

## Expected Behavior

Atomic version checks. No dead code. Proper null handling.

## Actual Behavior

TOCTOU race. Dead code. "undefined" in error messages.

## Notes

File: `src/services/CopyDecoratorService.ts`
