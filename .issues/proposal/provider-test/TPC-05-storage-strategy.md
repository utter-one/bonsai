---
title: "TPC-05 — Storage strategy: real object-store list + optional write round trip"
severity: proposal
status: open
created: 2026-08-24
updated: 2026-08-24
assignee: ""
tags: [providers, spec, connection-test, phase-1, storage]
---

# TPC-05 — Storage connection strategy

- **Depends on:** TPC-01
- **Blocks:** TPC-06
- **Estimate:** 0.5 dev-day

## Objective

The `storage` strategy: verify auth + bucket availability + credentials'
read (and optionally write) scope with real object-store calls.

## Scope

### New files

- `src/services/providers/connectionTest/strategies/storage.ts` (registered
  for `providerType 'storage'`)

### Modified files

- `src/services/providers/storage/StorageProviderFactory.ts`:
  `createForTest` seam (TPC-01 pattern).

## Implementation requirements

1. Default (read-only): `list(prefix, 1)` — verifies credentials, bucket
   existence, network. `ok`, `phase 'first-data'`; `protocol` per apiType:
   `sdk` (s3, azure-blob, gcs) / `local-fs` (local).
2. Optional `write: true` (input param):
   `upload('bonsai-connection-test/<uuid>')` → `download` (byte-compare) →
   `delete` in `finally` → `phase 'write'`, `detail: { wrote, verified }`.
3. `local`: directory existence/writability check instead of SDK calls;
   `detail.path`. Missing/unwritable directory → `ok:false, errorCode
   'client_error'` (a misconfiguration, not a third-party failure).
4. Cost: one `list` (free) + optional 1 KB round trip (~0.1 s, ~0.0001 ¢).

## Acceptance criteria

- Only existing `IStorageProvider` methods are used.
- Test key always cleaned up, even on download mismatch.

## Tests

**Unit** (`tests/unit/providers/connection-test-storage.test.ts`, no
network) — `local` against a temp dir:

- list → `ok:true, phase 'first-data'`;
- write round trip → `ok:true, phase 'write'`, key cleaned up (assert the
  directory is empty afterwards);
- missing directory → `ok:false, errorCode 'client_error'`;
- unreadable directory (chmod 000 on a sub-dir, when running as non-root)
  → `ok:false`, never an unhandled exception;
- s3/azure-blob/gcs: construction from a fake config + `list` against a
  stubbed SDK client → `protocol 'sdk'` (no real cloud calls).

## Out of scope

- Cross-bucket permission sweeps, lifecycle/cost audits, endpoint plumbing
  (TPC-06).
