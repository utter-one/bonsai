---
title: "TPC-05 — Storage strategy: real object-store list + optional write round trip"
severity: proposal
status: resolved
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

## Resolution (2026-08-26)

Shipped: `StorageProviderBase.testConnection()` (the original
`strategies/storage.ts` was folded into the base — see TPC-01),
`StorageProviderFactory.createForTest` (+ `instantiateProvider` extraction;
stamps only for saved providers, duck-typed),
`GcsStorageProvider` optional `apiEndpoint` passthrough, `bucket` input in
`types.ts` + tester passthrough, and
`tests/unit/providers/connection-test-storage.test.ts` (7 tests: local
list / write round trip / missing dir / unreadable dir; s3, azure-blob and
gcs with the REAL SDK clients against one local HTTP stub object store —
zero cloud calls — all in draft mode → zero rows / zero breaker feed).

Semantics as specced: read-only `list(undefined, 1)` → `phase 'first-data'`
with `detail { objects }`; `write: true` → 1 KB upload / download / byte
compare / delete-in-`finally` → `phase 'write'` with `detail { wrote,
verified }`. Protocol table: s3/azure-blob/gcs → `'sdk'`, local →
`'local-fs'`. 15 s timeout. Local pre-checks (missing dir, not a directory,
unreadable/unwritable) run BEFORE `init()` because `LocalStorageProvider.init()`
auto-creates a missing dir and `list()` swallows ENOENT — the base's
`testConnection()` maps them to an explicit `client_error` (the shared
classifier would mislabel EACCES as `auth` and ENOENT/ENOTDIR as
`unknown`); the tester's graph-proof `ConnectionTestFailure` check
(matching the class `name`, not `instanceof`) preserves that mapping.

Deliberate deviations / additions:

1. **`bucket` test input** (not in the original input shape): storage
   settings are per-project in production, so the test takes the target
   bucket/container explicitly. Required for s3/azure-blob/gcs (their
   settings schemas require `bucket`/`containerName`/`bucketName`) — missing
   → `ValidationError` (400 at the endpoint).
2. **GCS `apiEndpoint`** optional config field (consistent with the S3 and
   Azure `endpoint` fields) — enables stub-endpoint testing; production
   configs are unaffected when it is absent.
3. **No `instanceof` gate in `createForTest` stamping** (duck-typed
   assignment to `StorageProviderBase` fields): the factory lazy-loads
   provider modules via `await import()`, which under tsx (dev/tests) yields a
   second module graph where `instanceof StorageProviderBase` is unreliable.
   Every apiType instantiates a `StorageProviderBase` subclass, so the
   assignment is equivalent. Complemented by a `globalThis.__TEST_PROVIDER_CALL_RECORDER__`
   seam in `getProviderCallRecorder()` (same pattern as `rateLimiter.ts`)
   so the provider graph's `record()` calls reach the test harness's
   CallLogger and row assertions are genuine.
