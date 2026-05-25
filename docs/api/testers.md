# Testers

Testers are LLM-powered personas that simulate the user side of a conversation during automated scenario testing. Each tester has a prompt that defines its personality and behaviour, optional user profile variables, and LLM configuration.

**Tag:** `Testers` | **Scoped to:** Project

## Create Tester

```http
POST /api/projects/:projectId/testers
Content-Type: application/json
```

**Required permission:** `tester:write`

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique identifier (auto-generated if omitted) |
| `name` | `string` (min 1) | Yes | Display name |
| `description` | `string` | No | Detailed description |
| `prompt` | `string` (min 1) | Yes | Prompt that drives the tester's conversational behaviour |
| `hangUpPrompt` | `string` | No | Mini-prompt evaluated each turn to decide whether the tester should hang up (used when `personaCanHangUp` is enabled on the scenario); must return `true` to continue or `false` to hang up |
| `llmProviderId` | `string` | No | LLM provider ID |
| `llmSettings` | `LlmSettings` | No | LLM provider-specific settings |
| `userProfile` | `object` | No | Key-value profile variables injected as context (same format as conversation user profile) |
| `tags` | `string[]` | No | Tags for categorizing and filtering |
| `metadata` | `object` | No | Additional metadata |

**Response** `201 Created` — [Tester Response](#tester-response)

**Errors:** `400` Invalid body | `409` Already exists

## Get Tester

```http
GET /api/projects/:projectId/testers/:id
```

**Required permission:** `tester:read`

**Response** `200 OK` — [Tester Response](#tester-response)

**Errors:** `404` Not found

## List Testers

```http
GET /api/projects/:projectId/testers
```

**Required permission:** `tester:read`

Supports [pagination & filtering](./pagination).

**Response** `200 OK` — [Tester List Response](#tester-list-response)

## Update Tester

```http
PUT /api/projects/:projectId/testers/:id
Content-Type: application/json
```

**Required permission:** `tester:write`

All create fields are optional plus `version` (required for optimistic locking).

**Response** `200 OK` — [Tester Response](#tester-response)

**Errors:** `400` | `404` | `409`

## Delete Tester

```http
DELETE /api/projects/:projectId/testers/:id
Content-Type: application/json
```

**Required permission:** `tester:delete`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` (min 1) | Yes | Current version for optimistic locking |

**Response** `204 No Content`

**Errors:** `404` | `409`

## Get Tester Audit Logs

```http
GET /api/projects/:projectId/testers/:id/audit-logs
```

**Required permission:** `audit:read`

**Response** `200 OK` — Array of [Audit Log](./audit-logs) entries for this tester

**Errors:** `404` Not found

---

## Tester Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique identifier |
| `projectId` | `string` | No | Parent project ID |
| `name` | `string` | No | Display name |
| `description` | `string` | Yes | Description |
| `prompt` | `string` | No | Persona prompt |
| `hangUpPrompt` | `string` | Yes | Hang-up decision mini-prompt |
| `llmProviderId` | `string` | Yes | LLM provider ID |
| `llmSettings` | `object` | Yes | LLM settings |
| `userProfile` | `object` | Yes | User profile key-value pairs |
| `tags` | `string[]` | No | Tags |
| `metadata` | `object` | Yes | Additional metadata |
| `version` | `integer` | No | Optimistic locking version |
| `createdAt` | `string` (ISO 8601) | No | Creation timestamp |
| `updatedAt` | `string` (ISO 8601) | No | Last update timestamp |

## Tester List Response

| Field | Type | Description |
|-------|------|-------------|
| `items` | `Tester[]` | Page of tester records |
| `total` | `integer` | Total matching record count |
| `limit` | `integer` | Page size |
| `offset` | `integer` | Page offset |
