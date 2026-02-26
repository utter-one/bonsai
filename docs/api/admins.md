# Admins

Manage admin user accounts and the authenticated admin's own profile.

**Tag:** `Admins`, `Profile`

## Create Admin

```http
POST /api/admins
Content-Type: application/json
```

**Required permission:** `admin:write`

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` (min 1) | Yes | Unique identifier for the admin user |
| `name` | `string` (min 1) | Yes | Display name |
| `roles` | `string[]` (min 1) | Yes | Array of role identifiers (at least one required) |
| `password` | `string` (min 1) | Yes | Admin password (will be hashed) |
| `metadata` | `object` | No | Optional key-value metadata |

Available roles: `super_admin`, `content_manager`, `support`, `developer`, `viewer`

**Response** `201 Created` — [Admin Response](#admin-response)

**Errors:** `400` Invalid body | `409` Admin already exists

## Get Admin

```http
GET /api/admins/:id
```

**Required permission:** `admin:read`

**Response** `200 OK` — [Admin Response](#admin-response)

**Errors:** `404` Not found

## List Admins

```http
GET /api/admins
```

**Required permission:** `admin:read`

Supports [pagination & filtering](./pagination).

**Response** `200 OK`

```json
{
  "items": [AdminResponse],
  "total": 10,
  "offset": 0,
  "limit": 20
}
```

## Update Admin

```http
PUT /api/admins/:id
Content-Type: application/json
```

**Required permission:** `admin:write`

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` (positive) | Yes | Current version for optimistic locking |
| `name` | `string` (min 1) | No | Updated display name |
| `roles` | `string[]` (min 1) | No | Updated roles |
| `password` | `string` (min 1) | No | New password |
| `metadata` | `object` | No | Updated metadata |

**Response** `200 OK` — [Admin Response](#admin-response)

**Errors:** `400` Invalid body | `404` Not found | `409` Version conflict

## Delete Admin

```http
DELETE /api/admins/:id
Content-Type: application/json
```

**Required permission:** `admin:delete`

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` (positive) | Yes | Current version for optimistic locking |

**Response** `204 No Content`

**Errors:** `400` Invalid body | `404` Not found | `409` Version conflict

## Get Admin Audit Logs

```http
GET /api/admins/:id/audit-logs
```

**Required permission:** `audit:read`

Returns audit logs for the specified admin. See [Audit Logs](./audit-logs) for response format.

---

## Profile Endpoints

### Get Profile

```http
GET /api/profile
```

**Authentication:** Required (any authenticated admin)

Returns the authenticated admin's own profile.

**Response** `200 OK` — [Admin Response](#admin-response)

### Update Profile

```http
POST /api/profile
Content-Type: application/json
```

**Authentication:** Required (any authenticated admin)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` (min 1) | No | Updated display name |
| `oldPassword` | `string` (min 1) | No | Current password (required when changing password) |
| `newPassword` | `string` (min 1) | No | New password (requires `oldPassword`) |

**Response** `200 OK` — [Admin Response](#admin-response)

**Errors:** `400` Invalid body | `401` Unauthorized

---

## Admin Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique identifier |
| `name` | `string` | No | Display name |
| `roles` | `string[]` | No | Array of role identifiers |
| `metadata` | `object` | Yes | Key-value metadata |
| `version` | `integer` | No | Version number for optimistic locking |
| `createdAt` | `string` | No | ISO 8601 creation timestamp |
| `updatedAt` | `string` | No | ISO 8601 last update timestamp |
