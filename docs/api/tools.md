# Tools

Tools are callable operations that can be invoked during conversations. Each tool has a `type` discriminator that determines its execution mode: `smart_function` (LLM-powered), `webhook` (HTTP call), or `script` (JavaScript).

**Tag:** `Tools` | **Scoped to:** Project

For more information, see the [Tools](../guide/tools), [Scripting](../guide/scripting), and [Prompt Templating](../guide/templating) guides.

## Create Tool

```http
POST /api/projects/:projectId/tools
Content-Type: application/json
```

**Required permission:** `tool:write`

The request body is a discriminated union on the `type` field.

### Smart Function Tool

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"smart_function"` | Yes | Tool type |
| `id` | `string` (min 1) | No | Unique identifier (auto-generated if omitted) |
| `name` | `string` (min 1) | Yes | Display name |
| `description` | `string` | No | Detailed description |
| `prompt` | `string` (min 1) | Yes | Handlebars template for the LLM prompt |
| `llmProviderId` | `string` | No | LLM provider ID (falls back to project default) |
| `llmSettings` | `LlmSettings` | No | LLM provider-specific settings |
| `inputType` | `string` | Yes | Expected input format: `"text"`, `"image"`, or `"multi-modal"` |
| `outputType` | `string` | Yes | Expected output format: `"text"`, `"image"`, or `"multi-modal"` |
| `parameters` | [`ToolParameter[]`](#tool-parameter) | No | Parameters the tool expects |
| `tags` | `string[]` | No | Tags for categorizing and filtering |
| `metadata` | `object` | No | Additional metadata |

### Webhook Tool

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"webhook"` | Yes | Tool type |
| `id` | `string` (min 1) | No | Unique identifier (auto-generated if omitted) |
| `name` | `string` (min 1) | Yes | Display name |
| `description` | `string` | No | Detailed description |
| `url` | `string` (min 1) | Yes | Target URL (Handlebars template) |
| `webhookMethod` | `string` | No | HTTP method: `GET`, `POST`, `PUT`, `PATCH`, `DELETE` (default: `POST`) |
| `webhookHeaders` | `object` | No | Key-value map of HTTP headers (values are Handlebars templates) |
| `webhookBody` | `string` | No | Request body (Handlebars template) |
| `parameters` | [`ToolParameter[]`](#tool-parameter) | No | Parameters the tool expects |
| `tags` | `string[]` | No | Tags for categorizing and filtering |
| `metadata` | `object` | No | Additional metadata |

### Script Tool

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"script"` | Yes | Tool type |
| `id` | `string` (min 1) | No | Unique identifier (auto-generated if omitted) |
| `name` | `string` (min 1) | Yes | Display name |
| `description` | `string` | No | Detailed description |
| `code` | `string` (min 1) | Yes | JavaScript source code to execute |
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

All type-specific create fields are optional in an update. The `type` field itself cannot be changed. `version` is always required for optimistic locking.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` (min 1) | Yes | Current version for optimistic locking |
| `name` | `string` | No | Display name |
| `description` | `string` | No | Description |
| `prompt` | `string` | No | LLM prompt template (smart_function only) |
| `llmProviderId` | `string` | No | LLM provider ID (smart_function only) |
| `llmSettings` | `LlmSettings` | No | LLM settings (smart_function only) |
| `inputType` | `string` | No | Input modality (smart_function only) |
| `outputType` | `string` | No | Output modality (smart_function only) |
| `url` | `string` | No | Target URL template (webhook only) |
| `webhookMethod` | `string` | No | HTTP method (webhook only) |
| `webhookHeaders` | `object` | No | HTTP headers map (webhook only) |
| `webhookBody` | `string` | No | Request body template (webhook only) |
| `code` | `string` | No | JavaScript source code (script only) |
| `parameters` | `ToolParameter[]` | No | Tool parameters |
| `tags` | `string[]` | No | Tags |
| `metadata` | `object` | No | Additional metadata |

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
| `type` | `string` | No | Tool type: `"smart_function"`, `"webhook"`, or `"script"` |
| `prompt` | `string` | Yes | Handlebars prompt template (smart_function only) |
| `llmProviderId` | `string` | Yes | LLM provider ID (smart_function only) |
| `llmSettings` | `LlmSettings` | Yes | LLM settings (smart_function only) |
| `inputType` | `string` | Yes | `"text"`, `"image"`, or `"multi-modal"` (smart_function only) |
| `outputType` | `string` | Yes | `"text"`, `"image"`, or `"multi-modal"` (smart_function only) |
| `url` | `string` | Yes | Target URL template (webhook only) |
| `webhookMethod` | `string` | Yes | HTTP method (webhook only) |
| `webhookHeaders` | `object` | Yes | HTTP headers key-value map (webhook only) |
| `webhookBody` | `string` | Yes | Request body template (webhook only) |
| `code` | `string` | Yes | JavaScript source code (script only) |
| `parameters` | `ToolParameter[]` | No | Tool parameters |
| `tags` | `string[]` | No | Tags |
| `metadata` | `object` | Yes | Additional metadata |
| `version` | `integer` | No | Version number |
| `createdAt` | `string` | No | ISO 8601 creation timestamp |
| `updatedAt` | `string` | No | ISO 8601 last update timestamp |
| `archived` | `boolean` | Yes | Whether this entity belongs to an archived project |

## Tool Parameter

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Parameter name |
| `type` | `string` | Parameter type |
| `description` | `string` | Human-readable description |
| `required` | `boolean` | Whether the parameter is required |
