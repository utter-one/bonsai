---
title: "P1-07 — Rate-limit (429) instrumentation"
severity: proposal
status: resolved
created: 2026-08-17
updated: 2026-08-19
assignee: ""
tags: [monitoring, spec, phase-1]
---

# P1-07 — Rate-limit (429) instrumentation

- **Phase:** 1 — Instrumentation & health
- **Depends on:** P1-02
- **Blocks:** P2-01 (`api-429-spike`, `auth-429-spike` rules)
- **Estimate:** 0.25 dev-day

## Objective

Close the 429 blind spot: today `TooManyRequestsError` → 429 with **zero logging** and the limiter handlers never log either. After this issue, every rejection is counted, labeled, and logged — enabling both "client is being throttled" visibility and brute-force detection (Phase 2).

## Scope

### Modified files
- `src/http/middleware/rateLimiter.ts` — both `createAuthRateLimiter` and `createApiRateLimiter` handlers + module-scoped stores + test-reset helper (see requirement 4) + top-N rejection map + exported key/limit helpers
- `src/errors.ts` — `TooManyRequestsError` optional `scope` constructor arg (internal only)
- `tests/setup.ts` — exposes `globalThis.__TEST_RATE_LIMITS__` (app-world reset + stats, dual-module-graph reason)
- `errorHandler.ts` is **not** modified — the spec's "pick one place" resolved to the limiter handler (it knows scope + key); the 429 branch (Retry-After fallback) stays as is

## Implementation requirements

1. In each limiter's `handler`, before `next(new TooManyRequestsError(...))`:
   - `MetricsRegistry.inc('rate_limit_rejections_total', { scope, key_type })` — `scope: 'auth' | 'api'`, `key_type: 'operator' | 'ip'` (derived from whether `req.user?.operatorId` exists at rejection time — mirrors the keyGenerator).
   - pino `warn`: `{ scope, key, path: req.path }` where `key` = the actual limiting key **hashed** (first 12 hex chars of sha256 — never log raw operator ids/IPs in a way that enables cross-referencing abuse; the hash still lets ops correlate).
2. `TooManyRequestsError` gains an optional `scope` property (`'auth' | 'api'`) set at construction in the handlers — surfaced in the error response? **No** — response body unchanged (`{ error: msg }` + `Retry-After`); scope is internal only.
3. The `rate_limit_rejections_total` counter is what P2-01's `api-429-spike`/`auth-429-spike` rules read, including per-key scoping: the metric must also record `rejections_by_key` in a small in-memory top-N map (N=10, key=hash) inside `MetricsRegistry` (or a dedicated `RateLimitRejectionTracker` in this file) so the rule can identify "one key caused >50% of rejections".
4. **Test isolation (required):** the e2e app boots once for the whole mocha process, and `tests/setup.ts` sets `RATE_LIMIT_AUTH_MAX=10000` / `RATE_LIMIT_API_MAX=10000` — so the 429 suite cannot trip the limiters the way production defaults would, and a tripped limiter would otherwise contaminate every later auth test in the process. To make the e2e deterministic and non-polluting:
   - Create the express-rate-limit stores at **module scope** (e.g. `const authStore = new MemoryStore(...)` passed into `rateLimit()`).
   - **Store reset:** express-rate-limit **8.6.1** `MemoryStore` **has** `resetAll(): Promise<void>` (clears both the current and previous sliding-window maps) — no wrapper subclass needed. Export `resetRateLimitersForTests(): Promise<void>` from `rateLimiter.ts` awaiting `resetAll()` on both module-scoped stores (the test awaits it, so the reset completes before the next request). (Do NOT try to swap store instances after middleware creation — the `rateLimit()` closure captures the store reference. The store's window-expiry timer is `unref()`'d by the library, so module-scoped stores cannot keep the process alive.)
   - Resolve the limit via a function that reads `process.env` **per request** (exported zero-arg functions `authLimit()`/`apiLimit()` wrapping `parseEnvInt`, passed as `max:` — express-rate-limit 8.6.1 normalizes `limit: passedOptions.max ?? 5`, so a function-valued `max` passes through as a `ValueDeterminingMiddleware`; keep the existing `max:` property name to minimize diff), so tests can lower/raise the limit without a restart. (`windowMs` stays static — the 60 s test window set by `tests/setup.ts` is fine.)
   - The 429 suite calls the reset in `beforeEach`/`afterEach` and restores `RATE_LIMIT_AUTH_MAX=10000` / `RATE_LIMIT_API_MAX=10000` afterward. **Dual-module-graph caveat (P1-04 lesson):** the e2e file must NOT import `resetRateLimitersForTests`/`getRateLimitRejectionStats` directly — its import loads a second module instance whose stores/map are not the app's. `tests/setup.ts` exposes `globalThis.__TEST_RATE_LIMITS__ = { reset, getStats }` (app-world references), and the counter is read via `globalThis.__TEST_METRICS_REGISTRY__` (a test-world `container.resolve(MetricsRegistry)` would return a different registry). Counter assertions use **deltas** around the loop — the counter is process-cumulative and store resets do not touch metrics.

