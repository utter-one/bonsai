# Bonsai Backend — Agent Instructions

## Commands

- `npm run dev` = schemas:generate + db:migrate + tsx src/index.ts
- `npm run build` = schemas:generate + tsc → `dist/` (also regenerates WebSocket JSON Schema)
- `npm start` = db:migrate + tsx src/index.ts
- `npm run db:generate` → `npm run db:migrate` — schema change flow (never use `db:push` in production)
- `npm run schemas:generate` — regenerate `schemas/websocket-contracts.json`
- No test framework, no lint/typecheck. CI only runs `npm install && npm run build`.

## Architecture

Single-package Express 5.x backend (no monorepo). Entry: `src/index.ts`. App factory: `src/server.ts`.

| Directory | Purpose |
|---|---|
| `src/http/controllers/` | REST API controllers (~28 controllers) |
| `src/http/contracts/` | Zod schemas for HTTP request/response validation + OpenAPI |
| `src/services/` | Business logic (one per domain entity) |
| `src/channels/` | Communication channels: websocket, webrtc, twilio-voice, twilio-messaging, whatsapp, telegram |
| `src/channels/websocket/contracts/` | WebSocket message Zod schemas |
| `src/db/schema.ts` | Drizzle ORM schema — single source of truth for DB |
| `drizzle/` | Generated migration SQL files (version controlled) |
| `schemas/` | Generated WebSocket JSON Schema contracts |

Everything wires through the **tsyringe IoC container**. Controllers are registered as `@singleton()`, services as `@injectable()`. In `server.ts`: `container.resolve(X).registerRoutes(app)` or `container.resolve(X).initialize(server)`.

**Two entry points both need `import "reflect-metadata"` at the top.**

### Middleware Chain (in order of registration)

1. `/health` — unauthenticated, bypasses all middleware
2. Swagger UI (`/api-docs`) + OpenAPI JSON (`/openapi.json`) + WebSocket contracts JSON (`/websocket-contracts.json`)
3. `VersionController` — registered before auth middleware (unauthenticated system endpoint)
4. `SecretsManagerRegistry` bootstrap — must run before any controller using ProviderService/EnvironmentService
5. `optionalAuthMiddleware` — sets `req.user` if token is valid, continues regardless
6. `requestContextMiddleware` — creates `req.context` from `req.user` + request metadata
7. `createApiRateLimiter()` — keyed by authenticated operator ID, falls back to IP
8. All controllers registered via `container.resolve(X).registerRoutes(app)`
9. Channel hosts register routes: WebRTC, Twilio Messaging, Twilio Voice, WhatsApp, Telegram
10. Background services start: `ConversationTimeoutService.start()`, `ScenarioRunExecutorService.start()`
11. Global `errorHandler` middleware

### Express Configuration

- **JSON body limit**: 10mb (accommodates migration import bundles)
- **Query parser**: uses `qs` with `allowDots: true, depth: 10` for nested query params
- **Trust proxy**: enabled by default (`trust proxy: 1`), set `TRUST_PROXY=false` to disable
- **CORS**: origin from `CORS_ORIGIN` env var (default `*`), credentials enabled

### Background Services

Two services run continuously after startup:
- `ConversationTimeoutService` — monitors conversation timeouts
- `ScenarioRunExecutorService` — executes scenario runs

Both are resolved from the IoC container and started via `.start()`.

## Coding Conventions (detailed in `.github/copilot-instructions.md`)

- **Zod for all HTTP validation** — not class-validator. Validate manually via `schema.parse(req.body)`, `schema.parse(req.params)`, etc.
- Use `@singleton()` on controllers, `@injectable()` on services
- Controllers: static `getOpenAPIPaths(): RouteConfig[]`, `registerRoutes(router: Router)`, private handler methods
- Wrap all handlers with `asyncHandler()`; loggers as one-liners (no `event` field)
- Add `.describe()` to every Zod field; add `.openapi('Name')` to reusable sub-schemas **before** modifiers like `.optional()`, `.nullable()`, `.array()`
- Use `types` over `interfaces`; never `require()` for types; always top-level `import`
- Private methods after public ones
- Add new errors to `/src/errors.ts` (extends Error); use existing ones where applicable

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

## WebSocket Contracts

When modifying `/src/channels/websocket/contracts/`: update `src/scripts/generateWebSocketSchemas.ts`, then run `npm run schemas:generate`. Build process (`npm run build`) does this automatically.

Contracts use Zod schemas with `.describe()` for field descriptions. Generated JSON Schema is served at `GET /websocket-contracts.json` (unauthenticated).

## Environment

Required: `DB_CONNECTION_STRING`, `JWT_SECRET` (min 32 chars). See `.env.example` and `compose/README.md` for full list.

Optional but important:
- `MASTER_ENCRYPTION_KEY` — enables automatic migration of plain-text secrets in provider configs/environment passwords on startup; startup **aborts** if migration fails
- `TRUST_PROXY=false` — disables trust proxy (default: enabled)
- `CORS_ORIGIN` — CORS allowed origin (default: `*`)
- `LOG_LEVEL` — pino log level (default: `info`)
- `WS_MAX_PAYLOAD_BYTES` — WebSocket max payload size (default: 10MB)

## Setup Gotcha

Fresh install without Console requires POST to `/api/setup/initial-operator` to create the first operator account. The setup endpoint is unauthenticated and only available before an operator exists.

## Documentation

VitePress docs (`docs/`): never use bare `{{ }}` outside fenced code blocks (Vue interpolation breaks build). Wrap in `<code v-pre>`.

## Branch / PR

PRs to `dev` branch; `main` is production. CI runs on `dev`, Node 20.x, only validates `npm install && npm run build`.
