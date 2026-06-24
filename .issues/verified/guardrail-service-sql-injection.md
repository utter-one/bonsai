---
title: "GuardrailService SQL injection and swallowed errors"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-29
assignee: ""
tags: [security, sql-injection, error-handling]
---

# GuardrailService SQL injection and swallowed errors

## Description

Multiple HIGH issues in `GuardrailService.ts`:

1. **Line 111**: Raw SQL interpolation of `JSON.stringify(tagsArray)`. Not parameterized.
2. **Line 53-56**: Catch-all swallows application errors. Expected control-flow logged as failures.

## Steps to Reproduce

1. Create/update guardrail with malicious tags
2. Observe SQL injection vulnerability

## Expected Behavior

Tags should be parameterized. Expected errors should not be logged as failures.

## Actual Behavior

SQL injection via tags. All errors logged as failures.

## Notes

File: `src/services/GuardrailService.ts`
