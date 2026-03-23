# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2026-03-20

### Breaking Changes

- **Effect types `run_script` and `call_webhook` removed** — these effect types have been removed from the `Effect` discriminated union and from the public API schemas. Existing actions that reference them will have those effects silently ignored at load time rather than failing validation. Migrate to the new first-class tool types (`script` and `webhook`).
- **Tools `POST` endpoint requires `type` field** — `POST /api/projects/:projectId/tools` now requires a `type` discriminator (`smart_function` | `webhook` | `script`) and validates a type-specific payload. Existing tools in the database are implicitly treated as `smart_function`.

### Added

- New tool execution type **`webhook`** — makes a configurable HTTP request (URL, method, headers, templated body) and stores the response in context. Replaces the `call_webhook` effect.
- New tool execution type **`script`** — executes isolated JavaScript code inside a VM context. Replaces the `run_script` effect.
- New **`change_visibility`** effect — controls visibility of messages in the current turn (`always`, `stage`, `never`, or `conditional` with a JavaScript expression).
- **Project `languageCode`** field — optional ISO language code (e.g. `en-US`) exposed in agent prompts and scripting templates as a hint for language-aware LLM calls.
- **Project import / export** via `POST /api/projects/exchange/export` and `POST /api/projects/exchange/import`. Imported project names are automatically suffixed with the import timestamp to avoid collisions.
- **REST API rate limiting** via `express-rate-limit`; proxy trust configurable via `TRUST_PROXY` environment variable.
- **WebSocket authentication rate limiting** with configurable limits per IP.
- **`toolType` field** in WebSocket tool call events, identifying the execution variant that was invoked.
- **`version` field** in `GET /api/version` response — returns the semver from `package.json`. Non-production builds also include a version suffix.
- Audit log entries for several previously untracked entity lifecycle events.
- **Project `conversationTimeoutSeconds`** field — when set to a positive integer, a background service running every minute automatically aborts active conversations that have been inactive for longer than the configured threshold. Set to `0` or `null` to disable.
- **`startingStageId` and `endingStageId`** fields on conversations — record the stage the conversation began on and the stage it was in when it reached a terminal state (finished, failed, or aborted).

### Fixed

- Classifier overrides in stage actions were not applied correctly.
- Guardrail name was assigned incorrectly in `ConversationContextBuilder`.
- Provider ID resolution for imported projects now uses combined filters, preventing stale references.
- `firstTokenMs` timing was set even when `llmStartMs` was absent.
- Turn data was not reset when a client-initiated action started a new turn, causing incorrect timing metrics.
- `GIT_COMMIT` environment variable now falls back to `SOURCE_COMMIT` when not set (Docker / CI builds).
- Message visibility was missing from prescribed and moderated messages.
- `description`, `timezone`, and `languageCode` project fields now accept `null` to explicitly clear their values.

## [0.1.0] - 2026-03-13

### Added

- Initial public release.
- Full REST API for managing projects, agents, stages, global actions, context transformers, classifiers, guardrails, tools, knowledge, providers, environments, conversations, issues, users, admins, audit logs, and API keys.
- Real-time WebSocket conversation server with voice and text input, tool calling, variable management, stage navigation, and content moderation.
- JWT-based authentication and role-based access control (RBAC) with fine-grained permissions.
- Conversation lifecycle hooks (start, resume, end, abort, failed).
- Content moderation pipeline with blocking and detected categories.
- Analytics endpoints for latency statistics and conversation timelines.
- LLM model enumeration endpoint across supported providers.
- Amazon Polly TTS provider support.
- UUIDv7-based ID generation for all entities.
- Drizzle ORM with PostgreSQL and migration-based schema management.
- OpenAPI / Swagger UI documentation at `/api-docs`.
- WebSocket contracts JSON Schema served at `/websocket-contracts.json`.
- Docker Compose setup for the full Bonsai suite.
