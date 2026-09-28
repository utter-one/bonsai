---
title: "Agentic CLI Specification — Bonsai Backend"
severity: proposal
status: open
created: 2026-06-25
updated: 2026-06-25
tags: [cli, spec, agent, architecture]
---

# Agentic CLI Specification — Bonsai Backend

**Purpose:** A Node.js CLI that wraps the Bonsai REST API, designed to be discovered and operated reliably by LLM agents (OpenCode, Claude Code and similar tools) as well as humans and scripts.

**Status:** Draft spec — adapted to Bonsai architecture.

---

## 1. Design Goals

1. **Agent-legible**: every command's `--help` output is the *de facto* schema, since there's no MCP-style machine-readable tool definition. Help text must be complete and example-driven.
2. **Deterministic output**: no TTY-sniffing or auto-detected formats. Output shape is controlled by explicit flags only.
3. **Consistent envelope**: every command returns the same JSON shape, success or failure, so the agent doesn't need to re-learn parsing per-command.
4. **Scriptable**: works equally well in CI, shell pipelines, and agent tool-call loops.
5. **Bonsai-native**: maps directly to Bonsai's project-scoped resource model, RBAC permissions, and error taxonomy.

---

## 2. Command Structure

```
bonsai <resource> <action> [identifier] [flags]
```

| Part | Description | Example |
|---|---|---|
| `resource` | Noun matching a Bonsai REST resource | `agents`, `users`, `conversations`, `projects` |
| `action` | Verb: `list`, `get`, `create`, `update`, `delete`, plus custom actions | `list`, `get`, `create`, `clone` |
| `identifier` | Positional arg for single-resource actions | `get agent_abc123` |
| `flags` | Options for filtering, body data, output control, project scope | `--project proj_xyz --json` |

### 2.1 Project Scope

Most Bonsai resources are scoped to a project. The CLI requires `--project <projectId>` for all project-scoped resources. Global resources (`projects`, `auth`, `version`) do not require this flag.

```
bonsai agents list --project proj_xyz --json
bonsai agents get agent_abc123 --project proj_xyz --json
```

The `--project` flag can be set globally in the config file so it doesn't need repeated on every command.

### 2.2 Mapping Convention (Bonsai REST → CLI)

| HTTP | CLI | Example |
|---|---|---|
| `GET /api/projects/:projectId/agents` | `agents list --project <id>` | `bonsai agents list --project proj_xyz` |
| `GET /api/projects/:projectId/agents/:id` | `agents get <id> --project <projectId>` | `bonsai agents get agent_123 --project proj_xyz` |
| `POST /api/projects/:projectId/agents` | `agents create --project <id> [--data '<json>']` | `bonsai agents create --project proj_xyz --name "Support" --data '{"prompt":"..."}'` |
| `PUT /api/projects/:projectId/agents/:id` | `agents update <id> --project <projectId> [--data '<json>']` | `bonsai agents update agent_123 --project proj_xyz --data '{"version":2}'` |
| `DELETE /api/projects/:projectId/agents/:id` | `agents delete <id> --project <projectId>` | `bonsai agents delete agent_123 --project proj_xyz` |
| `POST /api/projects/:projectId/agents/:id/clone` | `agents clone <id> --project <projectId>` | `bonsai agents clone agent_123 --project proj_xyz` |
| `POST /api/projects/:projectId/agents/:id/archive` | `projects archive <id>` | `bonsai projects archive proj_xyz` |
| `GET /api/projects/:projectId/conversations/:id/events` | `conversations events <convId> --project <projectId>` | `bonsai conversations events conv_123 --project proj_xyz` |

**Note:** Conversation creation is NOT exposed via REST — it is reserved for WebSocket/channel modules. The CLI will not have `conversations create`.

### 2.3 Available Resources

