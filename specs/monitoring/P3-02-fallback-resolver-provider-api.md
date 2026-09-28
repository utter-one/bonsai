---
title: "P3-02 — Fallback chains: validation, resolver, provider API contract"
severity: proposal
status: resolved
created: 2026-08-17
updated: 2026-08-20
assignee: ""
tags: [monitoring, spec, phase-3]
---

# P3-02 — Fallback chains: validation, resolver, provider API contract

- **Phase:** 3 — Failover
- **Depends on:** P1-01 (`providers.fallbacks` column)
- **Blocks:** P3-03, P3-04, P3-05
- **Estimate:** 1 dev-day

## Objective

Make fallback chains first-class provider data: validatable on write (`ProviderService`), resolvable at call time (`FallbackResolver`), and visible in the provider API/contracts.

## Scope

### New files
- `src/services/providers/FallbackResolver.ts` (`@singleton`)
- `src/services/monitoring/FallbackEventService.ts` (`@singleton`) — the **single write path** for `fallback_events` rows (P1-01 table): `record({ providerId, fallbackProviderId, providerType, operation, reason, projectId?, conversationId?, success })` (insert, fire-and-forget, never throws — standard monitoring failure policy) and `markSucceeded(rowId)` (one UPDATE). Used by P3-03/P3-04/P3-05 so the event shape can never drift between wrappers.

### Modified files
- `src/http/contracts/provider.ts` — `fallbacks` in create/update (optional, default `[]`) + list/get response schemas
- `src/services/providers/ProviderService.ts` — validation + persistence + cache invalidation
- `src/db/schema.ts` — nothing (column exists from P1-01)

## Implementation requirements

### Contract shape
```ts
fallbacks: z.array(z.object({
  providerId: z.string().openapi('ProviderId'),   // .describe('Id of the fallback provider (same providerType)')
  settings: z.record(z.unknown()).optional().nullable(), // per-fallback LLM settings override (model, temperature, ...)
})).max(3).default([]).openapi('ProviderFallbacks').describe('Ordered fallback providers used when the primary fails during setup phase'),
```
Position matters (1st tried first, then 2nd...). Max 3, flat — **no transitive chains** (A→B→C is not allowed even if B also has fallbacks; only the primary's own list is walked).

### `ProviderService` validation (on create + update)
- Each fallback `providerId`: exists — **decided: missing target → `ValidationError` (400)**, not 404: the chain entry is a data-integrity error in the payload being written, not a resource lookup. Also: `providerType` matches the primary's (400), is not the primary itself (400), and does not create a **cycle** in the fallback graph (400, e.g. A→B while B→A). Cycle check = DFS over existing `fallbacks` columns.
- Duplicates in the list → 400.
- Order preserved as given (no re-sorting).

### `FallbackResolver`
- `resolveChain(providerId: string): Promise<FallbackStep[]>` where `FallbackStep = { provider: ProviderRow; settings?: Record<string, unknown> }` — returns `[primary, ...fallbacks]` (primary's `settings` undefined).
- Caches chains keyed by provider id + `version`/`updatedAt` (both exist on the `providers` table); invalidates on provider create/update/delete (hook in `ProviderService`). Deleted fallback target → chain silently drops it (`logger.warn` at resolution; breaker/failover then just has a shorter chain — a dangling fallback must not 500 a conversation).
- Used by all Phase-3 chain wrappers (P3-03/P3-04) — single source of chain semantics. (P3-05's outbound-channel fallback is a single per-request hop, not a chain — it does not use the resolver.)

## Acceptance criteria

- [ ] Provider create/update accepts `fallbacks`, stores order, returns them in list/get responses (OpenAPI model documented).
- [ ] 400 with clear message for: missing target, type mismatch, self-reference, duplicate, cycle (2-cycle and 3-cycle), >3 entries.
- [ ] Resolver returns the exact chain; drops deleted targets; returns `[primary]` alone when `fallbacks` is empty.
- [ ] Cache invalidation: updating a provider's fallbacks changes the next `resolveChain` without restart.
- [ ] Existing provider e2e tests green (schema change is additive).

## Tests

- **Unit:** validation matrix (all 6 failure cases), cycle detection (2/3-node), resolver chain shape + cache invalidation + deleted-target drop.
- **E2E:** provider CRUD with fallbacks (happy + every 400 case), list/get shape.

## Out of scope

- The failover behavior itself (P3-03..P3-05), per-entity fallback override (entities reference a provider id; the chain travels with the provider — documented in proposal §3.4), UI (Console, P4-04).
