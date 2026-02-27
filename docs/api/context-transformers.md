# Context Transformers

Context transformers process and transform conversation context before it's sent to the LLM. They can modify, enrich, or filter context fields.

**Tag:** `Context Transformers` | **Scoped to:** Project

For more information, see the [Context Transformers](../guide/context-transformers) guide.

## Create Context Transformer

```http
POST /api/projects/:projectId/context-transformers
Content-Type: application/json
```

**Required permission:** `context_transformer:write`

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` (min 1) | No | Unique identifier (auto-generated if omitted) |
| `name` | `string` (min 1) | Yes | Display name |
| `description` | `string` | No | Detailed description |
| `prompt` | `string` (min 1) | Yes | Prompt defining transformation logic |
| `contextFields` | `string[]` | No | List of context field names to transform |
| `llmProviderId` | `string` | No | LLM provider ID |
| `llmSettings` | `LlmSettings` | Yes | LLM provider-specific settings |
| `metadata` | `object` | No | Additional metadata |

**Response** `201 Created` — [Context Transformer Response](#context-transformer-response)

**Errors:** `400` Invalid body | `409` Already exists

## Get Context Transformer

```http
GET /api/projects/:projectId/context-transformers/:id
```

**Required permission:** `context_transformer:read`

**Response** `200 OK` — [Context Transformer Response](#context-transformer-response)

## List Context Transformers

```http
GET /api/projects/:projectId/context-transformers
```

**Required permission:** `context_transformer:read`

Supports [pagination & filtering](./pagination).

## Update Context Transformer

```http
PUT /api/projects/:projectId/context-transformers/:id
Content-Type: application/json
```

**Required permission:** `context_transformer:write`

All create fields are optional plus `version` (required).

**Response** `200 OK` — [Context Transformer Response](#context-transformer-response)

**Errors:** `400` | `404` | `409`

## Delete Context Transformer

```http
DELETE /api/projects/:projectId/context-transformers/:id
Content-Type: application/json
```

**Required permission:** `context_transformer:delete`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` (min 1) | Yes | Current version for optimistic locking |

**Response** `204 No Content`

## Clone Context Transformer

```http
POST /api/projects/:projectId/context-transformers/:id/clone
Content-Type: application/json
```

**Required permission:** `context_transformer:write`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | New ID (auto-generated if omitted) |
| `name` | `string` | No | New name (defaults to "{original name} (Clone)") |

**Response** `201 Created` — [Context Transformer Response](#context-transformer-response)

## Get Audit Logs

```http
GET /api/projects/:projectId/context-transformers/:id/audit-logs
```

**Required permission:** `audit:read`

Returns audit log entries for the specified context transformer. See [Audit Logs](./audit-logs) for response format.

---

## Context Transformer Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique identifier |
| `projectId` | `string` | No | Parent project ID |
| `name` | `string` | No | Display name |
| `description` | `string` | Yes | Description |
| `prompt` | `string` | No | Transformation prompt |
| `contextFields` | `string[]` | Yes | Context field names to transform |
| `llmProviderId` | `string` | Yes | LLM provider ID |
| `llmSettings` | `LlmSettings` | No | LLM settings |
| `metadata` | `object` | Yes | Additional metadata |
| `version` | `integer` | No | Version number |
| `createdAt` | `string` | No | ISO 8601 creation timestamp |
| `updatedAt` | `string` | No | ISO 8601 last update timestamp |
