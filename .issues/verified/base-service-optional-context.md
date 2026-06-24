---
title: "BaseService optional context violates project convention"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-31
assignee: ""
tags: [convention, security]
---

# BaseService optional context violates project convention

## Description

`BaseService.ts` line 32: `context` typed as `RequestContext | undefined`. Convention says context MUST be required (not optional) for all service methods to enforce defense-in-depth security.

## Steps to Reproduce

1. Call a service method without providing context
2. Observe no compile-time error

## Expected Behavior

Context should be required, enforcing permission checks at compile time.

## Actual Behavior

Context is optional, allowing methods to be called without security context.

## Notes

File: `src/services/BaseService.ts`
