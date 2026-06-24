---
title: "Ambient DB transactions via AsyncLocalStorage"
severity: proposal
status: open
created: 2026-06-01
updated: 2026-06-01
assignee: ""
tags: [architecture, transactions, audit, data-integrity]
---

# Ambient DB transactions via AsyncLocalStorage

## Description

Services like `EnvironmentService` perform multiple DB operations that should be atomic but currently aren't:

1. `secretsRegistry.storeSecret(...)` — external (not DB)
2. `db.insert(environments)` — DB write #1
3. `auditService.logCreate(...)` → `db.insert(auditLogs)` — DB write #2

If the audit log insert fails after the environment record is written, we end up with a committed entity and no audit trail. The current manual orphan-secret cleanup in `catch` blocks doesn't address the DB-side inconsistency.

Some services already use `db.transaction()` correctly (e.g., `ProjectService.deleteProject`), but they require explicit `tx` parameter threading through every call.

## Proposed Solution

Introduce a lightweight `AsyncLocalStorage`-based transaction context so that:

- Code inside a transaction scope automatically uses the transaction without explicit `tx` parameter passing
- Code outside continues using the global `db` instance
- All 86 existing `auditService.logCreate/Update/Delete` call sites across ~20 services work unchanged

### Utility (`src/utils/transactionContext.ts`)

```typescript
import { AsyncLocalStorage } from 'async_hooks';
import { db } from '../db/index';

const store = new AsyncLocalStorage<any>();

export async function withTransaction<T>(
  fn: (tx: any) => Promise<T>,
  options?: any
): Promise<T> {
  return db.transaction(async (tx) => store.run(tx, () => fn(tx)), options);
}

export function useDb() {
  return store.getStore() ?? db;
}
```

### AuditService change (1 line)

```typescript
// Before
const auditLog = await db.insert(auditLogs).values({ ... }).returning();

// After
const auditLog = await useDb().insert(auditLogs).values({ ... }).returning();
```

### EnvironmentService change (wrap DB ops)

```typescript
async createEnvironment(input, context) {
  // Secrets are external — stay outside the transaction
  const passwordToStore = await this.secretsRegistry.storeSecret(...);

  await withTransaction(async (tx) => {
    const environment = await useDb().insert(environments)
      .values({ id, password: passwordToStore, ... })
      .returning();

    // AuditService now uses useDb() internally → same transaction automatically
    await this.auditService.logCreate('environment', environment.id, safe, context.operatorId);
  });
}
```

## Benefits

- **Zero call-site changes** — existing `auditService.log*` calls work unchanged
- **Composable** — if `ServiceA` → `ServiceB` → `AuditService`, all participate in the same transaction automatically
- **Opt-in** — services that don't need transactions continue using `db` directly
- **Thread-safe** — `AsyncLocalStorage` scopes to the async call chain; concurrent requests don't leak

## Caveats

- Secrets registry is external to PostgreSQL — cannot be inside the transaction. Manual orphan cleanup via `finally` block remains necessary (improvement over current `catch` pattern)
- `useDb()` returns `any` — could be typed more precisely with `Parameters<Parameters<typeof db.transaction>[0]>[0]` union with the Drizzle DB type

## Files Touched

| File | Change |
|---|---|
| `src/utils/transactionContext.ts` | New — AsyncLocalStorage wrapper (~15 lines) |
| `src/services/AuditService.ts` | `db` → `useDb()` in `logChange` |
| `src/services/EnvironmentService.ts` | Wrap DB ops in `withTransaction()` |

## Notes

Other services with the same multi-op pattern (ProviderService, ApiKeyService, OperatorService, etc.) could adopt `withTransaction()` later individually — the AuditService change is the prerequisite that enables it.