| Resource | Scope | Actions |
|---|---|---|
| `auth` | global | `login`, `refresh`, `status` |
| `projects` | global | `list`, `get`, `create`, `update`, `delete`, `archive`, `unarchive` |
| `operators` | global | `list`, `get`, `update`, `delete` |
| `agents` | project | `list`, `get`, `create`, `update`, `delete`, `clone`, `audit` |
| `users` | project | `list`, `get`, `create`, `update`, `delete`, `audit` |
| `conversations` | project | `list`, `get`, `delete`, `events`, `event`, `artifacts`, `artifact`, `artifact_download`, `audit` |
| `stages` | project | `list`, `get`, `create`, `update`, `delete` |
| `classifiers` | project | `list`, `get`, `create`, `update`, `delete` |
| `context_transformers` | project | `list`, `get`, `create`, `update`, `delete` |
| `tools` | project | `list`, `get`, `create`, `update`, `delete` |
| `global_actions` | project | `list`, `get`, `create`, `update`, `delete` |
| `guardrails` | project | `list`, `get`, `create`, `update`, `delete` |
| `sample_copies` | project | `list`, `get`, `create`, `update`, `delete` |
| `copy_decorators` | project | `list`, `get`, `create`, `update`, `delete` |
| `knowledge` | project | `list`, `get`, `create`, `update`, `delete` |
| `issues` | project | `list`, `get`, `create`, `update`, `delete` |
| `environments` | project | `list`, `get`, `create`, `update`, `delete` |
| `providers` | project | `list`, `get`, `create`, `update`, `delete` |
| `provider_catalog` | global | `list` |
| `channel_catalog` | global | `list` |
| `api_keys` | global | `list`, `get`, `create`, `delete` |
| `secrets` | global | `list`, `get`, `delete`, `reveal` |
| `testers` | project | `list`, `get`, `create`, `update`, `delete` |
| `scenarios` | project | `list`, `get`, `create`, `update`, `delete` |
| `scenario_runs` | project | `list`, `get`, `create` |
| `scenario_conversations` | project | `list`, `get` |
| `benchmarks` | project | `list`, `get`, `create`, `update`, `delete` |
| `benchmark_configs` | project | `list`, `get`, `create`, `update`, `delete` |
| `benchmark_provider_configs` | project | `list`, `get`, `create`, `update`, `delete` |
| `benchmark_runs` | project | `list`, `get`, `create` |
| `migration` | global | `export`, `import` |
| `audit` | global | `list` |
| `analytics` | global | `list`, `funnels`, `saved_queries` |
| `version` | global | `get` |

---

## 3. Global Flags

These apply to **every** command, regardless of resource:

| Flag | Type | Default | Description |
|---|---|---|---|
| `--json` | boolean | `false` | Emit the structured JSON envelope (see §4) instead of human-readable table/text output. **Required for agent use.** |
| `--quiet`, `-q` | boolean | `false` | Suppress non-essential stderr logging (progress, warnings) |
| `--verbose`, `-v` | boolean | `false` | Print request/response debug info to stderr (never stdout, so it never pollutes `--json` output) |
| `--config <path>` | string | `~/.bonsairc` | Path to config file (auth, base URL, default project) |
| `--base-url <url>` | string | from config | Override API base URL for this invocation |
| `--project <id>` | string | from config | Project ID scope for project-scoped resources |
| `--token <string>` | string | from config/env | Override Bearer token for this invocation |
| `--timeout <ms>` | number | `30000` | Request timeout |
| `--no-color` | boolean | `false` | Disable ANSI color in human-readable output (irrelevant under `--json`) |
| `--help`, `-h` | boolean | — | Print help and exit |
| `--version` | boolean | — | Print CLI version and exit |

**Rule: `--json` output is byte-clean.** Nothing but the JSON envelope is ever written to stdout when `--json` is set. All logs, warnings, and progress indicators go to stderr only.

---

## 4. Output Envelope

Every command, in `--json` mode, prints **exactly one** JSON object to stdout, followed by a newline. No streaming partial objects, no multiple top-level objects.

The envelope translates Bonsai's bare-entity responses into a consistent wrapper.

### 4.1 Success

```json
{
  "status": "ok",
  "data": { },
  "error": null,
  "meta": {
    "request_id": "req_abc123",
    "duration_ms": 142
  }
}
```

