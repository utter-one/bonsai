---
title: "ApiKeyService missing permissions and parallel fetch inconsistency"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-30
assignee: ""
tags: [security, data-integrity]
---

# ApiKeyService missing permissions and parallel fetch inconsistency

## Description

Multiple HIGH issues in `ApiKeyService.ts`:

1. **Line 286**: `getApiKeyAuditLogs` returns `any[]`. No permission check.
2. **Line 88**: `getApiKeyById` no permission check or project access.
3. **Lines 172-173**: `listApiKeys` fetches data/count in parallel. Total inconsistent with data.
4. **Lines 76/101/127/197/239/275/292**: Raw error object logged. Exposes DB details/stack traces.

## Steps to Reproduce

1. Call getApiKeyById without proper permissions
2. Observe no permission enforcement

## Expected Behavior

Permission checks on all operations. Consistent data/count. Sanitized error logging.

## Actual Behavior

Missing permissions. Inconsistent pagination. Raw error exposure.

## Notes

File: `src/services/ApiKeyService.ts`
