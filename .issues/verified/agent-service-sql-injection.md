---
title: "AgentService SQL injection and undefined overwrites"
severity: high
status: closed
created: 2026-05-29
updated: 2026-06-01
assignee: ""
tags: [security, sql-injection, data-integrity]
---

# AgentService SQL injection and undefined overwrites

## Description

Multiple HIGH issues in `AgentService.ts`:

1. **Line 108**: Raw SQL interpolation of `JSON.stringify(tagsArray)`. SQL injection if untrusted input.
2. **Line 176-187**: `updateAgent` sets all fields unconditionally. `undefined` overwrites existing value with NULL.

## Steps to Reproduce

1. Update an agent with partial data
2. Observe existing fields overwritten with NULL

## Expected Behavior

Tags should be parameterized. Partial updates should only touch provided fields.

## Actual Behavior

SQL injection via tags. All fields overwritten on update.

## Notes

File: `src/services/AgentService.ts`

## Verification

Re-opened 2026-05-31: Undefined overwrites issue is resolved (Drizzle filters undefined), but SQL injection at line 108 persists. Uses `sql.join(tagsArray, ', ')` for raw string interpolation of user-supplied tag values instead of parameterized queries.
