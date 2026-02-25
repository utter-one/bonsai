# Classifiers

Classifiers use LLMs to categorize user input into actions. They are used by stages and global actions to determine intent.

**Tag:** `Classifiers` | **Scoped to:** Project

## Endpoints

| Method | Path | Summary | Permission |
|--------|------|---------|------------|
| `POST` | `/api/projects/:projectId/classifiers` | Create classifier | `classifier:write` |
| `GET` | `/api/projects/:projectId/classifiers/:id` | Get by ID | `classifier:read` |
| `GET` | `/api/projects/:projectId/classifiers` | List classifiers | `classifier:read` |
| `PUT` | `/api/projects/:projectId/classifiers/:id` | Update classifier | `classifier:write` |
| `DELETE` | `/api/projects/:projectId/classifiers/:id` | Delete classifier | `classifier:delete` |
| `GET` | `/api/projects/:projectId/classifiers/:id/audit-logs` | Get audit logs | `audit:read` |
| `POST` | `/api/projects/:projectId/classifiers/:id/clone` | Clone classifier | `classifier:write` |

## Create Classifier

```http
POST /api/projects/:projectId/classifiers
Content-Type: application/json
```

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` (min 1) | No | Unique identifier (auto-generated if omitted) |
| `name` | `string` (min 1) | Yes | Display name |
| `description` | `string` | No | Detailed description |
| `prompt` | `string` (min 1) | Yes | Prompt defining classification logic |
| `llmProviderId` | `string` | No | LLM provider ID |
| `llmSettings` | `LlmSettings` | Yes | LLM provider-specific settings |
| `metadata` | `object` | No | Additional metadata |

**Response** `201 Created` — [Classifier Response](#classifier-response)

**Errors:** `400` Invalid body | `409` Already exists

## Get Classifier

```http
GET /api/projects/:projectId/classifiers/:id
```

**Response** `200 OK` — [Classifier Response](#classifier-response)

## List Classifiers

```http
GET /api/projects/:projectId/classifiers
```

Supports [pagination & filtering](./pagination).

## Update Classifier

```http
PUT /api/projects/:projectId/classifiers/:id
Content-Type: application/json
```

All create fields are optional plus `version` (required).

**Response** `200 OK` — [Classifier Response](#classifier-response)

**Errors:** `400` | `404` | `409`

## Delete Classifier

```http
DELETE /api/projects/:projectId/classifiers/:id
Content-Type: application/json
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` (min 1) | Yes | Current version for optimistic locking |

**Response** `204 No Content`

## Clone Classifier

```http
POST /api/projects/:projectId/classifiers/:id/clone
Content-Type: application/json
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | New ID (auto-generated if omitted) |
| `name` | `string` | No | New name (defaults to "{original name} (Clone)") |

**Response** `201 Created` — [Classifier Response](#classifier-response)

---

## Classifier Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique identifier |
| `projectId` | `string` | No | Parent project ID |
| `name` | `string` | No | Display name |
| `description` | `string` | Yes | Description |
| `prompt` | `string` | No | Classification prompt |
| `llmProviderId` | `string` | Yes | LLM provider ID |
| `llmSettings` | `LlmSettings` | No | LLM settings |
| `metadata` | `object` | Yes | Additional metadata |
| `version` | `integer` | No | Version number |
| `createdAt` | `string` | No | ISO 8601 creation timestamp |
| `updatedAt` | `string` | No | ISO 8601 last update timestamp |
