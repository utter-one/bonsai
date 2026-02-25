# Issues

Track bugs, feature requests, and performance issues related to conversations.

**Tag:** `Issues` | **Scoped to:** Project

## Endpoints

| Method | Path | Summary | Permission |
|--------|------|---------|------------|
| `POST` | `/api/projects/:projectId/issues` | Create issue | `issue:write` |
| `GET` | `/api/projects/:projectId/issues/:id` | Get issue by ID | `issue:read` |
| `GET` | `/api/projects/:projectId/issues` | List issues | `issue:read` |
| `PUT` | `/api/projects/:projectId/issues/:id` | Update issue | `issue:write` |
| `DELETE` | `/api/projects/:projectId/issues/:id` | Delete issue | `issue:delete` |
| `GET` | `/api/projects/:projectId/issues/:id/audit-logs` | Get audit logs | `audit:read` |

::: info
Issues use auto-incrementing integer IDs, not string UUIDs.
:::

## Create Issue

```http
POST /api/projects/:projectId/issues
Content-Type: application/json
```

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `environment` | `string` (min 1) | Yes | Environment where issue occurred |
| `buildVersion` | `string` (min 1) | Yes | Application build version |
| `beat` | `string` | No | Beat/sprint identifier |
| `sessionId` | `string` | No | Related conversation session ID |
| `eventIndex` | `integer` | No | Index of event in session |
| `userId` | `string` | No | User ID who reported the issue |
| `severity` | `string` (min 1) | Yes | `critical`, `high`, `medium`, or `low` |
| `category` | `string` (min 1) | Yes | `bug`, `feature`, or `performance` |
| `bugDescription` | `string` (min 1) | Yes | Detailed bug description |
| `expectedBehaviour` | `string` (min 1) | Yes | Expected behavior description |
| `comments` | `string` | No | Additional comments |
| `status` | `string` (min 1) | Yes | `open`, `in-progress`, `resolved`, or `closed` |

**Response** `201 Created` — [Issue Response](#issue-response)

**Errors:** `400` Invalid body

## Get Issue

```http
GET /api/projects/:projectId/issues/:id
```

**Response** `200 OK` — [Issue Response](#issue-response)

**Errors:** `404` Not found

## List Issues

```http
GET /api/projects/:projectId/issues
```

Supports [pagination & filtering](./pagination).

## Update Issue

```http
PUT /api/projects/:projectId/issues/:id
Content-Type: application/json
```

All create fields are optional (no version-based optimistic locking for issues).

**Response** `200 OK` — [Issue Response](#issue-response)

**Errors:** `400` | `404`

## Delete Issue

```http
DELETE /api/projects/:projectId/issues/:id
```

**Response** `204 No Content`

**Errors:** `404` Not found

---

## Issue Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `integer` | No | Auto-incrementing unique ID |
| `projectId` | `string` | No | Parent project ID |
| `environment` | `string` | No | Environment |
| `buildVersion` | `string` | No | Build version |
| `beat` | `string` | Yes | Beat/sprint identifier |
| `sessionId` | `string` | Yes | Related session ID |
| `eventIndex` | `integer` | Yes | Event index in session |
| `userId` | `string` | Yes | Reporter user ID |
| `severity` | `string` | No | `critical`, `high`, `medium`, or `low` |
| `category` | `string` | No | `bug`, `feature`, or `performance` |
| `bugDescription` | `string` | No | Bug description |
| `expectedBehaviour` | `string` | No | Expected behavior |
| `comments` | `string` | No | Comments |
| `status` | `string` | No | `open`, `in-progress`, `resolved`, or `closed` |
| `createdAt` | `string` | No | ISO 8601 creation timestamp |
| `updatedAt` | `string` | No | ISO 8601 last update timestamp |
