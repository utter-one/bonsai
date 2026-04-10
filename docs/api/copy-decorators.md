# Copy Decorators

Copy decorators are simple templates that wrap selected sample copy content before it is injected into the conversation context or returned as a forced response. They allow you to add surrounding text, formatting, or instructions around the raw copy content without modifying each sample copy individually.

**Tag:** `Copy Decorators` | **Scoped to:** Project

For more information, see the [Sample Copies](../guide/sample-copies) guide.

## Create Copy Decorator

```http
POST /api/projects/:projectId/copy-decorators
Content-Type: application/json
```

**Required permission:** `copy_decorator:write`

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` (min 1) | No | Unique identifier (auto-generated if omitted) |
| `name` | `string` (min 1) | Yes | Human-readable display name |
| `template` | `string` (min 1) | Yes | Template string used to decorate selected sample copy content |

**Response** `201 Created` — [Copy Decorator Response](#copy-decorator-response)

**Errors:** `400` Invalid body | `409` Already exists

## Get Copy Decorator

```http
GET /api/projects/:projectId/copy-decorators/:id
```

**Required permission:** `copy_decorator:read`

**Response** `200 OK` — [Copy Decorator Response](#copy-decorator-response)

**Errors:** `404` Not found

## List Copy Decorators

```http
GET /api/projects/:projectId/copy-decorators
```

**Required permission:** `copy_decorator:read`

Supports [pagination & filtering](./pagination).

**Response** `200 OK` — Paginated list of [Copy Decorator Response](#copy-decorator-response)

## Update Copy Decorator

```http
PUT /api/projects/:projectId/copy-decorators/:id
Content-Type: application/json
```

**Required permission:** `copy_decorator:write`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` (min 1) | No | Updated display name |
| `template` | `string` (min 1) | No | Updated template string |
| `version` | `integer` (min 1) | Yes | Current version for optimistic locking |

**Response** `200 OK` — [Copy Decorator Response](#copy-decorator-response)

**Errors:** `400` | `404` | `409` Version conflict

## Delete Copy Decorator

```http
DELETE /api/projects/:projectId/copy-decorators/:id
Content-Type: application/json
```

**Required permission:** `copy_decorator:delete`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` (min 1) | Yes | Current version for optimistic locking |

**Response** `204 No Content`

**Errors:** `400` | `404` | `409` Version conflict

## Get Audit Logs

```http
GET /api/projects/:projectId/copy-decorators/:id/audit-logs
```

**Required permission:** `audit:read`

Returns audit log entries for the specified copy decorator. See [Audit Logs](./audit-logs) for response format.

---

## Copy Decorator Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique identifier |
| `projectId` | `string` | No | Parent project ID |
| `name` | `string` | No | Display name |
| `template` | `string` | No | Template string applied to sample copy content |
| `version` | `integer` | No | Version number for optimistic locking |
| `createdAt` | `string` | No | ISO 8601 creation timestamp |
| `updatedAt` | `string` | No | ISO 8601 last update timestamp |
| `archived` | `boolean` | Yes | Whether this entity belongs to an archived project |
