---
title: "KnowledgeService unconditional updates and cross-project data leak"
severity: high
status: closed
created: 2026-05-29
updated: 2026-06-01
assignee: ""
tags: [security, data-integrity]
---

# KnowledgeService unconditional updates and cross-project data leak

## Description

Multiple HIGH issues in `KnowledgeService.ts`:

1. **Line 169**: Update sets all fields unconditionally. Missing fields overwrite with NULL.
2. **Line 175**: Missing `projectId` scope in post-update fetch. Potential cross-project data leak.
3. **Line 177**: Non-null assertion after unscooped fetch. Runtime crash risk.

## Steps to Reproduce

1. Update a knowledge item with partial data
2. Observe existing fields overwritten with NULL

## Expected Behavior

Partial updates. Project-scoped fetches. Guarded null access.

## Actual Behavior

All fields overwritten. Cross-project data access. Crash on missing record.

## Notes

File: `src/services/KnowledgeService.ts`

## Verification

Re-opened 2026-05-31: Unconditional updates are not an issue (Drizzle filters undefined). However: (1) missing `projectId` scope at line 175 in `updateKnowledgeCategory` post-update fetch is still present, (2) non-null assertion `category!` at line 177 still present.
