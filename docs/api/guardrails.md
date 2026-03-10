# Guardrails

Guardrails are project-level safety and behavioral rules that fire on every stage of a conversation. They are evaluated by a shared project-level classifier (`defaultGuardrailClassifierId`) in parallel with stage classifiers.

**Tag:** `Guardrails` | **Scoped to:** Project

For more information, see the [Guardrails](../guide/guardrails) and [Actions & Effects](../guide/actions-and-effects) guides.

## Create Guardrail

```http
POST /api/projects/:projectId/guardrails
Content-Type: application/json
```

**Required permission:** `guardrail:write`

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` (min 1) | No | Unique identifier (auto-generated if omitted) |
| `name` | `string` (min 1) | Yes | Display name |
| `condition` | `string` | No | JavaScript condition expression — guardrail is only active when truthy |
| `classificationTrigger` | `string` | No | Label the guardrail classifier must output to trigger this guardrail |
| `effects` | `Effect[]` | No | Effects to execute when triggered |
| `examples` | `string[]` | No | Example phrases to help the classifier recognize this guardrail |
| `tags` | `string[]` | No (default: `[]`) | Tags for categorizing and filtering |
| `metadata` | `object` | No | Additional metadata |

**Response** `201 Created` — [Guardrail Response](#guardrail-response)

**Errors:** `400` Invalid body | `409` Already exists

## Get Guardrail

```http
GET /api/projects/:projectId/guardrails/:id
```

**Required permission:** `guardrail:read`

**Response** `200 OK` — [Guardrail Response](#guardrail-response)

**Errors:** `404` Not found

## List Guardrails

```http
GET /api/projects/:projectId/guardrails
```

**Required permission:** `guardrail:read`

Supports [pagination & filtering](./pagination).

**Response** `200 OK` — [Guardrail List Response](#guardrail-list-response)

## Update Guardrail

```http
PUT /api/projects/:projectId/guardrails/:id
Content-Type: application/json
```

**Required permission:** `guardrail:write`

All fields from Create are optional. `version` is required for optimistic locking.

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` (min 1) | No | Updated display name |
| `condition` | `string \| null` | No | Updated condition expression |
| `classificationTrigger` | `string \| null` | No | Updated classification trigger label |
| `effects` | `Effect[]` | No | Updated effects array |
| `examples` | `string[]` | No | Updated example phrases |
| `tags` | `string[]` | No | Updated tags |
| `metadata` | `object` | No | Updated metadata |
| `version` | `integer` (min 1) | Yes | Current version for optimistic locking |

**Response** `200 OK` — [Guardrail Response](#guardrail-response)

**Errors:** `400` | `404` | `409` Version conflict

## Delete Guardrail

```http
DELETE /api/projects/:projectId/guardrails/:id
Content-Type: application/json
```

**Required permission:** `guardrail:delete`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` (min 1) | Yes | Current version for optimistic locking |

**Response** `204 No Content`

**Errors:** `404` | `409` Version conflict

## Clone Guardrail

```http
POST /api/projects/:projectId/guardrails/:id/clone
Content-Type: application/json
```

**Required permission:** `guardrail:write`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | New ID for the cloned guardrail (auto-generated if omitted) |
| `name` | `string` | No | Name for the clone (defaults to `"{original name} (Clone)"`) |

**Response** `201 Created` — [Guardrail Response](#guardrail-response)

## Get Audit Logs

```http
GET /api/projects/:projectId/guardrails/:id/audit-logs
```

**Required permission:** `audit:read`

Returns audit log entries for the specified guardrail. See [Audit Logs](./audit-logs) for response format.

---

## Guardrail Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique identifier |
| `projectId` | `string` | No | Parent project ID |
| `name` | `string` | No | Display name |
| `condition` | `string` | Yes | Condition expression for activation |
| `classificationTrigger` | `string` | Yes | Classification label that triggers this guardrail |
| `effects` | `Effect[]` | No | Effects to execute when triggered |
| `examples` | `string[]` | Yes | Example trigger phrases |
| `tags` | `string[]` | No | Tags |
| `metadata` | `object` | Yes | Additional metadata |
| `version` | `integer` | No | Version number for optimistic locking |
| `createdAt` | `string` | No | ISO 8601 creation timestamp |
| `updatedAt` | `string` | No | ISO 8601 last update timestamp |

## Guardrail List Response

| Field | Type | Description |
|-------|------|-------------|
| `items` | `Guardrail[]` | Array of guardrails in the current page |
| `total` | `integer` | Total number of matching guardrails |
| `offset` | `integer` | Starting index of the current page |
| `limit` | `integer` | Page size |