- `data` — the resource payload. Shape depends on the endpoint (object for `get`, array for `list`, `null` for `delete`/204) but is always present.
- `meta` — optional diagnostic info; safe for an agent to ignore but useful for debugging.

### 4.2 List responses (pagination)

Bonsai uses offset-based pagination with `items`, `total`, `offset`, `limit` fields.

```json
{
  "status": "ok",
  "data": [
    { "id": "agent_abc", "name": "Support Agent", "version": 3, ... }
  ],
  "error": null,
  "meta": {
    "request_id": "req_abc123",
    "duration_ms": 88,
    "pagination": {
      "offset": 0,
      "limit": 100,
      "total": 412
    }
  }
}
```

Pagination fields are always under `meta.pagination`, never mixed into `data`. The CLI extracts `items` from the Bonsai response into `data`, and moves `total`, `offset`, `limit` into `meta.pagination`.

### 4.3 Error

Bonsai's error responses use `{ "error": "<message>", "details": [...] }` format. The CLI normalizes this:

```json
{
  "status": "error",
  "data": null,
  "error": {
    "code": "NOT_FOUND",
    "message": "Agent not found",
    "http_status": 404,
    "details": null
  },
  "meta": {
    "request_id": "req_abc123",
    "duration_ms": 31
  }
}
```

Error code mapping from Bonsai's error classes:

| Bonsai Error Class | HTTP Status | CLI `error.code` | Exit Code |
|---|---|---|---|
| `ZodError` | 400 | `VALIDATION_ERROR` | 5 |
| `ValidationError` | 400 | `VALIDATION_ERROR` | 5 |
| `InvalidOperationError` | 400 | `INVALID_OPERATION` | 5 |
| `UnauthorizedError` | 401 | `UNAUTHORIZED` | 3 |
| `ForbiddenError` | 403 | `FORBIDDEN` | 3 |
| `AccessDeniedError` | 403 | `FORBIDDEN` | 3 |
| `NotFoundError` | 404 | `NOT_FOUND` | 4 |
| `ConflictError` | 409 | `CONFLICT` | 6 |
| `OptimisticLockError` | 409 | `CONFLICT` | 6 |
| `ArchivedProjectError` | 409 | `ARCHIVED_PROJECT` | 6 |
| `TooManyRequestsError` | 429 | `RATE_LIMITED` | 7 |
| `RemoteConnectionError` | 502 | `REMOTE_ERROR` | 10 |
| `OAuthTokenRefreshError` | 502 | `REMOTE_ERROR` | 10 |
| Unknown / 500 | 500 | `INTERNAL_ERROR` | 10 |

### 4.4 Validation error detail shape

Bonsai's Zod validation errors include structured `details` with `code`, `path`, and `message` per issue. The CLI preserves this:

```json
{
  "status": "error",
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "http_status": 400,
    "details": {
      "fields": [
        { "field": "name", "code": "invalid_type", "message": "Expected string, received number" },
        { "field": "llm_settings.provider", "code": "invalid_enum_value", "message": "Invalid provider" }
      ]
    }
  },
  "meta": { "request_id": "req_abc123", "duration_ms": 22 }
}
```

This lets an agent retry with corrected arguments without re-parsing prose.

---

## 5. Exit Codes

Exit codes are the **first** signal an agent or script should check, before parsing JSON.

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Generic/unclassified error |
| `2` | CLI usage error (bad flags, missing required arg, missing `--project`) |
| `3` | Authentication/authorization failure (`401`/`403`) |
| `4` | Resource not found (`404`) |
| `5` | Validation / bad request (`400`) |
| `6` | Conflict, optimistic lock, or archived project (`409`) |
| `7` | Rate limited (`429`) — `meta` should include `retry_after_seconds` if `Retry-After` header present |
| `8` | Network/connectivity error (could not reach backend) |
| `9` | Timeout |
| `10` | Server / remote error (`5xx`) |

**Rule:** exit code and `error.code` must always agree. Never make the agent reconcile a mismatch between the two.

---

## 6. Help Text Contract

Since there's no formal schema, `--help` is the schema. Every command's help output must include, in this order:

