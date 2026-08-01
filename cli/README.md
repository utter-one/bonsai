# Bonsai CLI

Command-line interface for the [Bonsai](../README.md) agentic platform. Wraps the entire Bonsai REST API — authenticate, manage resources, inspect schemas, and automate workflows from the terminal.

## Requirements

- **Node.js 20+**
- Access to a running Bonsai server (local or remote)

## Installation

### Option 1: Run directly from source (development)

```bash
cd cli
npm install
npx tsx src/index.ts <resource> <action> [options]
```

No build step needed — `tsx` handles TypeScript directly.

### Option 2: Build and install locally

```bash
cd cli
npm install
npm run build
npm link
```

After `npm link`, the `bonsai` command is available globally:

```bash
bonsai projects list --base-url http://localhost:3000
```

### Option 3: Run via npx (no install)

```bash
npx tsx ./cli/src/index.ts <resource> <action> [options]
```

Run from the Bonsai monorepo root. Works without any local `node_modules` in `cli/` since npx resolves `tsx` on demand.

### Option 4: Publish to npm (future)

The package is structured for npm publishing with `bin/bonsai` as the entry point. After `npm publish`:

```bash
npm install -g bonsai-cli
bonsai projects list --base-url http://localhost:3000
```

## Quick Start

### 1. Authenticate

```bash
npx tsx src/index.ts auth login -u <user-id> -p <password> --base-url http://localhost:3000
```

Tokens are saved to `~/.bonsairc` and reused automatically.

### 2. List your projects

```bash
npx tsx src/index.ts projects list --base-url http://localhost:3000
```

### 3. Create an agent

```bash
npx tsx src/index.ts agents create \
  --project <project-id> \
  --base-url http://localhost:3000 \
  --data '{"name":"My Agent","prompt":"You are helpful.","ttsSettings":{"provider":"openai"}}'
```

## Usage

```
npx tsx src/index.ts <resource> <action> [options]
```

### Resources

Every resource exposes `list`, `get`, `create`, `update`, and `delete` actions (where applicable). Resources are either **global** or **project-scoped**.

**Global resources** (no `--project` needed):
`operators`, `profile`, `setup`, `projects`, `audit_logs`, `providers`, `provider_catalog`, `provider_catalog_asr`, `provider_catalog_tts`, `provider_catalog_llm`, `provider_catalog_storage`, `provider_catalog_moderation`, `channel_catalog`, `environments`, `issues`, `migration`, `migration_export`, `projects_import`, `secrets`, `conversations_trigger`, `webrtc_offer`, `twilio_voice_call`, `twilio_messaging_send`, `whatsapp_send`, `telegram_deploy_webhook`, `email_smtp_imap_send`, `email_smtp_imap_oauth2`, `benchmarks_*`, `scenario_runs_scheduler`

**Project resources** (require `--project <id>`):
`agents`, `classifiers`, `context_transformers`, `conversations`, `knowledge_categories`, `knowledge_items`, `guardrails`, `stages`, `tools`, `users`, `api_keys`, `testers`, `scenarios`, `scenario_runs`, `scenario_conversations`, `global_actions`, `sample_copies`, `copy_decorators`, `quick_prompts`, `deferred_processing`, `analytics_*`, `providers_used`

### Common Options

| Option | Description |
|---|---|
| `--base-url <url>` | API base URL (overrides config) |
| `--project <id>` | Project ID (required for project-scoped resources) |
| `--token <string>` | Auth token (overrides config) |
| `--data <json>` | Request body as JSON string, or `"-"` to read from stdin |
| `--data-file <path>` | Request body from a JSON file |
| `--version <n>` | Entity version for optimistic locking (shorthand for update/delete) |
| `--json` | Emit structured JSON envelope output |
| `-v, --verbose` | Print method, status, and duration to stderr |
| `-q, --quiet` | Suppress non-essential output |
| `--paginate` | Fetch all pages automatically |
| `--timeout <ms>` | Request timeout in milliseconds (default: 30000) |
| `--json-schema` | Output the JSON schema for an operation |

### Query Parameters

Standard query params are available as flags: `--offset`, `--limit`, `--search` (textSearch), `--order` (orderBy), `--filter` (filters).

## Authentication

Tokens are stored in `~/.bonsairc` (JSON format). The CLI supports three auth methods in priority order:

