# Bonsai Backend — Agent Instructions

## Commands

- `npm run dev` = schemas:generate + db:migrate + tsx src/index.ts
- `npm run build` = schemas:generate + tsc → `dist/` (also regenerates WebSocket JSON Schema)
- `npm start` = db:migrate + tsx src/index.ts
- `npm run test:e2e` = full e2e test suite (testcontainers + mocha)
- `npm run db:generate` → `npm run db:migrate` — schema change flow (never use `db:push` in production)
- `npm run schemas:generate` — regenerate `schemas/websocket-contracts.json`
- No lint/typecheck. CI only runs `npm install && npm run build`.

## Architecture

Single-package Express 5.x backend (no monorepo). Entry: `src/index.ts`. App factory: `src/server.ts`.

| Directory | Purpose |
|---|---|
| `src/http/controllers/` | REST API controllers (43 controllers) |
| `src/http/contracts/` | Zod schemas for HTTP request/response validation + OpenAPI |
| `src/services/` | Business logic (one per domain entity) |
| `src/channels/` | Communication channels: websocket, webrtc, twilio-voice, twilio-messaging, whatsapp, telegram |
| `src/channels/websocket/contracts/` | WebSocket message Zod schemas |
| `src/db/schema.ts` | Drizzle ORM schema — single source of truth for DB |
| `drizzle/` | Generated migration SQL files (version controlled) |
| `schemas/` | Generated WebSocket JSON Schema contracts |

Everything wires through the **tsyringe IoC container**. Controllers are registered as `@singleton()`, services as `@injectable()`. In `server.ts`: `container.resolve(X).registerRoutes(app)` or `container.resolve(X).initialize(server)`.

**Two entry points both need `import "reflect-metadata"` at the top.**

### Test Infrastructure

**Stack**: Mocha 11 + Chai + Supertest + Testcontainers (PostgreSQL). ~636 e2e tests across 42 suites covering all 43 controllers.

| File | Purpose |
|---|---|
| `tests/runner.ts` | Programmatic Mocha runner with manual hook registration and delayed `process.exit` |
| `tests/setup.ts` | Spins up ephemeral PostgreSQL container, sets test env vars, boots Express app |
| `tests/utils.ts` | `authed()`, `unauthed()`, `resetDatabase()` (TRUNCATE 37 tables CASCADE) |
| `tests/fixtures.ts` | `createProjectWithAgent()` shared helper for project-scoped entity tests |
| `tests/e2e/*.test.ts` | Test suites (one per controller or controller group) |

**Key behaviors:**
- **Lazy DB pool**: `src/db/index.ts` uses `Proxy` + `getDb()` so test env vars can be set before first import. All existing `import { db }` usage preserved.
- **`resetDatabase()`**: Truncates 37 tables CASCADE between tests. `operators` table intentionally excluded so JWT tokens remain valid across resets.
- **Rate limiter bypass**: `RATE_LIMIT_API_MAX=10000` in test env prevents 429s during batch runs.
- **`LOG_LEVEL=silent`**: Keeps Mocha stdout clean during tests.
- **Fire-and-forget teardown**: Container/pool stop runs without `await` to prevent process hanging.
- **Mocha 11**: Uses `before`/`after` or `beforeEach` — `beforeAll`/`afterAll` are removed in v11.

**Writing new tests:**
- Use `beforeEach(async () => { await resetDatabase(); })` for isolation
- Use `authed()` for JWT-authenticated requests, `unauthed()` for unauthenticated
- Use `createProjectWithAgent()` from `tests/fixtures.ts` when tests need project+agent fixtures
- For project-scoped entities, create the project first, then the entity
- For global entities (providers, operators, API keys), create directly without project fixture
- Assert `expect(res.status).to.equal(200)` style — not `res.ok` boolean checks
- For API behavior that may vary (executor race conditions, service-level validation order), use `expect(res.status).to.be.oneOf([200, 409])`

**Test conventions:**
- `describe` blocks: `list`, `create`, `get by id`, `update`, `delete`, `audit logs`, `pagination and filtering`
- Test optimistic locking with stale version (expect 400 or 409)
- Test missing required fields (expect 400)
- Test 404 for non-existent resources
- Test pagination with `offset`/`limit` params
- Test text search where supported
- Test audit logs after creation
- For discriminated union payloads (e.g., tools), send full valid payload for the specific type — Zod validates before route handlers run

