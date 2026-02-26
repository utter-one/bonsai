# Setup

The Setup API provides endpoints for initial system configuration. These endpoints are **public** (no authentication required) and are used to bootstrap the first admin account.

For more information, see the [Installation](../guide/installation) guide.

## Check Setup Status

Check whether the system has been initialized with at least one admin account.

```http
GET /api/setup/status
```

**Response** `200 OK`

```json
{
  "isSetup": false,
  "message": "No admin accounts found. Please create an initial admin account."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `isSetup` | `boolean` | Whether the system has at least one admin account |
| `message` | `string` | Descriptive message about system status |

## Create Initial Admin

Create the first admin account. This endpoint is only available when `isSetup` is `false`.

```http
POST /api/setup/initial-admin
Content-Type: application/json
```

**Request Body**

```json
{
  "id": "admin@example.com",
  "name": "Admin User",
  "password": "securepassword123"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` (min 1) | Yes | Unique identifier (typically an email address) |
| `name` | `string` (min 1) | Yes | Display name for the admin |
| `password` | `string` (min 8) | Yes | Password (minimum 8 characters) |
| `metadata` | `object` | No | Optional key-value metadata |

**Response** `201 Created`

```json
{
  "admin": {
    "id": "admin@example.com",
    "name": "Admin User",
    "roles": ["super_admin"],
    "createdAt": "2025-01-15T10:00:00.000Z"
  },
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "expiresIn": 900
}
```

| Field | Type | Description |
|-------|------|-------------|
| `admin` | `object` | Created admin details |
| `admin.id` | `string` | Admin identifier |
| `admin.name` | `string` | Display name |
| `admin.roles` | `string[]` | Assigned roles (always `["super_admin"]`) |
| `admin.metadata` | `object` | Metadata (if provided) |
| `admin.createdAt` | `string` | ISO 8601 creation timestamp |
| `accessToken` | `string` | JWT access token |
| `refreshToken` | `string` | JWT refresh token |
| `expiresIn` | `integer` | Access token expiry in seconds |

**Error Responses**

| Status | Description |
|--------|-------------|
| `400` | Invalid request body |
| `409` | System already set up |