## Acceptance criteria

- [x] In test env (`RATE_LIMIT_AUTH_MAX` lowered to 10 per requirement 4), driving auth login attempts past the limit produces 429s, each with a warn log line (hashed key) and a counter increment. — `tests/e2e/rate-limit.test.ts` "auth scope" test: 10× 401 then 429; counter delta ≥ 1; `onRejection()` logs `logger.warn({ scope, key: hashLimitKey(key), path }, 'Rate limit exceeded')`.
- [x] `rate_limit_rejections_total{scope:'auth',key_type:'ip'}` and the top-N key map reflect the test traffic. — e2e asserts `rate_limit_rejections_total['key_type=ip,scope=auth']` delta ≥ 1 and `getRateLimitRejectionStats().topKeys` contains an auth/ip entry.
- [x] API-scope rejection (operator key) increments `key_type:'operator'`. — e2e "api scope" test: 5× 200 then 429; `rate_limit_rejections_total['key_type=operator,scope=api']` delta ≥ 1; topKeys contains an api/operator entry.
- [x] Response bodies and `Retry-After` behavior unchanged (errorHandler already sets `Retry-After: 60` when absent — don't touch that). — both 429 tests assert the exact bodies (`{ error: 'Too many login attempts, please try again later' }` / `{ error: 'Too many requests, please slow down' }`) and `retry-after: '60'`; `errorHandler.ts` untouched.
- [x] **No test contamination:** after the 429 suite finishes (store reset + env restored), subsequent auth e2e tests pass normally. — dedicated "does not contaminate later tests after restore" test (429 → restore + reset → 401), plus the full 949-test e2e run green with `auth.test.ts` suites passing around it.

## Implementation (2026-08-17)

Files:
- `src/http/middleware/rateLimiter.ts` (rewritten): module-scoped `authStore`/`apiStore` (MemoryStore); exported `hashLimitKey` (12-hex sha256 prefix), `authLimit()`/`apiLimit()` (per-request env resolution), `authKey()`/`apiKey()`/`keyTypeOf()` (shared key logic — the v8.6.1 handler does not receive the key); top-N map (`REJECTION_TOP_N = 10`, min-count eviction, ties → oldest `lastRejectedAt`) with `getRateLimitRejectionStats()`; `onRejection()` (counter + map + pino warn with hashed key); `resetRateLimitersForTests(): Promise<void>` (`MemoryStore.resetAll()` on both stores + map clear).
- `src/errors.ts`: `TooManyRequestsError` optional second constructor arg `scope?: 'auth' | 'api'` (internal only, never serialized; `ConversationRunner` call site unaffected).
- `tests/setup.ts`: exposes `globalThis.__TEST_RATE_LIMITS__ = { reset, getStats }` (app-world references — dual-module-graph lesson).
- `tests/unit/monitoring/p1-07-rate-limit.test.ts`: 12 unit tests (hash determinism/format/collision-freedom, scope propagation, per-request limit resolution incl. parseEnvInt edge cases, key resolution incl. IPv6 /56, top-N empty after reset).
- `tests/e2e/rate-limit.test.ts`: 3 e2e tests (auth 429 + instrumentation, api 429 with operator key_type, no-contamination after restore).

Gates: build 0, unit 613, e2e 949, integration 35.

## Tests

- **E2E:** `beforeEach`: `resetRateLimitersForTests()` (via `globalThis.__TEST_RATE_LIMITS__`) + `process.env.RATE_LIMIT_AUTH_MAX='10'`; 11× `POST /api/auth/login` with invalid credentials (`test@example.com` + wrong password) → first 10 return 401, 11th returns 429 with `Retry-After: 60` and the unchanged body; assert counter **delta** + top-N via `globalThis.__TEST_METRICS_REGISTRY__` / `__TEST_RATE_LIMITS__.getStats()`. Second test: `RATE_LIMIT_API_MAX='5'` + 6× `authed()` `GET /api/profile` → 6th returns 429 with `key_type=operator,scope=api`. Third test: after restore, login again → 401 (not 429) — no contamination. `afterEach`: restore both env vars + reset.
- **Unit:** `hashLimitKey` (deterministic, 12 hex chars, distinct inputs → distinct hashes), `TooManyRequestsError` scope propagation (set + absent), `authLimit()`/`apiLimit()` per-request env resolution (set/unset/invalid env values → parsed vs default).

## Out of scope

- Alerting on the counter (P2-01), per-key persistent ban lists (would be a new feature, not monitoring).

## Soundness review (2026-08-17)

Findings from verifying this spec against the codebase before implementation (all reconciled into the spec above):

1. **The `ResettableMemoryStore` wrapper is unnecessary.** Verified against the installed express-rate-limit **8.6.1**: `MemoryStore.resetAll(): Promise<void>` exists (clears both the current and previous sliding-window maps; the store's expiry timer is `unref()`'d so module-scoped stores cannot keep the process alive). The spec's "no global reset" note was stale (true of v7-era MemoryStore). `resetRateLimitersForTests()` becomes `Promise<void>` awaiting `resetAll()` on both module-scoped stores.
2. **The v8.6.1 handler signature is `(req, res, next, options)` — the limited key is NOT passed** (the extra keys parameter is a later major). The handler therefore recomputes the key from a module-level keyGenerator function that is shared with the `keyGenerator` option — no duplicated key logic.
3. **Dual-module-graph test access (P1-04 lesson).** The spec's "resolve from `container` in the test" is wrong for the e2e: the test file loads in a different module graph than the app, so a test-world `container.resolve(MetricsRegistry)` and a direct `import { resetRateLimitersForTests }` would operate on different instances than the middleware. `tests/setup.ts` exposes `globalThis.__TEST_RATE_LIMITS__ = { reset, getStats }` (app-world references, same pattern as `__TEST_METRICS_REGISTRY__`). Counter assertions use deltas (process-cumulative counter; store resets don't touch metrics).
4. **`max:` with a function works in 8.6.1.** Options normalization is `limit: passedOptions.max ?? 5` — a function-valued `max` passes through untouched as a `ValueDeterminingMiddleware` (`(req, res) => number`). Zero-arg exported functions `authLimit()`/`apiLimit()` are used (JS ignores the extra middleware arguments) — directly unit-testable.
5. **No P1-02 changes needed.** `rate_limit_rejections_total` is already registered in `METRIC_CONFIGS` (counter, default `maxSeries` 50 — at most 2 scopes × 2 key_types = 4 series) and `scope`/`key_type` are already in the label allowlist.
6. **Auth-scope `key_type` is always `ip`** (login/refresh are pre-auth; `req.user` is undefined there) — still derived with the same expression as the api scope (`req.user?.operatorId ? 'operator' : 'ip')` for consistency.
7. **`TooManyRequestsError` has a third construction site** — `ConversationRunner` (runner-busy timeout) with no scope. The new scope is an **optional second constructor argument**, keeping that site valid; the response body is unchanged (spec requirement 2).
8. **The auth limiter is route-scoped in `AuthController.registerRoutes()`** (login + refresh), not in `server.ts` (only the API limiter is `app.use`'d there). The controller is `@singleton()` → one limiter instance per app boot; module-scoped stores are still the right shape (the `rateLimit()` closure captures the store reference; deterministic reset).
9. **Top-N map semantics:** module-scope in `rateLimiter.ts` (the file that knows keys/scopes), `N=10`, keyed by the 12-hex sha256 prefix, cumulative per process with min-count eviction (ties → oldest `lastRejectedAt`). The map's own `total` can be lower than the counter when more than 10 distinct keys reject; P2-01 combines the counter delta with the map for the "one key > 50%" condition. The map is cleared by `resetRateLimitersForTests()`.
10. **`errorHandler.ts` is unchanged.** The spec's own "pick one place" resolves to the limiter handler (it knows scope + key); the 429 branch (Retry-After: 60 fallback when absent) stays as is. express-rate-limit's `standardHeaders: 'draft-7'` does not set `Retry-After`, so the fallback always applies on limiter rejections.
