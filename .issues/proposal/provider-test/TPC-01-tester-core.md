---
title: "TPC-01 — Tester core: types, strategy registry, guards, instance construction"
severity: proposal
status: resolved
created: 2026-08-24
updated: 2026-08-26
assignee: ""
tags: [providers, spec, connection-test, phase-1]
---

# TPC-01 — Tester core (skeleton)

- **Depends on:** (none — builds on the shipped P1-03 call-log wrappers and P1-05b provider bases)
- **Blocks:** TPC-02, TPC-03, TPC-04, TPC-05, TPC-06, TPC-07, TPC-08
- **Estimate:** 1 dev-day

## Objective

The `ProviderConnectionTester` service skeleton: uniform result type,
strategy registry, all cross-cutting guards, saved/draft instance
construction, and the CallLogger breaker-feed exclusion. The seam is proven
by the first strategy to land (TPC-02, LLM); the core is fully testable on
its own (guards + a stubbed strategy).

## Scope

### New files

- `src/services/providers/connectionTest/ProviderConnectionTester.ts`
- `src/services/providers/connectionTest/types.ts` (`ConnectionTestInput`, `ConnectionTestResult`, `TestPhase`, strategy interface)
- `src/services/providers/connectionTest/index.ts` (strategy registry: `Map<providerType, strategy>`)

### Modified files

- `src/services/providers/llm/LlmProviderFactory.ts`: expose a
  `createForTest(provider, settings)` seam (pattern: `createProviderForEnumeration`)
  — fresh instance, secrets resolved, no production call sites. (TPC-03/04/05
  add the same seam to the asr/tts/storage factories following this pattern.)
- `src/services/monitoring/CallLogger.ts`: one guard — `record()` still
  buffers test rows (ordinary `ProviderCallEntry` rows with
  `operation: '<type>.test'`) but **skips the breaker feed** for them
  (`operation.endsWith('.test')` → no `recordFailure`/`recordSuccess`), so
  manual testing can never open a breaker for real users.

## Implementation requirements

1. **Result type** (exact fields, all required unless noted):
   `ok: boolean; providerType; apiType; protocol: 'http'|'websocket'|'sdk'|'smtp'|'imap'|'local-fs'; phase: 'auth'|'session'|'first-data'|'write'; latencyMs: number; errorCode: ThirdPartyErrorCode | null; errorText?: string; detail?: Record<string, unknown>`.
   Error codes come from `classifyThirdPartyError()` (reuse, do not fork).
