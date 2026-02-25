# Environments

Environments represent remote Nexus Backend instances that can be used as sources for configuration migration. You can connect to another instance, preview its data, and pull configurations.

**Tag:** `Environments`

## Endpoints

| Method | Path | Summary | Permission |
|--------|------|---------|------------|
| `POST` | `/api/environments` | Create environment | `environment:write` |
| `GET` | `/api/environments/:id` | Get by ID | `environment:read` |
| `GET` | `/api/environments` | List environments | `environment:read` |
| `PUT` | `/api/environments/:id` | Update environment | `environment:write` |
| `DELETE` | `/api/environments/:id` | Delete environment | `environment:delete` |
| `GET` | `/api/environments/:id/audit-logs` | Get audit logs | `audit:read` |
| `GET` | `/api/environments/:id/migration/scope` | Preview remote migration scope | `migration:import` |
| `POST` | `/api/environments/:id/migration/pull` | Pull data from environment | `migration:import` |
| `GET` | `/api/environments/:id/migration/jobs/:jobId` | Get migration job status | `migration:import` |

## Create Environment

```http
POST /api/environments
Content-Type: application/json
```

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` (min 1) | No | Unique identifier (auto-generated if omitted) |
| `description` | `string` (min 1) | Yes | Human-readable description |
| `url` | `string` (URL) | Yes | Base URL of the remote instance |
| `login` | `string` (min 1) | Yes | Authentication login for the remote instance |
| `password` | `string` (min 1) | Yes | Authentication password |

**Response** `201 Created` — [Environment Response](#environment-response)

**Errors:** `400` Invalid body | `409` Already exists

## Get Environment

```http
GET /api/environments/:id
```

**Response** `200 OK` — [Environment Response](#environment-response)

::: info
The password is excluded from response for security.
:::

## List Environments

```http
GET /api/environments
```

Supports [pagination & filtering](./pagination).

## Update Environment

```http
PUT /api/environments/:id
Content-Type: application/json
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` (min 1) | Yes | Current version for optimistic locking |
| `description` | `string` (min 1) | No | Updated description |
| `url` | `string` (URL) | No | Updated base URL |
| `login` | `string` (min 1) | No | Updated login |
| `password` | `string` (min 1) | No | Updated password |

**Response** `200 OK` — [Environment Response](#environment-response)

## Delete Environment

```http
DELETE /api/environments/:id
Content-Type: application/json
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` (min 1) | Yes | Current version for optimistic locking |

**Response** `204 No Content`

---

## Migration Operations

### Preview Migration Scope

Preview what data is available to pull from a remote environment.

```http
GET /api/environments/:id/migration/scope
```

**Response** `200 OK`

```json
{
  "totalCount": 42,
  "providers": [{ "id": "...", "name": "..." }],
  "projects": [{ "id": "...", "name": "..." }],
  "personas": [{ "id": "...", "name": "...", "projectId": "..." }],
  "classifiers": [...],
  "contextTransformers": [...],
  "tools": [...],
  "globalActions": [...],
  "knowledgeCategories": [...],
  "knowledgeItems": [...],
  "stages": [...],
  "apiKeys": [...]
}
```

### Pull Data

Start a migration job to pull configuration from a remote environment.

```http
POST /api/environments/:id/migration/pull
Content-Type: application/json
```

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `selection` | [`MigrationSelection`](#migration-selection) | No (default: `{}`) | Entity selection. Omit or `{}` to pull everything |
| `force` | `boolean` | No (default: `false`) | Bypass schema hash mismatch check |
| `dryRun` | `boolean` | No (default: `false`) | Simulate without writing data |

**Response** `202 Accepted` — [Migration Job Response](#migration-job-response)

### Get Migration Job Status

```http
GET /api/environments/:id/migration/jobs/:jobId
```

**Response** `200 OK` — [Migration Job Response](#migration-job-response)

---

## Environment Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique identifier |
| `description` | `string` | No | Description |
| `url` | `string` | No | Remote instance URL |
| `login` | `string` | No | Authentication login |
| `version` | `integer` | No | Version number |
| `createdAt` | `string` | No | ISO 8601 creation timestamp |
| `updatedAt` | `string` | No | ISO 8601 last update timestamp |

## Migration Selection

| Field | Type | Description |
|-------|------|-------------|
| `projectIds` | `string[]` | Project IDs (pulls all children) |
| `stageIds` | `string[]` | Stage IDs (pulls persona, classifiers, transformers, actions, providers) |
| `personaIds` | `string[]` | Persona IDs (pulls TTS provider) |
| `classifierIds` | `string[]` | Classifier IDs (pulls LLM provider) |
| `contextTransformerIds` | `string[]` | Context transformer IDs (pulls LLM provider) |
| `toolIds` | `string[]` | Tool IDs (pulls LLM provider) |
| `globalActionIds` | `string[]` | Global action IDs |
| `knowledgeCategoryIds` | `string[]` | Knowledge category IDs (all child items included) |
| `providerIds` | `string[]` | Explicit provider IDs |
| `apiKeyIds` | `string[]` | API key IDs |

All fields are optional. Omit the selection or pass `{}` to pull everything from the remote.

## Migration Job Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique job identifier |
| `status` | `string` | No | `pending`, `running`, `completed`, or `failed` |
| `environmentId` | `string` | No | Source environment ID |
| `selection` | `MigrationSelection` | No | Entity selection used |
| `dryRun` | `boolean` | No | Whether this is a dry run |
| `startedAt` | `string` | No | ISO 8601 job start timestamp |
| `completedAt` | `string` | Yes | ISO 8601 completion timestamp |
| `result` | `object` | Yes | Available when status is `completed` |
| `error` | `string` | Yes | Available when status is `failed` |
