---
title: "SampleCopyService undefined error messages and unsafe casts"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-31
assignee: ""
tags: [type-safety, error-handling]
---

# SampleCopyService undefined error messages and unsafe casts

## Description

Multiple HIGH issues in `SampleCopyService.ts`:

1. **Line 205**: `updateData.name` can be undefined. Error message shows 'undefined'. FIXED: nullish coalescing to 'unknown'.
2. **Line 273**: Multiple unsafe `as` casts bypass type safety. FIXED: parse through `sampleCopyResponseSchema` to normalize types before constructing create payload.

## Steps to Reproduce

1. Update a sample copy without providing name
2. Observe "undefined" in error message

## Expected Behavior

Proper null handling. Typed operations.

## Actual Behavior

"undefined" in error messages. Unsafe type casts.

## Notes

File: `src/services/SampleCopyService.ts`