2. **Strategy interface + registry:** `test(input, instance, ctx) →
   ConnectionTestResult` (plus the strategy's declared timeout). Unknown
   providerType → `InvalidOperationError` (400 at the API layer) —
   forward-compatible: TPC-08/TPC-09 and future embedding providers plug in
   without changing the tester or the contract.
3. **Guards (tester-owned):**
   - cooldown 5 s per saved `providerId` / per draft key
     (`draft:<apiType>:<sha256(stableStringify(config))[:12]>`) →
     `TooManyRequestsError` (carries `Retry-After`);
   - hard timeouts per strategy (llm 30 s, asr 20 s, tts 30 s, storage 15 s,
     channel 20 s) — wrap the whole strategy body; a timeout is
     `ok:false, errorCode:'timeout'`, with the instance's `cleanup()` still
     awaited (bounded);
   - fresh instance per test (never a pooled/pre-warmed provider);
   - **test outcomes never trip the circuit breaker** (CallLogger guard,
     asserted in unit tests);
   - error-text sanitization: truncate to 500 chars; redact `Bearer <…>`,
     JWT-shaped tokens, and `key/token/secret`-pattern values before
     response or log.
4. **Draft mode:** config validated by the same per-apiType Zod schema the
   create endpoint uses; instance built from a synthetic in-memory Provider
   (`id: 'draft'`, `providerType`, `apiType`, `config`); secrets resolved via
   `secretRefUtils.resolveObject` (plaintext secrets used for the test only,
   never persisted); **no** call-log row, **no** audit row.
5. **Saved mode:** provider row loaded (404 if missing), secrets resolved,
   call-log row recorded exactly once per test (ok or failure),
   `operation = '<providerType>.test'`, `model`/`statusHttp`/`errorText`
   filled as in production calls.
6. **No exception escapes the tester** for vendor outcomes — only guard
   errors (400/404/429) throw.

## Acceptance criteria

- A registered strategy + the guards produce a uniform result for every
  vendor outcome class (auth, rate_limited, timeout, network, server_error,
  mid-stream close).
- Cooldown keying, sanitization, draft-vs-saved attribution, and
  breaker-exclusion are unit-tested (below).

## Tests

**Unit** (`tests/unit/providers/connection-test-core.test.ts`, no network):

- cooldown → `TooManyRequestsError`, correct keying (saved id vs draft key);
- sanitization vectors (Bearer token, JWT, `api_key=…`, >500 chars);
- draft vs saved attribution (draft → zero call-log rows; saved → exactly
  one row per test, ok and failure);
- breaker exclusion: 5 failed `*.test` rows do NOT open the breaker;
  5 failed production rows do;
- unknown providerType → `InvalidOperationError`;
- timeout wrap: a strategy that hangs returns `ok:false 'timeout'` and its
  `cleanup()` was awaited.

## Out of scope

- The ASR/TTS/storage strategies themselves (TPC-03/04/05 — LLM ships in
  TPC-02 to prove the seam), HTTP endpoint (TPC-06), alert interplay
  (TPC-07), channels (TPC-08), periodic probing (TPC-09).

## Resolution (2026-08-26)

Shipped: `ProviderConnectionTester.ts` + `types.ts` (guards, cooldown,
timeouts, sanitization, draft/saved construction, breaker-exclusion in
`CallLogger.record`), the factories' `createForTest` seams, and
`tests/unit/providers/connection-test-core.test.ts`.

**Architecture refinement (2026-08-26, user-directed):** the per-type
"strategy" modules (`strategies/{llm,asr,tts,storage}.ts` + the `index.ts`
registry + the `ConnectionTestStrategy` interface) were removed. The
**provider base classes now own the simple test** via a `testConnection()`
method on each base; the tester dispatches by `providerType` → resolves that
type's factory → `createForTest()` → the instance's own `testConnection()`.
The "judgment" (what success looks like for the protocol) stays next to the
production code it exercises, with a per-vendor override escape hatch for
genuinely weird cases. The tester still owns **all** cross-cutting guards
(cooldown, hard timeout wrapping build + test, fresh instance, draft
handling, monitoring context, breaker exclusion, bounded cleanup, error
classification, sanitization, and shaping the public `providerType`/
`apiType`/`protocol`/`latencyMs` from the request + a tester-owned protocol
table). `ConnectionTestOutcome` is reduced to the provider-produced fields
only (`ok`, `phase`, `errorCode`, `errorText?`, `detail?`, `model?`). The
core test stubs via a protected `buildInstanceAndTest(request, onBuilt)`
seam (`TestTester.stub`) rather than a registered strategy; the timeout seam
is `setTestTimeout(providerType, ms)`.

Two cross-module-graph pitfalls handled under tsx (ESM vs CJS): the storage
factory stamps identity **duck-typed** (not `instanceof StorageProviderBase`
— the dynamically imported provider can live in a second graph), and the
tester's `ConnectionTestFailure` check matches on the class's `name` (an own
property set in the constructor) instead of `instanceof` (dual-graph
`instanceof` is unreliable). A known test-isolation rule: the LLM
"hang" timeout test runs in **draft** mode (un-stamped → the abandoned in-flight
SDK promise records no late row whose reject timing is non-deterministic and
would otherwise leak into a later suite's recorder); provider-scoped row
assertions in the storage suite are a second line of defense.
