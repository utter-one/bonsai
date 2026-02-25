# Authentication

Nexus Backend uses **JWT-based authentication** for admin access and **API key authentication** for programmatic access.

## Login

Authenticate with admin credentials to receive a JWT token pair.

```http
POST /api/auth/login
Content-Type: application/json
```

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` (min 1) | Yes | Admin user ID or email |
| `password` | `string` (min 1) | Yes | Admin user password |

```json
{
  "id": "admin@example.com",
  "password": "your-password"
}
```

**Response** `200 OK`

```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "expiresIn": 900,
  "adminId": "admin@example.com",
  "displayName": "Admin User",
  "roles": ["super_admin"]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `accessToken` | `string` | JWT access token (short-lived) |
| `refreshToken` | `string` | JWT refresh token (long-lived) |
| `expiresIn` | `integer` | Access token expiry in seconds |
| `adminId` | `string` | Admin user ID |
| `displayName` | `string` | Admin display name |
| `roles` | `string[]` | Array of role identifiers |

**Error Responses**

| Status | Description |
|--------|-------------|
| `400` | Invalid request body |
| `401` | Invalid credentials |

## Using the Token

Include the access token in the `Authorization` header of subsequent requests:

```http
Authorization: Bearer <accessToken>
```

## Refresh Token

Exchange a refresh token for a new access token.

```http
POST /api/auth/refresh
Content-Type: application/json
```

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `refreshToken` | `string` (min 1) | Yes | Valid refresh token from login |

```json
{
  "refreshToken": "<refreshToken>"
}
```

**Response** `200 OK`

```json
{
  "accessToken": "eyJ...",
  "expiresIn": 900
}
```

| Field | Type | Description |
|-------|------|-------------|
| `accessToken` | `string` | New JWT access token |
| `expiresIn` | `integer` | Access token expiry in seconds |

**Error Responses**

| Status | Description |
|--------|-------------|
| `400` | Invalid request body |
| `401` | Invalid or expired refresh token |

## API Keys

API keys can be created per project and used as an alternative to JWT tokens for programmatic access:

```http
Authorization: Bearer <apiKey>
```

See [API Keys](./api-keys) for managing API keys.

## Roles & Permissions

The system uses role-based access control (RBAC). Available roles:

| Role | Description |
|------|-------------|
| `super_admin` | Full system access with all permissions |
| `content_manager` | Manage content entities (personas, stages, knowledge, etc.) |
| `support` | View and assist with user-related issues |
| `developer` | Technical access for development and debugging |
| `viewer` | Read-only access to most entities |

Permissions follow the `entity:action` format (e.g., `project:read`, `stage:write`, `admin:delete`).