1. **One-line description**
2. **Usage line** showing positional args, required flags (including `--project` where applicable)
3. **Flags table**: name, type, required/optional, default, description
4. **At least one concrete example invocation**, including a realistic `--json` example with sample output
5. **Relevant error codes** this command can plausibly return
6. **Permission required** — the Bonsai permission string needed (e.g., `agent:read`)

Example (`bonsai agents create --help`):

```
Create a new agent within a project.

Permission required: agent:write

Usage:
  bonsai agents create --project <projectId> --name <name> [--data '<json>'] [flags]

Flags:
  --project <string>     required   Project ID to create the agent in
  --name <string>        required   Agent display name
  --description <string> optional   Agent description
  --data <json>          optional   Full JSON body (overrides individual flags)
  --json                 optional   Emit JSON envelope (default: false)

Example:
  bonsai agents create --project proj_xyz --name "Support Bot" \
    --data '{"prompt":"You are a helpful assistant","version":1}' --json

Sample output:
  {"status":"ok","data":{"id":"agent_abc123","projectId":"proj_xyz","name":"Support Bot","version":1,"createdAt":"2026-01-15T10:30:00.000Z","updatedAt":"2026-01-15T10:30:00.000Z"},"error":null,"meta":{...}}

Possible errors:
  VALIDATION_ERROR (exit 5) — malformed JSON or missing required fields
  FORBIDDEN (exit 3) — missing agent:write permission
  UNAUTHORIZED (exit 3) — missing or invalid auth token
```

**Top-level `--help` (no resource given)** must list every available resource with its scope (global/project) and a one-line description, so an agent can discover the full surface area in a single call.

---

## 7. Input Conventions

| Input shape | Convention |
|---|---|
| Simple scalar fields | Individual flags: `--name "Widget"`, `--version 3` |
| Complex/nested bodies | `--data '<json>'` accepting a raw JSON string, **as an alternative to** individual flags (not instead of) |
| Body from file | `--data-file ./payload.json` — useful for large or pre-generated payloads, avoids shell-escaping problems |
| Body from stdin | `--data -` reads JSON from stdin, enabling `cat payload.json \| bonsai agents create --project proj_xyz --data -` |
| Arrays/repeated values | Repeatable flags: `--tag foo --tag bar` → `["foo", "bar"]` |
| Booleans | `--active` / `--no-active` pattern (avoid `--active true`) |
| Provider settings | `--data '<json>'` — provider-specific LLM/TTS/VAD settings are complex discriminated unions; individual flags are impractical |

**Precedence when multiple input methods are given:** `--data-file` / `--data -` > `--data` > individual field flags > defaults.

**Optimistic locking:** For `update` and `delete` actions, the CLI must include `--version <number>` to satisfy Bonsai's optimistic locking requirement. If omitted, the CLI should fetch the current entity first to determine its version (or fail with exit code `2`).

---

## 8. Authentication & Configuration

### 8.1 Config Resolution Order

CLI flags > environment variables > config file > none (error).

### 8.2 Environment Variables

| Variable | Description |
|---|---|
| `BONSAI_API_BASE_URL` | API base URL (e.g., `https://api.bonsai.example.com`) |
| `BONSAI_API_TOKEN` | Bearer JWT access token |
| `BONSAI_PROJECT_ID` | Default project ID scope |
| `BONSAI_CONFIG_PATH` | Override config file path |

### 8.3 Config File (`~/.bonsairc`)

```json
{
  "baseUrl": "https://api.bonsai.example.com",
  "token": "eyJ...",
  "project": "proj_xyz",
  "timeout": 30000
}
```

### 8.4 Auth Commands

| Command | Purpose |
|---|---|
| `bonsai auth login --email <email> --password <pass>` | Authenticate via `/api/auth/login`, cache tokens |
| `bonsai auth refresh` | Exchange cached refresh token for new access token |
| `bonsai auth status --json` | Report credential state without hitting a resource endpoint |

For agent use, prefer `BONSAI_API_TOKEN` environment variable so no interactive step is ever required. `bonsai auth status --json` should report whether credentials are present and valid.

