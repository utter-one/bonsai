# Users

Users represent end-users who participate in conversations. Users have flexible profile data stored as key-value pairs.

**Tag:** `Users`

## Endpoints

| Method | Path | Summary | Permission |
|--------|------|---------|------------|
| `POST` | `/api/users` | Create user | `user:write` |
| `GET` | `/api/users/:id` | Get user by ID | `user:read` |
| `GET` | `/api/users` | List users | `user:read` |
| `PUT` | `/api/users/:id` | Update user | `user:write` |
| `DELETE` | `/api/users/:id` | Delete user | `user:delete` |
| `GET` | `/api/users/:id/audit-logs` | Get audit logs | `audit:read` |

## Create User

```http
POST /api/users
Content-Type: application/json
```

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` (min 1) | No | Unique identifier (auto-generated if omitted) |
| `profile` | `object` | Yes | User profile data as flexible key-value pairs |

```json
{
  "id": "user-123",
  "profile": {
    "name": "John Doe",
    "email": "john@example.com",
    "language": "en"
  }
}
```

**Response** `201 Created` — [User Response](#user-response)

**Errors:** `400` Invalid body | `409` User already exists

## Get User

```http
GET /api/users/:id
```

**Response** `200 OK` — [User Response](#user-response)

**Errors:** `404` Not found

## List Users

```http
GET /api/users
```

Supports [pagination & filtering](./pagination).

**Response** `200 OK` — Paginated list of [User Response](#user-response)

## Update User

```http
PUT /api/users/:id
Content-Type: application/json
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `profile` | `object` | No | Updated profile data (merges with existing) |

**Response** `200 OK` — [User Response](#user-response)

**Errors:** `400` Invalid body | `404` Not found

## Delete User

```http
DELETE /api/users/:id
```

**Response** `204 No Content`

**Errors:** `404` Not found

---

## User Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique identifier |
| `profile` | `object` | No | User profile data |
| `createdAt` | `string` | No | ISO 8601 creation timestamp |
| `updatedAt` | `string` | No | ISO 8601 last update timestamp |
