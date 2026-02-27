# Tools

Tools are LLM-powered processing units that can be invoked during conversations. Each tool has a Handlebars prompt template, input/output type definitions, and parameters.

**Tag:** `Tools` | **Scoped to:** Project

For more information, see the [Tools](../guide/tools), [Scripting](../guide/scripting), and [Prompt Templating](../guide/templating) guides.

## Create Tool

```http
POST /api/projects/:projectId/tools
Content-Type: application/json
```

**Required permission:** `tool:write`

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` (min 1) | No | Unique identifier (auto-generated if omitted) |
| `name` | `string` (min 1) | Yes | Display name |
| `description` | `string` | No | Detailed description |
| `prompt` | `string` (min 1) | Yes | Handlebars template for tool invocation |
| `llmProviderId` | `string` | No | LLM provider ID |
| `llmSettings` | `LlmSettings` | Yes | LLM provider-specific settings |
| `inputType` | `string` | Yes | Expected input format: `"text"`, `"image"`, or `"multi-modal"` |
| `outputType` | `string` | Yes | Expected output format: `"text"`, `"image"`, or `"multi-modal"` |
| `parameters` | [`ToolParameter[]`](#tool-parameter) | No | Parameters the tool expects |
| `tags` | `string[]` | No | Tags for categorizing and filtering |
| `metadata` | `object` | No | Additional metadata |

**Response** `201 Created` — [Tool Response](#tool-response)

**Errors:** `400` Invalid body | `409` Already exists

## Get Tool

```http
GET /api/projects/:projectId/tools/:id
```

**Required permission:** `tool:read`

**Response** `200 OK` — [Tool Response](#tool-response)

## List Tools

```http
GET /api/projects/:projectId/tools
```

**Required permission:** `tool:read`

Supports [pagination & filtering](./pagination).

## Update Tool

```http
PUT /api/projects/:projectId/tools/:id
Content-Type: application/json
```

**Required permission:** `tool:write`

All create fields are optional plus `version` (required), **except `llmSettings` which must always be provided**.

**Response** `200 OK` — [Tool Response](#tool-response)

**Errors:** `400` | `404` | `409`

## Delete Tool

```http
DELETE /api/projects/:projectId/tools/:id
Content-Type: application/json
```

**Required permission:** `tool:delete`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` (min 1) | Yes | Current version for optimistic locking |

**Response** `204 No Content`

## Clone Tool

```http
POST /api/projects/:projectId/tools/:id/clone
Content-Type: application/json
```

**Required permission:** `tool:write`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | New ID (auto-generated if omitted) |
| `name` | `string` | No | New name (defaults to "{original name} (Clone)") |

**Response** `201 Created` — [Tool Response](#tool-response)

## Get Audit Logs

```http
GET /api/projects/:projectId/tools/:id/audit-logs
```

**Required permission:** `audit:read`

Returns audit log entries for the specified tool. See [Audit Logs](./audit-logs) for response format.

---

## Tool Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique identifier |
| `projectId` | `string` | No | Parent project ID |
| `name` | `string` | No | Display name |
| `description` | `string` | Yes | Description |
| `prompt` | `string` | No | Handlebars prompt template |
| `llmProviderId` | `string` | Yes | LLM provider ID |
| `llmSettings` | `LlmSettings` | No | LLM settings |
| `inputType` | `string` | No | `"text"`, `"image"`, or `"multi-modal"` |
| `outputType` | `string` | No | `"text"`, `"image"`, or `"multi-modal"` |
| `parameters` | `ToolParameter[]` | No | Tool parameters |
| `tags` | `string[]` | No | Tags |
| `metadata` | `object` | Yes | Additional metadata |
| `version` | `integer` | No | Version number |
| `createdAt` | `string` | No | ISO 8601 creation timestamp |
| `updatedAt` | `string` | No | ISO 8601 last update timestamp |

## Tool Parameter

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Parameter name |
| `type` | `string` | Parameter type |
| `description` | `string` | Human-readable description |
| `required` | `boolean` | Whether the parameter is required |