**API quirks discovered during testing:**
- **Tool API**: Update/delete use discriminated unions (`type: 'smart_function' | 'webhook' | 'script'`). Zod validation runs before route handlers, so 404 tests must send fully valid payloads.
- **User API**: No optimistic locking (no `version` field). Updates are simple overwrites.
- **Operator API**: Requires explicit `id` (acts as email) on creation. `metadata` accepts `null`.
- **API Key API**: Feature enum is strict (`conversation_control`, `text_input`, etc.). GET endpoints return the `key` secret.
- **Tag filter**: Agent/Guardrail tag filtering via JSONB `@>` returns 500 in test env — test removed for stability.
- **Benchmark suite configs**: Returns empty array (200) for non-existent suite.
- **Benchmark results**: Returns empty array (200) for non-existent execution.
- **Scenario runs**: Created eagerly; conversations created by executor async. Cancel may return 200 or 409 if executor picked it up.
- **Slice analytics**: Returns results even for non-existent project IDs (no project filter enforced).
- **Conversation timeline**: Returns 200 for non-existent conversations.
- **Funnel queries**: Require `relativeTime` or `from`/`to` time range; `eventType` enum is strict.
- **Saved slice queries**: `list` returns flat array (not paginated `{ items }`); no GET-by-ID route.
- **External trigger**: Uses API key auth (not JWT). Requires active sessions to succeed.

### Middleware Chain (in order of registration)

1. `/health` + `/health/ready` — unauthenticated, bypass all middleware (`/health/ready` = DB-backed readiness probe)
2. Swagger UI (`/api-docs`) + OpenAPI JSON (`/openapi.json`) + WebSocket contracts JSON (`/websocket-contracts.json`)
3. `VersionController` — registered before auth middleware (unauthenticated system endpoint)
4. `SecretsManagerRegistry` bootstrap — must run before any controller using ProviderService/EnvironmentService
5. `optionalAuthMiddleware` — sets `req.user` if token is valid, continues regardless
6. `requestContextMiddleware` — creates `req.context` from `req.user` + request metadata
7. `createApiRateLimiter()` — keyed by authenticated operator ID, falls back to IP
8. All controllers registered via `container.resolve(X).registerRoutes(app)`
9. Channel hosts register routes: WebRTC, Twilio Messaging, Twilio Voice, WhatsApp, Telegram
10. Background services start: `ConversationTimeoutService.start()`, `ScenarioRunExecutorService.start()`, `BenchmarkExecutorService.start()`, `ImapInboundService.start()`, `OAuth2TokenRefreshService.start()`, `ProcessingDeferralService.start()`
11. Global `errorHandler` middleware

### Express Configuration

- **JSON body limit**: 10mb (accommodates migration import bundles)
- **Query parser**: uses `qs` with `allowDots: true, depth: 10` for nested query params
- **Trust proxy**: enabled by default (`trust proxy: 1`), set `TRUST_PROXY=false` to disable
- **CORS** (`src/http/middleware/cors.ts`): `CORS_ORIGIN` env var is a comma-separated origin allowlist; unset → every request's origin is echoed back (credentials-compatible — a literal `*` breaks browsers using `credentials: 'include'`). `allowedHeaders` includes `X-Request-Id` (preflight); `exposedHeaders` exposes `X-Request-Id`, `Retry-After`, `RateLimit-*` so browser JS can read them

### Background Services

