# Migration

The Migration API provides endpoints for exporting configuration bundles from the current instance. These bundles can be imported into other instances via [Environments](./environments).

**Tag:** `Migration`

## Preview Migration Scope

Preview the entities that would be included in an export.

```http
GET /api/migration/preview
```

**Required permission:** `migration:export`

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

**Response** `200 OK`

```json
{
  "totalCount": 42,
  "providers": [{ "id": "provider-1", "name": "OpenAI Main" }],
  "projects": [{ "id": "project-1", "name": "My Project" }],
  "agents": [{ "id": "agent-1", "name": "Assistant", "projectId": "project-1" }],
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

Each entity stub contains:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Entity identifier |
| `name` | `string` | Entity name (or question for knowledge items) |
| `projectId` | `string` | Parent project ID (for project-scoped entities) |

## Export Configuration Bundle

Export a full configuration bundle as JSON.

```http
GET /api/migration/export
```

**Required permission:** `migration:export`

Accepts the same query parameters as the preview endpoint.

**Response** `200 OK`

```json
{
  "exportedAt": "2025-01-15T10:00:00.000Z",
  "restSchemaHash": "a1b2c3d4e5f6",
  "selection": {},
  "providers": [...],
  "projects": [...],
  "agents": [...],
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

| Field | Type | Description |
|-------|------|-------------|
| `exportedAt` | `string` | ISO 8601 timestamp of export |
| `restSchemaHash` | `string` | REST schema hash for compatibility checking |
| `sourceUrl` | `string` | Source instance URL (optional) |
| `selection` | `object` | Selection criteria used |
| `providers` | `array` | Provider records (config/credentials stripped) |
| `projects` | `array` | Full project records |
| `agents` | `array` | Full agent records |
| `classifiers` | `array` | Full classifier records |
| `contextTransformers` | `array` | Full context transformer records |
| `tools` | `array` | Full tool records |
| `globalActions` | `array` | Full global action records |
| `knowledgeCategories` | `array` | Full knowledge category records |
| `knowledgeItems` | `array` | Full knowledge item records |
| `stages` | `array` | Full stage records |
| `apiKeys` | `array` | Full API key records |

::: warning
Provider configurations and credentials are stripped from the export bundle for security. You'll need to reconfigure provider credentials after import.
:::
