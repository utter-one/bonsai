---
title: "TPC-02 — POST /api/providers/test-connection endpoint, contracts, RBAC, audit"
severity: proposal
status: open
created: 2026-08-24
updated: 2026-08-24
assignee: ""
tags: [providers, spec, connection-test, phase-2, api]
---

# TPC-02 — HTTP endpoint + contracts + RBAC + audit

- **Depends on:** TPC-01
- **Blocks:** (none)
- **Estimate:** 1 dev-day

## Objective

Expose the tester as `POST /api/providers/test-connection` with a
discriminated-union request (saved provider XOR draft config), OpenAPI
contracts, house RBAC on both layers, and an audit trail entry for saved
tests.

## Scope

### New files

- `src/http/contracts/providerConnectionTest.ts` —
  `testConnectionRequestSchema` (Zod union:
  `{ providerId } | { providerType, apiType, config, model?, voice?, language?, write? }`,
  mutually exclusive — refine that exactly one mode is present),
  `connectionTestResultSchema` (every field `.describe()`d;
  `.openapi('ConnectionTestResult')` on the sub-schema **before** modifiers).

### Modified files

- `src/http/controllers/ProviderController.ts` — route +
  `getOpenAPIPaths()` entry; handler: `checkPermissions(req, [PROVIDER_READ])`,
  `schema.parse(req.body)`, delegate to service, respond **200 with the
  structured result** on vendor failure (`ok:false`), `429` on cooldown
  (`TooManyRequestsError` → existing error handler adds `Retry-After`).
- `src/services/providers/ProviderService.ts` — `testConnection(input, context)`:
  `requirePermission(context, PROVIDER_READ)` (service layer, context
  required — house rule), delegation to `ProviderConnectionTester`.
- `src/services/AuditService.ts` — public `logEvent(entityType, entityId,
  action, details, userId?)` wrapping the existing private `logChange`
  (`action: 'TEST_CONNECTION'`, `details` = result summary **without**
  secrets — the sanitized result object only). Saved mode only.

## Implementation requirements

1. Request validation runs **before** route handlers (Zod, house convention);
   draft `config` is validated by the same per-apiType schema the create
   endpoint uses (single source of truth — import, don't duplicate).
2. `model` required for LLM drafts (400 via the service's `ValidationError`
   if absent); `voice`/`language` optional passthrough.
3. Saved mode: unknown id → 404; provider type without a registered strategy
   (e.g. `channel` before TPC-04 ships) → 400
   `InvalidOperationError('no connection test registered for type …')` —
   the endpoint stays forward-compatible: TPC-04 flips the answer without
   a contract change.
4. Audit row (saved mode): `entityType 'provider'`, `action
   'TEST_CONNECTION'`, details = `{ ok, errorCode, phase, latencyMs,
   apiType, protocol }` — never config, never secrets.
5. OpenAPI: both request variants + result visible in Swagger UI;
   `npm run build` (schemas:generate + cli:generate + tsc) green.

## Acceptance criteria

- `POST /api/providers/test-connection` works in both modes against the
  running app; vendor failures return 200 + `ok:false`; guard failures map
  400/401/403/404/429 correctly.
- RBAC enforced in controller **and** service (defense in depth).
- Audit log entry present for saved tests (visible via the existing
  `GET /api/providers/:id/audit-logs`), absent for drafts.
- OpenAPI renders the new endpoint without manual edits.

## Tests

**E2E** (`tests/e2e/provider-connection-test.test.ts`):

- draft with invalid config → 400; both modes in one body → 400 (refine);
  unknown `apiType` → 400.
- saved `storage/local` provider → 200 `ok:true`, `protocol 'local-fs'`,
  audit row present, call-log row `operation 'storage.test'`.
- saved `llm/ollama` with dead `baseUrl` → 200 `ok:false`,
  `errorCode 'network'` (structured-failure contract).
- unauthed → 401; viewer role → 403; super_admin → 200.
- two rapid tests on the same saved provider → second is 429 with
  `Retry-After`.
- saved `channel` type (pre-TPC-04) → 400 `InvalidOperationError`.

## Out of scope

- Call-log/alert interplay verification (TPC-03), channel strategies
  (TPC-04), Console UI.
