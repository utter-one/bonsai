---
title: "ProviderService SQL injection and unconditional field overwrites"
severity: high
status: closed
created: 2026-05-29
updated: 2026-06-01
assignee: ""
tags: [security, sql-injection, data-integrity]
---

# ProviderService SQL injection and unconditional field overwrites

## Description

1. **Line 125**: Raw string interpolation for JSONB. SQL injection via user-controlled input. FIXED: parameterized with `sql.param()`.

Note: The original claim about "partial update overwrites with NULL" was incorrect. Drizzle filters out `undefined` values in `mapUpdateSet()`, so the original code was safe.

## Notes

File: `src/services/providers/ProviderService.ts`

## Verification

Re-opened 2026-05-31: SQL injection still present. The inline JSONB query was refactored to shared utility `buildTextSearchCondition` in `src/utils/textSearch.ts:36`, but it still uses raw template literal interpolation with `JSON.stringify(parsed.value)` instead of `sql.param()`. User-controlled `textSearch` input can break out of JSON structure and inject SQL.