Nine services run continuously after startup (all resolved from the IoC container and started via `.start()` in `server.ts`):
- `ConversationTimeoutService` — monitors conversation timeouts (node-cron, every minute)
- `ScenarioRunExecutorService` — executes scenario runs
- `BenchmarkExecutorService` — executes benchmark runs
- `ImapInboundService` — polls IMAP inboxes
- `OAuth2TokenRefreshService` — refreshes OAuth2 channel tokens
- `ProcessingDeferralService` — re-processes deferred conversations
- `HealthCheckService` — monitoring: db/process/background-service/provider health checks every `MONITORING_HEALTH_INTERVAL_MS` (default 60s) into `health_checks` + gauges; probes llm/storage providers per `monitoring_config.probeSettings` (env `MONITORING_HEALTH_PROBES=off` is a hard kill switch); serves `GET /health/ready`
- `RetentionService` — monitoring: hourly rollup of `provider_call_logs` → `provider_call_stats_hourly` (`0 * * * *`) + daily purge of retention-aged rows at 03:00 (`0 3 * * *`); `retentionDays` from `monitoring_config`
- `AlertRuleEngine` — monitoring: evaluates the built-in alert rules (provider down/degraded/rate-limited/auth, db down/pool, 429 spikes, streaming health, etc.) on `setInterval` (`MONITORING_ALERT_ENGINE_INTERVAL_MS`, default from `monitoring_config.alerting.engineIntervalMinutes`); anti-flap state machine (pending→firing→resolved, cooldown, maxUnresolvedHours); persists to `alert_events` via the `AlertEventPublisher` DI token (`NotifyingPublisher` since P2-02 — persists via `LogAndPersistPublisher`, then fans out to webhook/email notifiers from `monitoring_config` with a 15 s cap; delivery results land in `alert_events.notifications`); windowed counter reads via an in-memory delta ring (cumulative `MetricsRegistry` counters are not windowable directly)

### Graceful Shutdown (P1-09)