### 8.5 Token Caching

The CLI should cache both access and refresh tokens locally. When an access token expires (401 response), the CLI should automatically attempt refresh before failing. Under `--json`, auto-refresh attempts are logged to stderr only.

---

## 9. Discovery Commands (agent-friendly introspection)

These let an agent learn the CLI's surface without trial-and-error:

| Command | Purpose |
|---|---|
| `bonsai resources --json` | Lists all available resources, their scope, and supported actions |
| `bonsai <resource> --help` | Lists all actions for a resource |
| `bonsai <resource> <action> --json-schema` | Prints the JSON Schema of the expected response/request shape, derived from Bonsai's OpenAPI spec |
| `bonsai openapi --json` | Fetches and prints the full OpenAPI spec from `/openapi.json` |
| `bonsai openapi --save <path>` | Downloads the OpenAPI spec to a local file for offline use |

The `--json-schema` flag is derived from Bonsai's bundled OpenAPI spec (`/openapi.json`), which is generated from Zod contracts at build time. The CLI can bundle this spec or fetch it on demand.

---

## 10. Filtering & Query Parameters

Bonsai's list endpoints support rich query parameters. The CLI exposes them as flags:

| Bonsai Query Param | CLI Flag | Example |
|---|---|---|
| `offset` | `--offset <n>` | `--offset 100` |
| `limit` | `--limit <n>` | `--limit 50` |
| `textSearch` | `--search <query>` | `--search "support"` |
| `orderBy` | `--order <field>` | `--order -createdAt` (prefix `-` for descending) |
| `filters[field][op]` | `--filter <field>:<op>:<value>` | `--filter name:like:test --filter status:in:active,completed` |

Supported filter operators: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `like`, `in`, `nin`, `between`.

---

## 11. Logging & Side Channels

- **stdout**: reserved exclusively for command output (JSON envelope or human-readable result). Nothing else, ever, under `--json`.
- **stderr**: progress messages, warnings, `--verbose` debug traces, deprecation notices, auto-refresh attempts.
- No interactive prompts when `--json` is set or when stdin is not a TTY — fail fast with a usage error (exit `2`) instead of hanging waiting for input.

---

## 12. Versioning & Stability

- `bonsai --version` reports semantic version.
- `error.code` values are part of the CLI's public contract and must be additive-only.
- The JSON envelope shape (`status`/`data`/`error`/`meta`) is a stable contract across minor versions.
- CLI should track Bonsai API version via `bonsai version get` (maps to `/api/version` endpoint).

---

## 13. Implementation Notes

### Framework

Recommended: **Commander.js** or **clipanion**. Both support nested commands (`resource action`), flag definitions, and `--help` generation. Commander is simpler; clipanion offers better TypeScript inference.

### OpenAPI Integration

Bonsai serves its OpenAPI spec at `/openapi.json`. The CLI should:
1. Fetch the spec at install/build time and bundle it
2. Use the bundled spec to generate `--json-schema` output and `--help` examples
3. Offer `bonsai openapi --refresh` to re-fetch the spec

### Error Translation

The CLI's error translator maps Bonsai's response shape to the envelope:

```typescript
function translateError(response: AxiosResponse): CliErrorEnvelope {
  const body = response.data as { error: string; details?: any };
  const code = mapErrorCode(response.status, body.error);
  return {
    status: 'error',
    data: null,
    error: {
      code,
      message: body.error,
      http_status: response.status,
      details: body.details ? translateDetails(body.details) : null,
    },
    meta: { duration_ms: /* ... */ },
  };
}
```

### WebSocket Note

Conversation creation and real-time interaction happen via WebSocket, not REST. The CLI is scoped to REST-only operations. For WebSocket interaction, a separate `bonsai ws` sub-command or tool may be designed later, but is out of scope for this specification.

---

## 14. Non-Goals

- This spec does not define WebSocket/real-time interaction — only REST API wrapping.
- This spec does not mandate a specific Node CLI framework.
- This spec does not replace MCP for use cases requiring multi-client tool discovery. It is scoped to "a CLI that happens to be agent-friendly."
- This spec does not cover the Bonsai Console (web UI) — only the REST API surface.