1. `--token` flag on individual commands
2. `BONSAI_API_TOKEN` environment variable
3. Saved token in `~/.bonsairc` (via `auth login`)

```bash
# Login (saves tokens to ~/.bonsairc)
npx tsx src/index.ts auth login -u operator@example.com -p password --base-url http://localhost:3000

# Check auth status
npx tsx src/index.ts auth status --base-url http://localhost:3000

# Logout (clears saved tokens)
npx tsx src/index.ts auth logout

# Skip login entirely with env vars
BONSAI_API_TOKEN=eyJ... BONSAI_API_BASE_URL=http://localhost:3000 npx tsx src/index.ts projects list --json
```

The CLI auto-refreshes expired tokens when a `refreshToken` is present in `~/.bonsairc`.

## Configuration

The CLI reads config from three sources (highest priority first):

1. **Command-line flags** (`--base-url`, `--token`, `--project`)
2. **Environment variables** (`BONSAI_API_BASE_URL`, `BONSAI_API_TOKEN`, `BONSAI_PROJECT_ID`)
3. **Config file** (`~/.bonsairc` or `BONSAI_CONFIG_PATH` env var)

Config file format (`~/.bonsairc`):
```json
{
  "baseUrl": "http://localhost:3000",
  "token": "eyJ...",
  "refreshToken": "eyJ...",
  "project": "proj_abc123",
  "timeout": 30000
}
```

## CRUD Patterns

### List (paginated)

```bash
npx tsx src/index.ts agents list --project <id> --base-url http://localhost:3000
npx tsx src/index.ts agents list --project <id> --offset 0 --limit 20 --search "My Agent"
npx tsx src/index.ts agents list --project <id> --paginate   # fetch all pages
```

### Get by ID

```bash
npx tsx src/index.ts agents get <agent-id> --project <id> --base-url http://localhost:3000
```

### Create

```bash
npx tsx src/index.ts agents create \
  --project <id> \
  --data '{"name":"New Agent","prompt":"Be helpful."}'
```

Pipe JSON from stdin:

```bash
cat agent.json | npx tsx src/index.ts agents create --project <id> --data -
```

Or load from a file:

```bash
npx tsx src/index.ts agents create --project <id> --data-file agent.json
```

### Update (optimistic locking)

```bash
npx tsx src/index.ts agents update <agent-id> \
  --project <id> \
  --data '{"name":"Updated Agent","version":2}'
```

Shorthand with `--version` flag:

```bash
npx tsx src/index.ts agents update <agent-id> \
  --project <id> \
  --data '{"name":"Updated Agent"}' \
  --version 2
```

### Delete

```bash
npx tsx src/index.ts agents delete <agent-id> \
  --project <id> \
  --data '{"version":2}'
```

## JSON Output

Add `--json` to get structured JSON envelope output:

```json
{
  "status": "ok",
  "data": { ... },
  "error": null,
  "meta": { "duration_ms": 42 }
}
```

Errors follow the same envelope:

```json
{
  "status": "error",
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "...",
    "http_status": 400,
    "details": { "fields": [...] }
  },
  "meta": {}
}
```

## Discovery

### List all available resources

```bash
npx tsx src/index.ts resources
npx tsx src/index.ts resources --json
```

### Get help for a specific resource

```bash
npx tsx src/index.ts agents --help
npx tsx src/index.ts agents list --help
```

### Get operation JSON schema

```bash
npx tsx src/index.ts agents list --json-schema
```

## OpenAPI Inspection

The CLI bundles the server's OpenAPI spec for offline inspection:

```bash
# List all API paths
npx tsx src/index.ts openapi paths --methods

# List all schema names
npx tsx src/index.ts openapi schemas

# Show a specific schema
npx tsx src/index.ts openapi schema --name Agent

# Dump the full spec
npx tsx src/index.ts openapi dump --save openapi.json

# Refresh spec from server
npx tsx src/index.ts openapi refresh --base-url http://localhost:3000
```

## Exit Codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Usage error (bad args, invalid JSON, missing params) |
| 2 | Configuration error (missing base URL, project ID) |
| 3 | Authentication error (no token, invalid token) |
| 4 | Resource not found (404) |
| 5 | Validation error (400) |
| 6 | Conflict (409) |
| 7 | Rate limited (429) |
| 8 | Network error |
| 10 | Server error (500, 502) |