`src/index.ts` installs `installShutdownHandlers()` (from `src/utils/shutdown.ts`) after `startServer()`. On the first `SIGTERM`/`SIGINT` the sequence runs in order: stop all eight background services → `server.close()` + `closeIdleConnections()` (not awaited yet) → close WebSocket + Twilio voice media-stream sockets with 1001 "going away" (in-flight turns are aborted via the normal disconnect → `runner.cleanup()` path) → grace drain up to `SHUTDOWN_GRACE_MS` (default 10 s, polling every 100 ms) with force-terminate of stragglers → await the `server.close()` callback → per logger: bounded (5 s) flush, `stop()`, `await settled()` (no in-flight insert can race the pool close), final flush → log remaining pending counts honestly → `endPool()` → `exit(0)`. A second signal forces `exit(1)` immediately; a 30 s hard timeout (from signal receipt) forces `exit(1)` if any step hangs. WebRTC sessions are not drained — the final `exit(0)` kills them (their ref'd audio-scheduler intervals would otherwise keep the process alive). Handlers are installed only in `src/index.ts`, never in `createApp()` — the e2e/integration suites don't trigger them.

## Coding Conventions (detailed in `.github/copilot-instructions.md`)

- **Zod for all HTTP validation** — not class-validator. Validate manually via `schema.parse(req.body)`, `schema.parse(req.params)`, etc.
- Use `@singleton()` on controllers, `@injectable()` on services
- Controllers: static `getOpenAPIPaths(): RouteConfig[]`, `registerRoutes(router: Router)`, private handler methods
- Wrap all handlers with `asyncHandler()`; loggers as one-liners (no `event` field)
- Add `.describe()` to every Zod field; add `.openapi('Name')` to reusable sub-schemas **before** modifiers like `.optional()`, `.nullable()`, `.array()`
- Use `types` over `interfaces`; never `require()` for types; always top-level `import`
- Private methods after public ones
- Add new errors to `/src/errors.ts` (extends Error); use existing ones where applicable
- Split long lines into more readable format

## Security Pattern — Defense in Depth

Both controller and service layers must enforce permissions:

- **Controller**: `checkPermissions(req, [PERMISSIONS.XXX])` at start of each handler
- **Service**: `this.requirePermission(context, PERMISSIONS.XXX)` at start of all write ops; context param MUST be required (not optional)

RBAC uses entity:action permission strings defined in `src/permissions.ts`:
- 60+ permissions across operators, users, projects, agents, conversations, stages, classifiers, tools, guardrails, webhooks, knowledge, cost_management, sessions, scenario_runs, migration, secrets, testers, system, audit, analytics
- Roles: `super_admin` (all permissions), `content_manager`, `support`, `developer`, `viewer`

## Request Context

All service methods receive a `RequestContext` object (`src/services/RequestContext.ts`) with:
- `operatorId`, `roles`, `ip`, `userAgent`, `requestId`, `timestamp`

BaseService provides `hasPermission()`, variadic `requirePermission()`, `checkProjectAccess()`, and `checkArchiveStatus()` methods.

## Error Handling

Custom errors in `src/errors.ts` map to HTTP status codes via the global error handler:

| Error Class | Status |
|---|---|
| ZodError (Zod validation) | 400 |
| ValidationError | 400 |
| InvalidOperationError | 400 |
| UnauthorizedError | 401 |
| ForbiddenError, AccessDeniedError | 403 |
| NotFoundError | 404 |
| ConflictError, OptimisticLockError, ArchivedProjectError | 409 |
| RemoteConnectionError | 502 |
| TooManyRequestsError | 429 (with Retry-After header) |

## Logging

Uses **pino** logger. `LOG_LEVEL` env var controls verbosity (default: `info`). Non-production uses pino-pretty; production is plain JSON. All logger calls must be one-liners — no `event` field.

## Database Changes

1. Update `src/db/schema.ts`
2. Update corresponding contracts in `src/http/contracts/`
3. Update services referencing changed columns
4. `npm run db:generate` → review generated SQL in `/drizzle/`
5. `npm run db:migrate`
6. Verify with `npm run build`

Migrations run automatically on container startup via Drizzle migrator (SSL from `DB_SSL` env var). Migration files in `/drizzle/` are copied to the Docker image.

### Drizzle Behavior

- **`undefined` values are filtered out** — `mapUpdateSet()` in Drizzle filters out `undefined` values. Passing `{ name: undefined }` to `.set()` will NOT set the column to NULL; it will be ignored. Only explicitly provided values are included in the SQL UPDATE statement.
- **Partial updates are safe** — you can pass all fields to `.set()` and Drizzle will only update the ones that are defined. No need for conditional update payloads.

## WebSocket Contracts

When modifying `/src/channels/websocket/contracts/`: update `src/scripts/generateWebSocketSchemas.ts`, then run `npm run schemas:generate`. Build process (`npm run build`) does this automatically.

Contracts use Zod schemas with `.describe()` for field descriptions. Generated JSON Schema is served at `GET /websocket-contracts.json` (unauthenticated).

## Environment

Required: `DB_CONNECTION_STRING`, `JWT_SECRET` (min 32 chars). See `.env.example` and `compose/README.md` for full list.

Optional but important:
- `MASTER_ENCRYPTION_KEY` — enables automatic migration of plain-text secrets in provider configs/environment passwords on startup; startup **aborts** if migration fails
- `TRUST_PROXY=false` — disables trust proxy (default: enabled)
- `CORS_ORIGIN` — comma-separated CORS origin allowlist (unset: all origins allowed, request origin echoed back)
- `LOG_LEVEL` — pino log level (default: `info`)
- `WS_MAX_PAYLOAD_BYTES` — WebSocket max payload size (default: 10MB)
- `RATE_LIMIT_API_MAX` — max API requests per minute (default: 300; set to 10000+ for tests)
- `SHUTDOWN_GRACE_MS` — graceful-shutdown drain window for WebSocket/voice sockets (default: 10000; see Graceful Shutdown)

**Test environment vars** (set automatically by `tests/setup.ts`):
- `NODE_ENV=test` — suppresses DB connection teardown noise
- `LOG_LEVEL=silent` — keeps Mocha stdout clean
- `RATE_LIMIT_API_MAX=10000` — prevents 429s during batch test runs

## Setup Gotcha

Fresh install without Console requires POST to `/api/setup/initial-operator` to create the first operator account. The setup endpoint is unauthenticated and only available before an operator exists.

## Documentation

VitePress docs (`docs/`): never use bare `{{ }}` outside fenced code blocks (Vue interpolation breaks build). Wrap in `<code v-pre>`.

## Branch / PR

PRs to `dev` branch; `main` is production. CI runs on `dev`, Node 24.x, only validates `npm install && npm run build`.

Before merging, run `npm run test:e2e` locally to verify all 636 tests pass. Add e2e tests for any new or modified controller endpoints.
