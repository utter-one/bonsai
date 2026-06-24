---
title: "MigrationService plain-text credentials and argument bugs"
severity: high
status: closed
created: 2026-05-29
updated: 2026-06-01
assignee: ""
tags: [security, data-integrity]
---

# MigrationService plain-text credentials and argument bugs

## Description

Multiple HIGH issues in `MigrationService.ts`:

1. **Line 117**: `resolveBundle` called with `selection` as both first and third argument.
2. **Line 181-199**: Audit logging async. Failed audit swallowed.
3. **Line 259/784**: Plain-text credentials over HTTP. No protocol enforcement.
4. **Line 306**: `runPull` fire-and-forget. Stuck on process exit.
5. **Line 354**: `resolveBundle` with empty string hash. Inconsistent.

## Steps to Reproduce

1. Run migration with HTTP endpoint
2. Observe credentials transmitted in plaintext

## Expected Behavior

HTTPS-only. Proper argument passing. Synchronous audit logging.

## Actual Behavior

Plaintext credentials. Wrong arguments. Fire-and-forget operations.

## Notes

File: `src/services/MigrationService.ts`

## Verification

Re-opened 2026-05-31: Issues 1 and 2 are resolved, but 3 issues remain: (1) plain-text credentials with no HTTPS enforcement, (2) `runPull` at line 306 is still fire-and-forget, (3) preview at line 354 passes empty string for `restSchemaHash` producing inconsistent bundles.

Resolved 2026-06-01: All three issues fixed. (1) HTTPS enforcement added in `previewRemote` and `runPull` — throws `InvalidOperationError` if URL doesn't start with `https://`. (2) Pull promise now tracked in `activePullPromises` map, cleaned up via `.finally()` on completion. (3) `previewExport` now passes the actual `restSchemaHash` from `VersionService` instead of empty string.
