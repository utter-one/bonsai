# Tools

Tools are LLM-powered processing units that can be invoked during conversations. Each tool has a Handlebars prompt template, input/output type definitions, and parameters.

**Tag:** `Tools` | **Scoped to:** Project

## Endpoints

| Method | Path | Summary | Permission |
|--------|------|---------|------------|
| `POST` | `/api/projects/:projectId/tools` | Create tool | `tool:write` |
| `GET` | `/api/projects/:projectId/tools/:id` | Get tool by ID | `tool:read` |
| `GET` | `/api/projects/:projectId/tools` | List tools | `tool:read` |
| `PUT` | `/api/projects/:projectId/tools/:id` | Update tool | `tool:write` |
| `DELETE` | `/api/projects/:projectId/tools/:id` | Delete tool | `tool:delete` |
| `GET` | `/api/projects/:projectId/tools/:id/audit-logs` | Get audit logs | `audit:read` |
| `POST` | `/api/projects/:projectId/tools/:id/clone` | Clone tool | `tool:write` |

## Create Tool

```http
POST /api/projects/:projectId/tools
Content-Type: application/json
```

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
| `metadata` | `object` | No | Additional metadata |

**Response** `201 Created` — [Tool Response](#tool-response)

**Errors:** `400` Invalid body | `409` Already exists

## Get Tool

```http
GET /api/projects/:projectId/tools/:id
```

**Response** `200 OK` — [Tool Response](#tool-response)

## List Tools

```http
GET /api/projects/:projectId/tools
```

Supports [pagination & filtering](./pagination).

## Update Tool

```http
PUT /api/projects/:projectId/tools/:id
Content-Type: application/json
```

All create fields are optional plus `version` (required).

**Response** `200 OK` — [Tool Response](#tool-response)

**Errors:** `400` | `404` | `409`

## Delete Tool

```http
DELETE /api/projects/:projectId/tools/:id
Content-Type: application/json
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` (min 1) | Yes | Current version for optimistic locking |

**Response** `204 No Content`

## Clone Tool

```http
POST /api/projects/:projectId/tools/:id/clone
Content-Type: application/json
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | New ID (auto-generated if omitted) |
| `name` | `string` | No | New name (defaults to "{original name} (Clone)") |

**Response** `201 Created` — [Tool Response](#tool-response)

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
