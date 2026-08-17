---
title: "P1-07 — Rate-limit (429) instrumentation"
severity: proposal
status: open
created: 2026-08-17
updated: 2026-08-17
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
- `src/http/middleware/rateLimiter.ts` — both `createAuthRateLimiter` and `createApiRateLimiter` handlers + module-scoped stores + test-reset helper (see requirement 4)
- `src/http/middleware/errorHandler.ts` — 429 branch: add pino warn (only if the limiter handler didn't already log — pass a flag via the error, or log exclusively in the limiter handler; **pick one place**: the limiter handler, since it knows key type)

## Implementation requirements

1. In each limiter's `handler`, before `next(new TooManyRequestsError(...))`:
   - `MetricsRegistry.inc('rate_limit_rejections_total', { scope, key_type })` — `scope: 'auth' | 'api'`, `key_type: 'operator' | 'ip'` (derived from whether `req.user?.operatorId` exists at rejection time — mirrors the keyGenerator).
   - pino `warn`: `{ scope, key, path: req.path }` where `key` = the actual limiting key **hashed** (first 12 hex chars of sha256 — never log raw operator ids/IPs in a way that enables cross-referencing abuse; the hash still lets ops correlate).
2. `TooManyRequestsError` gains an optional `scope` property (`'auth' | 'api'`) set at construction in the handlers — surfaced in the error response? **No** — response body unchanged (`{ error: msg }` + `Retry-After`); scope is internal only.
3. The `rate_limit_rejections_total` counter is what P2-01's `api-429-spike`/`auth-429-spike` rules read, including per-key scoping: the metric must also record `rejections_by_key` in a small in-memory top-N map (N=10, key=hash) inside `MetricsRegistry` (or a dedicated `RateLimitRejectionTracker` in this file) so the rule can identify "one key caused >50% of rejections".
4. **Test isolation (required):** the e2e app boots once for the whole mocha process, and `tests/setup.ts` sets `RATE_LIMIT_AUTH_MAX=10000` / `RATE_LIMIT_API_MAX=10000` — so the 429 suite cannot trip the limiters the way production defaults would, and a tripped limiter would otherwise contaminate every later auth test in the process. To make the e2e deterministic and non-polluting:
   - Create the express-rate-limit stores at **module scope** (e.g. `const authStore = new MemoryStore(...)` passed into `rateLimit()`).
   - **Store reset:** verified against the installed version (express-rate-limit **8.6.1**): `MemoryStore` has **no global `reset()`** — only `resetKey(key)`. So define a small `ResettableMemoryStore extends MemoryStore` in `rateLimiter.ts` that records touched keys on `increment()` and exposes `resetAll()` (iterates `resetKey` over recorded keys). Export `resetRateLimitersForTests()` from `rateLimiter.ts` calling `resetAll()` on both module-scoped stores. (Do NOT try to swap store instances after middleware creation — the `rateLimit()` closure captures the store reference.)
   - Resolve the limit via a function that reads `process.env` **per request** (`max: () => parseEnvInt('RATE_LIMIT_AUTH_MAX', 10)` — express-rate-limit v8 accepts a function for `max`/`limit`; keep the existing `max:` property name to minimize diff), so tests can lower/raise the limit without a restart. (`windowMs` stays static — the 60 s test window set by `tests/setup.ts` is fine.)
   - The 429 suite calls the reset in `beforeEach`/`afterEach` and restores `RATE_LIMIT_AUTH_MAX=10000` afterward.

## Acceptance criteria

- [ ] In test env (`RATE_LIMIT_AUTH_MAX` lowered to 10 per requirement 4), driving auth login attempts past the limit produces 429s, each with a warn log line (hashed key) and a counter increment.
- [ ] `rate_limit_rejections_total{scope:'auth',key_type:'ip'}` and the top-N key map reflect the test traffic.
- [ ] API-scope rejection (operator key) increments `key_type:'operator'`.
- [ ] Response bodies and `Retry-After` behavior unchanged (errorHandler already sets `Retry-After: 60` when absent — don't touch that).
- [ ] **No test contamination:** after the 429 suite finishes (store reset + env restored), subsequent auth e2e tests pass normally.

## Tests

- **E2E:** `beforeEach`: `resetRateLimitersForTests()` + `process.env.RATE_LIMIT_AUTH_MAX='10'`; 11× `POST /api/auth/login` with invalid credentials → 11th returns 429; assert counter + top-N via the in-process `MetricsRegistry` singleton (resolve from `container` in the test); `afterEach`: restore `RATE_LIMIT_AUTH_MAX='10000'` + reset.
- **Unit:** key hashing (deterministic, truncated), scope property propagation, per-request `max` resolution.

## Out of scope

- Alerting on the counter (P2-01), per-key persistent ban lists (would be a new feature, not monitoring).
