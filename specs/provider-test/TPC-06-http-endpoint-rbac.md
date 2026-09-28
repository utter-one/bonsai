---
title: "TPC-06 — HTTP endpoint: POST /api/providers/test-connection, contracts, RBAC, audit"
severity: proposal
status: resolved
created: 2026-08-24
updated: 2026-08-26
assignee: ""
tags: [providers, spec, connection-test, phase-2, http, rbac]
---

# TPC-06 — HTTP endpoint, contracts, RBAC, audit

- **Depends on:** TPC-01, TPC-02, TPC-05 (e2e exercises the LLM + storage paths; ASR/TTS strategies become available as TPC-03/04 land)
- **Blocks:** TPC-08
- **Estimate:** 1 dev-day

## Objective

Expose the tester as a REST endpoint with house-convention contracts, RBAC,
audit, and OpenAPI — `POST /api/providers/test-connection`, in **saved
provider** and **unsaved draft** modes.

## Resolution (2026-08-26)

Shipped: `src/http/contracts/providerConnectionTest.ts` (discriminated
`saved XOR draft` union — `z.discriminator`-free strict objects so exactly
one mode is present, else 400; draft `config` **reuses** the create endpoint's
`providerConfigSchema` from `provider.ts`, no duplicate), `AuditService.logEvent()`
(thin public wrapper over `logChange()`), `ProviderService.testConnection()`
(`requirePermission(PROVIDER_READ)` → tester → audit **saved mode only** →
`connectionTestResultSchema.parse`), the `ProviderController` route + handler
(`POST /api/providers/test-connection`, `checkPermissions(PROVIDER_READ)`,
`asyncHandler`, Zod parse), and
`tests/e2e/provider-connection-test.test.ts` (14 tests: saved local / ollama
dead-port / channel-400 / 404 / 429+Retry-After / audit-row; draft no-model-
400 / invalid-config-400 / ok:true+no-audit; both-modes-400 / neither-400 /
unsupported-type-400; support-403 / super_admin-200).

Vendor failures stay `200 ok:false`; only guard errors are non-200 (400/403/
404/429). The 5 s per-provider cooldown (in-memory in the tester) and
`Retry-After` come from TPC-01.

Deliberate deviations from the spec:

1. **Audit action is `CONNECTION_TEST`**, not `provider.connection_test` —
   the codebase's audit actions are UPPER_SNAKE verbs (CREATE/UPDATE/DELETE,
   CONNECTION_TEST fits), so the Console's existing audit filters/UI work
   unchanged. `newEntity` carries the structured result.
2. **RBAC 403 uses the `support` role, not `viewer`** — `viewer` actually has
   `provider:read`; only `support` lacks it (verified in
   `src/permissions.ts`). The 403 test asserts on `support`.
3. **Draft mode writes no audit row** (requirement #4: "saved mode only").
   The scope note's `provider:draft:<apiType>` entity was deliberately not
   implemented — a draft is never persisted, so there is no entity to audit
   (consistent with "no audit for uncreated entities").
4. **The ollama dead-port e2e passes an explicit `model`** — saved-mode model
   resolution otherwise defaults to catalog enumeration, which would 400 on a
   dead port *before* reaching the inference call. Passing `model` goes
   straight to the generate → `network` (the specced failure mode).
5. **OpenAPI wiring via the controller, not `provider.ts`** — the contract
   imports `providerConfigSchema` from `provider.ts`; importing the contract
   *back* into `provider.ts` would be circular. The controller imports both
   (the existing pattern), which is enough for the OpenAPI generator.

## Scope

### New files

- `src/http/contracts/providerConnectionTest.ts` — request/response Zod
  schemas with `.describe()` on every field and `.openapi('Name')` on the
  reusable `ConnectionTestResult` sub-schema (before modifiers).

### Modified files

- `src/http/controllers/ProviderController.ts` — route + handler
  (private method, `asyncHandler`).
- `src/services/AuditService.ts` — small public `logEvent(...)` wrapper
  over the private `logChange()` (entity `provider:<id>`, action
  `provider.connection_test`, newValue = the test result; draft mode:
  entity `provider:draft:<apiType>`).
- `src/http/contracts/provider.ts` — import the new contract so OpenAPI
  picks it up (follow the existing pattern).

## Implementation requirements

1. **Request** (discriminated union):
   - saved: `{ providerId, model?, voice?, write? }`
   - draft: `{ providerType, apiType, config, model?, voice?, write? }`
   - `providerId` XOR `{providerType,apiType,config}` (exactly one mode →
     else 400); draft `config` validated by the same per-apiType schema the
     create endpoint uses (no duplicate schema — import it).
2. **Response:** always `200` with the structured
   `{ ok, providerType, apiType, protocol, phase, latencyMs, errorCode,
   errorText, detail }` on vendor failure — the Console needs the
   structured result. Only guard errors use non-200: 400 (bad payload /
   draft without `model` for LLM / unknown type), 401/403 (RBAC), 404
   (provider not found), 429 (5 s cooldown, `Retry-After` header).
3. **RBAC:** `checkPermissions(req, [PROVIDER_READ])` in the controller +
   `requirePermission` in the service — the test performs read-equivalent
   actions only (it may write+delete one temp storage object, cleaned up
   server-side, which `provider:read` scopes).
4. **Audit:** saved mode only — `provider.connection_test` with the result
   (drafts are never persisted → no audit row; consistent with "no audit
   for uncreated entities").
5. **OpenAPI:** `getOpenAPIPaths()` entry; `npm run build` (contracts +
   cli generate) must pass with the new path.

## Acceptance criteria

- Swagger shows the endpoint with the discriminated-union schema and the
  `ConnectionTestResult` component.
- RBAC matrix tested (below).

## Tests

**E2e** (`tests/e2e/provider-connection-test.test.ts`):

- saved `storage/local` (temp dir) → 200 `ok:true`;
- saved `llm/ollama` against a dead port → 200 `ok:false, errorCode
  'network'` (never 500);
- draft LLM without `model` → 400;
- draft with an invalid config → 400 (create-schema errors);
- both `providerId` and draft fields → 400;
- non-existent providerId → 404;
- rapid second call within 5 s → 429 + `Retry-After`;
- RBAC: viewer (no `provider:read`) → 403; super_admin → 200;
- saved test → audit row `provider.connection_test` present with the
  result; draft test → no audit row;
- saved channel provider (before TPC-08 lands) → 400 `InvalidOperationError`
  (registered-types guard).

## Out of scope

- The strategies themselves (TPC-02…05), call-log/alert interplay
  (TPC-07), channels (TPC-08).
