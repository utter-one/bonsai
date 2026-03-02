# Operators

Manage operator user accounts and the authenticated operator's own profile.

**Tag:** `Operators`, `Profile`

For more information, see the [Authentication & Permissions](../guide/authentication) guide.

## Create Operator

```http
POST /api/operators
Content-Type: application/json
```

**Required permission:** `operator:write`

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` (min 1) | Yes | Unique identifier for the operator user |
| `name` | `string` (min 1) | Yes | Display name |
| `roles` | `string[]` (min 1) | Yes | Array of role identifiers (at least one required) |
| `password` | `string` (min 1) | Yes | Operator password (will be hashed) |
| `metadata` | `object` | No | Optional key-value metadata |

Available roles: `super_admin`, `content_manager`, `support`, `developer`, `viewer`

**Response** `201 Created` — [Operator Response](#operator-response)

**Errors:** `400` Invalid body | `409` Operator already exists

## Get Operator

```http
GET /api/operators/:id
```

**Required permission:** `operator:read`

**Response** `200 OK` — [Operator Response](#operator-response)

**Errors:** `404` Not found

## List Operators

```http
GET /api/operators
```

**Required permission:** `operator:read`

Supports [pagination & filtering](./pagination).

**Response** `200 OK`

```json
{
  "items": [OperatorResponse],
  "total": 10,
  "offset": 0,
  "limit": 20
}
```

## Update Operator

```http
PUT /api/operators/:id
Content-Type: application/json
```

**Required permission:** `operator:write`

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` (positive) | Yes | Current version for optimistic locking |
| `name` | `string` (min 1) | No | Updated display name |
| `roles` | `string[]` (min 1) | No | Updated roles |
| `password` | `string` (min 1) | No | New password |
| `metadata` | `object` | No | Updated metadata |

**Response** `200 OK` — [Operator Response](#operator-response)

**Errors:** `400` Invalid body | `404` Not found | `409` Version conflict

## Delete Operator

```http
DELETE /api/operators/:id
Content-Type: application/json
```

**Required permission:** `operator:delete`

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` (positive) | Yes | Current version for optimistic locking |

**Response** `204 No Content`

**Errors:** `400` Invalid body | `404` Not found | `409` Version conflict

## Get Operator Audit Logs

```http
GET /api/operators/:id/audit-logs
```

**Required permission:** `audit:read`

Returns audit logs for the specified operator. See [Audit Logs](./audit-logs) for response format.

---

## Profile Endpoints

### Get Profile

```http
GET /api/profile
```

**Authentication:** Required (any authenticated operator)

Returns the authenticated operator's own profile.

**Response** `200 OK` — [Operator Response](#operator-response)

### Update Profile

```http
POST /api/profile
Content-Type: application/json
```

**Authentication:** Required (any authenticated operator)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` (min 1) | No | Updated display name |
| `oldPassword` | `string` (min 1) | No | Current password (required when changing password) |
| `newPassword` | `string` (min 1) | No | New password (requires `oldPassword`) |

**Response** `200 OK` — [Operator Response](#operator-response)

**Errors:** `400` Invalid body | `401` Unauthorized

---

## Operator Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique identifier |
| `name` | `string` | No | Display name |
| `roles` | `string[]` | No | Array of role identifiers |
| `metadata` | `object` | Yes | Key-value metadata |
| `version` | `integer` | No | Version number for optimistic locking |
| `createdAt` | `string` | No | ISO 8601 creation timestamp |
| `updatedAt` | `string` | No | ISO 8601 last update timestamp |
