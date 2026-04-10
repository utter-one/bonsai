# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2026-04-10

### Breaking Changes

- **`conversationId` removed from `startConversation` WebSocket message** — the field was previously accepted (and ignored) in the session start request; it has been removed from the schema entirely.
- **Action effect events deprecated** — individual action effect events are replaced by a single `executionPlan` event emitted at the start of action execution. The old per-effect events are still emitted for now but are considered deprecated and will be removed in a future release.
- **`linear16` audio format removed** — the audio format option `linear16` has been removed from the TTS provider schemas and channel configuration. Use `pcm_16000` instead.

### Added

- **Communication channel architecture** — a new pluggable channel system (`IClientConnection`) decouples the conversation engine from transport. Channels supported in this release:
  - **WebSocket channel** — existing real-time WebSocket transport, now a first-class channel.
  - **WebRTC channel** — new channel for real-time audio communication over WebRTC.
  - **Twilio Messaging channel** — inbound/outbound SMS and WhatsApp messaging via the Twilio API with webhook signature validation.
  - **Twilio Voice channel** — inbound phone calls via Twilio Media Streams with audio streaming and DTMF support.
- **Server-side Voice Activity Detection (VAD)** — experimental server-side VAD mode for voice conversations, with pre-warming of ASR sessions and improved handling of audio that arrives during the awaiting-user-input state.
- **Sample Copy system** — a new content distribution mechanism that lets you define a pool of sample AI response copies:
  - `SampleCopy` entity with CRUD API (`/api/projects/:projectId/sample-copies`).
  - `CopyDecorator` entity for decorating selected copies with additional instructions (`/api/projects/:projectId/copy-decorators`).
  - Project-level sample copy settings (classifier assignment, distribution weights).
  - Forced-mode support: a sample copy can force-replace the LLM response.
  - Sample copy selection is tracked as a conversation event.
- **Slice-and-dice analytics query engine** — a new flexible analytics sub-system:
  - Data sources: conversations, tool calls, classifications, context transformations, LLM events.
  - Dimensions include `stageName`, `provider`, `model`, and more.
  - `normalizeBy` parameter for two-phase aggregation.
  - Relative time range support (e.g. `last_7_days`).
  - **Saved Slice Queries** — persist and manage named slice queries with metadata via `/api/projects/:projectId/saved-slice-queries`.
- **Token usage statistics and trend endpoints** — new analytics endpoints exposing LLM token consumption and trends.
- **User banning** — admins can ban users; a `banUser` action effect is available in stage actions.
- **Audio format negotiation and conversion** — the server now negotiates the optimal audio format with the client and performs on-the-fly conversion (via `ffmpeg` / `SpeexResampler`) when necessary. Mind the latency tax!
- **Content moderation execution modes** — `strict` (block on any hit) and `standard` (block only on high-confidence hits) execution modes for the moderation pipeline.
- **Execution plan event** — a single `executionPlan` WebSocket event is emitted at the start of action execution, replacing the previous per-effect event stream.
- **Detailed timing metrics** — new timing fields throughout the analytics and conversation event pipeline: TTS connection time, stage-transition duration, prompt-render time, turn-end timestamp, and more.
- **API key channel and feature permission types** — extended `ApiKeyChannel` enum with Twilio voice and messaging; new feature-level permission scopes for channels.
- **Permissions in authentication responses** — `POST /api/auth/login` and `POST /api/auth/refresh` now include the resolved permissions list for the authenticated user alongside roles.
- **Schema validation for WebSocket message handlers** — all incoming WebSocket messages are validated against the contract schema before dispatch.
- **Channel catalog** — a `ChannelCatalog` class exposes metadata and JSON schemas for all registered channel types.
- **`version` field** in capability responses — versions are surfaced through channel descriptors.

### Fixed

- OpenAI TTS provider was not sending the last sentence of a response.
- Forced copy and filler responses could be silently overwritten by subsequent LLM output.
- Sample copy classifier could produce an empty candidate list, causing an unhandled error.
- Duplicate entries in round-robin copy distribution.
- Empty messages were being added to conversation history.
- No speech was generated when a conversation ended or was aborted mid-turn.
- Entity audit logs were not filtered by `projectId`, leaking entries across projects.
- Deleting a project failed when associated user or guardrail entities existed (foreign key constraint).
- Tool validation was incorrectly allowing `null` values in required fields.
- `firstTokenMs` timing metric was recorded even when `llmStartMs` was absent, producing invalid deltas.
- Turn data was not reset when a client-initiated action started a new turn, causing skewed timing metrics in analytics.

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
