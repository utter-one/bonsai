# Authentication

Bonsai Backend uses **JWT-based authentication** for operator access and **API key authentication** for programmatic access.

For more information, see the [Authentication & Permissions](../guide/authentication) guide.

## Login

Authenticate with operator credentials to receive a JWT token pair.

```http
POST /api/auth/login
Content-Type: application/json
```

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` (min 1) | Yes | Operator user ID or email |
| `password` | `string` (min 1) | Yes | Operator user password |

```json
{
  "id": "operator@example.com",
  "password": "your-password"
}
```

**Response** `200 OK`

```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "expiresIn": 64800,
  "operatorId": "operator@example.com",
  "displayName": "Operator User",
  "roles": ["super_admin"]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `accessToken` | `string` | JWT access token (short-lived) |
| `refreshToken` | `string` | JWT refresh token (long-lived) |
| `expiresIn` | `integer` | Access token expiry in seconds |
| `operatorId` | `string` | Operator user ID |
| `displayName` | `string` | Operator display name |
| `roles` | `string[]` | Array of role identifiers |

**Error Responses**

| Status | Description |
|--------|-------------|
| `400` | Invalid request body |
| `401` | Invalid credentials |
| `429` | Too many login attempts — rate limit exceeded |

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
| `429` | Too many requests — rate limit exceeded |

## Rate Limiting

Authentication endpoints are protected by IP-based rate limiting to prevent brute-force attacks.

| Endpoint | Limit | Window |
|----------|-------|--------|
| `POST /api/auth/login` | 10 requests per IP | 15 minutes |
| `POST /api/auth/refresh` | 10 requests per IP | 15 minutes |

When the limit is exceeded, the server responds with `429 Too Many Requests`:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 847
Content-Type: application/json
```

```json
{
  "error": "Too many login attempts, please try again later"
}
```

The `Retry-After` header indicates the number of seconds to wait before retrying.

Limits are configurable via environment variables — see `RATE_LIMIT_AUTH_WINDOW_MS` and `RATE_LIMIT_AUTH_MAX` in the deployment configuration.

## API Keys

API keys are scoped to a project and are used **exclusively for WebSocket real-time conversation authentication**. They are not a substitute for JWT tokens and cannot be used to access the REST API.

See [API Keys](./api-keys) for managing API keys and [WebSocket](./websocket) for how they are used during connection authentication.

## Roles & Permissions

The system uses role-based access control (RBAC). Permissions follow the `entity:action` format (e.g., `project:read`, `stage:write`, `operator:delete`).

### Available Roles

| Role | Description |
|------|-------------|
| `super_admin` | Full system access with all permissions |
| `content_manager` | Manage content entities (agents, stages, knowledge, etc.) |
| `support` | View and assist with user-related issues |
| `developer` | Technical access for development and debugging |
| `viewer` | Read-only access to most entities |

### Role Permissions

#### `super_admin`

Has every permission in the system.

| Entity | Permissions |
|--------|-------------|
| `operator` | `read`, `write`, `delete` |
| `user` | `read`, `write`, `delete` |
| `project` | `read`, `write`, `delete` |
| `agent` | `read`, `write`, `delete` |
| `conversation` | `read`, `write`, `delete` |
| `stage` | `read`, `write`, `delete` |
| `classifier` | `read`, `write`, `delete` |
| `context_transformer` | `read`, `write`, `delete` |
| `tool` | `read`, `write`, `delete` |
| `global_action` | `read`, `write`, `delete` |
| `environment` | `read`, `write`, `delete` |
| `knowledge` | `read`, `write`, `delete` |
| `issue` | `read`, `write`, `delete` |
| `provider` | `read`, `write`, `delete` |
| `api_key` | `read`, `write`, `delete` |
| `migration` | `export`, `import` |
| `system` | `config` |
| `audit` | `read` |

#### `content_manager`

Manages content entities. Has read/write across most entities but cannot delete projects, agents, users, conversations, or stages, and has no operator or system access.

| Entity | Permissions |
|--------|-------------|
| `user` | `read`, `write` |
| `project` | `read`, `write` |
| `agent` | `read`, `write` |
| `conversation` | `read`, `write` |
| `stage` | `read`, `write` |
| `classifier` | `read`, `write` |
| `context_transformer` | `read`, `write` |
| `tool` | `read`, `write` |
| `global_action` | `read`, `write` |
| `knowledge` | `read`, `write` |
| `provider` | `read`, `write` |
| `api_key` | `read`, `write`, `delete` |
| `audit` | `read` |

#### `support`

Limited write access focused on users and issues. Primarily a read role with write on users and issues.

| Entity | Permissions |
|--------|-------------|
| `user` | `read`, `write` |
| `project` | `read` |
| `conversation` | `read` |
| `issue` | `read`, `write` |
| `audit` | `read` |

#### `developer`

Read-only access across all technical entities plus system configuration. No write or delete permissions except `system:config`.

| Entity | Permissions |
|--------|-------------|
| `user` | `read` |
| `project` | `read` |
| `agent` | `read` |
| `conversation` | `read` |
| `stage` | `read` |
| `classifier` | `read` |
| `context_transformer` | `read` |
| `tool` | `read` |
| `global_action` | `read` |
| `knowledge` | `read` |
| `issue` | `read` |
| `provider` | `read` |
| `api_key` | `read` |
| `system` | `config` |
| `audit` | `read` |

#### `viewer`

Strictly read-only access. Same entity coverage as `developer` but without `system:config`.

| Entity | Permissions |
|--------|-------------|
| `user` | `read` |
| `project` | `read` |
| `agent` | `read` |
| `conversation` | `read` |
| `stage` | `read` |
| `classifier` | `read` |
| `context_transformer` | `read` |
| `tool` | `read` |
| `global_action` | `read` |
| `knowledge` | `read` |
| `issue` | `read` |
| `provider` | `read` |
| `api_key` | `read` |
| `audit` | `read` |