---

## 15. Implementation Progress (as of 2026-06-25)

### Completed

| Section | Feature |
|---|---|
| §2 | Command structure — `resource action [args] [flags]`, 62 resources, ~200 operations |
| §2.1 | Project scope — `--project` on project-scoped resources, detected from `/projects/{projectId}/` paths |
| §3 | Global flags — `--json`, `--verbose`, `--quiet`, `--base-url`, `--project`, `--token`, `--timeout`, `--version`, `--help` |
| §4 | Output envelope — `status`/`data`/`error`/`meta` shape, success and error |
| §4.2 | Pagination — `--paginate` flag auto-fetches all pages, extracts `items` into `data` |
| §4.3 | Error mapping — HTTP status → `error.code` mapping, exit codes 0-10 |
| §5 | Exit codes — 0-10 mapping implemented, consistent with `error.code` |
| §7 | Input conventions — `--data <json>`, `--data-file <path>`, `--data -` (stdin) |
| §8.1-8.3 | Config resolution — flags > env vars > `~/.bonsairc` > defaults |
| §8.4 | Auth commands — `auth login`, `auth logout`, `auth status` |
| §8.5 | Token caching — access + refresh tokens persisted, auto-refresh on 401 |
| §9 | Discovery — `resources --json`, `--json-schema`, `openapi dump/paths/schemas/schema` |
| §11 | Logging — stdout reserved for output only, stderr for logs/verbose |
| §12 | Versioning — `--version` reports semver |
| §13 | OpenAPI — bundled spec at build time, full codegen from OpenAPI |

### Gaps

| Section | Missing | Priority |
|---|---|---|
| §3 | `--config <path>` CLI flag (env `BONSAI_CONFIG_PATH` works, but no flag) | Low |
| §3 | `--no-color` flag | Low |
| §5 | Exit code 9 (timeout) — all network errors map to exit 8, no timeout distinction | Low |
| **§6** | **Help text** — no examples, permission strings, or error codes in `--help` output | **High** |
| §7 | Boolean `--active`/`--no-active` pattern | Low |
| §8.4 | `auth refresh` — auto-refresh works, but no manual command | Low |
| §12 | `version get` command — `version` resource not generated | Low |

### Completed (2026-06-26)

| Section | Feature |
|---|---|
| §4.2 | `meta.pagination` — single-page list responses include `offset`/`limit`/`total` in `meta.pagination` |
| §4.4 | Validation detail shape — Zod `details` transformed to `{ fields: [{ field, code, message }] }` |
| §7 | Repeatable flags — array-type query params (e.g. `--groupBy`, `--metrics`) accept repeated values |
| §7 | Optimistic locking — `--version <number>` flag on update/delete operations |
| §9 | `openapi dump --save <path>` and `openapi refresh` subcommands |
| §10 | Filtering aliases — `--search`, `--order`, `--filter` map to `textSearch`, `orderBy`, `filters` |

### Biggest Gap: §6 Help Text

Spec requires every command's `--help` to include examples, permission strings, and possible error codes. Generated commands currently only have the operation summary. Two approaches:

1. **OpenAPI `x-` extensions** — add `x-example`, `x-permission`, `x-errors` to controller `getOpenAPIPaths()`, then codegen reads them into help text.
2. **Permission mapping** — separate mapping file `resource:action → PERMISSIONS.XXX`, codegen injects into help.

Approach 1 is preferred (single source of truth, no separate mapping to maintain).

### Architecture Notes

- Codegen: `src/scripts/generateCli.ts` → parses OpenAPI → generates `cli/src/generated/{resources.ts, commands.ts}` + `cli/src/index.ts`
- CLI lib: `cli/src/lib/` — `config.ts`, `http.ts`, `handler.ts`, `output.ts`, `errors.ts`, `auth.ts`, `openapi.ts`, `schema.ts`, `constants.ts`
- Build: `npm run build` at root triggers codegen + TypeScript compilation
- Branch: `cli` branch, commits `3e2ece0` through `5901f93`
