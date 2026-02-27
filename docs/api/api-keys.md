# API Keys

API keys provide authentication for WebSocket real-time conversations. Each key is scoped to a project and is used exclusively by client applications (web apps, mobile apps, kiosks) to authenticate WebSocket sessions — they are not a substitute for JWT-based admin authentication.

**Tag:** `API Keys` | **Scoped to:** Project

For more information, see the [Authentication & Permissions](../guide/authentication) and [WebSocket Protocol](../guide/websocket) guides.

## Create API Key

```http
POST /api/projects/:projectId/api-keys
Content-Type: application/json
```

**Required permission:** `api_key:write`

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` (min 1, max 255) | Yes | Descriptive name for the API key |
| `metadata` | `object` | No | Additional metadata |

**Response** `201 Created` — [API Key Response](#api-key-response)

::: warning
The full `key` value is **only returned once** at creation time. Store it securely.
:::

**Errors:** `400` Invalid body

## Get API Key

```http
GET /api/projects/:projectId/api-keys/:id
```

**Required permission:** `api_key:read`

**Response** `200 OK` — [API Key Response](#api-key-response) (without `key`, only `keyPreview`)

## List API Keys

```http
GET /api/projects/:projectId/api-keys
```

**Required permission:** `api_key:read`

Supports [pagination & filtering](./pagination).

## Update API Key

```http
PUT /api/projects/:projectId/api-keys/:id
Content-Type: application/json
```

**Required permission:** `api_key:write`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` | Yes | Current version for optimistic locking |
| `name` | `string` (min 1, max 255) | No | Updated name |
| `isActive` | `boolean` | No | Enable or disable the key |
| `metadata` | `object` | No | Updated metadata |

**Response** `200 OK` — [API Key Response](#api-key-response)

**Errors:** `400` | `404` | `409`

## Delete API Key

```http
DELETE /api/projects/:projectId/api-keys/:id
Content-Type: application/json
```

**Required permission:** `api_key:delete`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` | Yes | Current version for optimistic locking |

**Response** `204 No Content`

---

## API Key Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique identifier |
| `projectId` | `string` | No | Parent project ID |
| `name` | `string` | No | Descriptive name |
| `key` | `string` | Yes | Full API key (only on creation) |
| `keyPreview` | `string` | Yes | First characters of the key |
| `lastUsedAt` | `string` | Yes | ISO 8601 timestamp of last use |
| `isActive` | `boolean` | No | Whether the key is active |
| `metadata` | `object` | Yes | Additional metadata |
| `version` | `integer` | No | Version number |
| `createdAt` | `string` | No | ISO 8601 creation timestamp |
| `updatedAt` | `string` | No | ISO 8601 last update timestamp |
