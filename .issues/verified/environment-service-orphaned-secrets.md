---
title: "EnvironmentService orphaned secrets on DB failure"
severity: high
status: closed
created: 2026-05-29
updated: 2026-06-01
assignee: ""
tags: [security, data-integrity]
---

# EnvironmentService orphaned secrets on DB failure

## Description

Multiple HIGH issues in `EnvironmentService.ts`:

1. **Line 46-47**: Orphaned secret on DB failure. `storeSecret()` succeeds but `db.insert()` fails. Secret stored in vault but no DB record.
2. **Line 182**: Same orphaned secret issue. `storeSecret()` succeeds but `db.update()` fails.

## Steps to Reproduce

1. Create/update environment variable where DB write fails after secret is stored
2. Observe secret in vault with no corresponding DB record

## Expected Behavior

Atomic operation: either both succeed or both roll back.

## Actual Behavior

Secret stored in vault but DB record fails, leaving orphaned secret.

## Notes

File: `src/services/EnvironmentService.ts`

## Verification

Re-opened 2026-05-31: Issue persists. At lines 46-47 (create) and 182-185 (update), `storeSecret()` is called before DB write. If DB insert/update fails, the secret remains orphaned in the vault. No transaction or compensation logic exists.

Resolved 2026-06-01: Added compensation logic to both `createEnvironment` and `updateEnvironment`. When a new secret is stored (not an existing reference), the returned secret reference is tracked. If the subsequent DB write fails, the orphaned secret is cleaned up via `secretsRegistry.deleteSecret()`. Cleanup failure is logged but doesn't mask the original error.

Resolved 2026-06-01: Added compensation logic to both `createEnvironment` and `updateEnvironment`. When a new secret is stored (not an existing reference), the returned secret reference is tracked. If the subsequent DB write fails, the orphaned secret is cleaned up via `secretsRegistry.deleteSecret()`. Cleanup failure is logged but doesn't mask the original error.
