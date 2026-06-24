# Environments

Environments represent remote Bonsai Backend instances that can be used as sources for configuration migration. You can connect to another instance, preview its data, and pull configurations.

**Tag:** `Environments`

## Create Environment

```http
POST /api/environments
Content-Type: application/json
```

**Required permission:** `environment:write`

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

**Required permission:** `environment:read`

**Response** `200 OK` — [Environment Response](#environment-response)

::: info
The password is excluded from response for security.
:::

## List Environments

```http
GET /api/environments
```

**Required permission:** `environment:read`

Supports [pagination & filtering](./pagination).

## Update Environment

```http
PUT /api/environments/:id
Content-Type: application/json
```

**Required permission:** `environment:write`

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

**Required permission:** `environment:delete`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` (min 1) | Yes | Current version for optimistic locking |

**Response** `204 No Content`

## Get Audit Logs

```http
GET /api/environments/:id/audit-logs
```

**Required permission:** `audit:read`

Returns audit log entries for the specified environment. See [Audit Logs](./audit-logs) for response format.

---

## Migration Operations

### Preview Migration Scope

Preview what data is available to pull from a remote environment.

```http
GET /api/environments/:id/migration/scope
```

**Required permission:** `migration:import`

**Query Parameters** (all optional)

| Parameter | Type | Description |
|-----------|------|-------------|
| `projectIds` | `string \| string[]` | Specific project IDs |
| `stageIds` | `string \| string[]` | Specific stage IDs |
| `agentIds` | `string \| string[]` | Specific agent IDs |
| `classifierIds` | `string \| string[]` | Specific classifier IDs |
| `contextTransformerIds` | `string \| string[]` | Specific context transformer IDs |
| `toolIds` | `string \| string[]` | Specific tool IDs |
| `globalActionIds` | `string \| string[]` | Specific global action IDs |
| `knowledgeCategoryIds` | `string \| string[]` | Specific knowledge category IDs |
| `providerIds` | `string \| string[]` | Specific provider IDs |
| `apiKeyIds` | `string \| string[]` | Specific API key IDs |
| `testerIds` | `string \| string[]` | Specific tester IDs |
| `scenarioIds` | `string \| string[]` | Specific scenario IDs |
| `guardrailIds` | `string \| string[]` | Specific guardrail IDs |
| `copyDecoratorIds` | `string \| string[]` | Specific copy decorator IDs |
| `sampleCopyIds` | `string \| string[]` | Specific sample copy IDs |
| `savedSliceQueryIds` | `string \| string[]` | Specific saved slice query IDs |
| `savedFunnelQueryIds` | `string \| string[]` | Specific saved funnel query IDs |
| `bundlePassword` | `string` | Password for encrypting the migration bundle |

**Response** `200 OK`

```json
{
  "totalCount": 42,
  "providers": [{ "id": "...", "name": "..." }],
  "projects": [{ "id": "...", "name": "..." }],
  "agents": [{ "id": "...", "name": "...", "projectId": "..." }],
  "classifiers": [...],
  "contextTransformers": [...],
  "tools": [...],
  "globalActions": [...],
  "knowledgeCategories": [...],
  "knowledgeItems": [...],
  "stages": [...],
  "apiKeys": [...],
  "guardrails": [...],
  "copyDecorators": [...],
  "sampleCopies": [...],
  "testers": [...],
  "scenarios": [...],
  "savedSliceQueries": [...],
  "savedFunnelQueries": [...]
}
```

### Pull Data

Start a migration job to pull configuration from a remote environment.

```http
POST /api/environments/:id/migration/pull
Content-Type: application/json
```

**Required permission:** `migration:import`

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

**Required permission:** `migration:import`

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
| `stageIds` | `string[]` | Stage IDs (pulls agent, classifiers, transformers, actions, providers) |
| `agentIds` | `string[]` | Agent IDs (pulls TTS provider) |
| `classifierIds` | `string[]` | Classifier IDs (pulls LLM provider) |
| `contextTransformerIds` | `string[]` | Context transformer IDs (pulls LLM provider) |
| `toolIds` | `string[]` | Tool IDs (pulls LLM provider) |
| `globalActionIds` | `string[]` | Global action IDs |
| `knowledgeCategoryIds` | `string[]` | Knowledge category IDs (all child items included) |
| `providerIds` | `string[]` | Explicit provider IDs |
| `apiKeyIds` | `string[]` | API key IDs |
| `testerIds` | `string[]` | Tester IDs |
| `scenarioIds` | `string[]` | Scenario IDs |
| `guardrailIds` | `string[]` | Guardrail IDs |
| `copyDecoratorIds` | `string[]` | Copy decorator IDs |
| `sampleCopyIds` | `string[]` | Sample copy IDs |
| `savedSliceQueryIds` | `string[]` | Saved slice query IDs |
| `savedFunnelQueryIds` | `string[]` | Saved funnel query IDs |

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
