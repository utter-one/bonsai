# Global Actions

Global actions are reusable action handlers that can be triggered across multiple stages. They respond to user input classification, conditions, or client commands.

**Tag:** `Global Actions` | **Scoped to:** Project

## Endpoints

| Method | Path | Summary | Permission |
|--------|------|---------|------------|
| `POST` | `/api/projects/:projectId/global-actions` | Create | `global_action:write` |
| `GET` | `/api/projects/:projectId/global-actions/:id` | Get by ID | `global_action:read` |
| `GET` | `/api/projects/:projectId/global-actions` | List | `global_action:read` |
| `PUT` | `/api/projects/:projectId/global-actions/:id` | Update | `global_action:write` |
| `DELETE` | `/api/projects/:projectId/global-actions/:id` | Delete | `global_action:delete` |
| `GET` | `/api/projects/:projectId/global-actions/:id/audit-logs` | Get audit logs | `audit:read` |
| `POST` | `/api/projects/:projectId/global-actions/:id/clone` | Clone | `global_action:write` |

## Create Global Action

```http
POST /api/projects/:projectId/global-actions
Content-Type: application/json
```

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` (min 1) | No | Unique identifier (auto-generated if omitted) |
| `name` | `string` (min 1) | Yes | Display name |
| `condition` | `string` | No | Condition expression for action activation |
| `triggerOnUserInput` | `boolean` | No (default: `true`) | Trigger when user sends input |
| `triggerOnClientCommand` | `boolean` | No (default: `false`) | Trigger on client commands |
| `classificationTrigger` | `string` | No | Classification label that triggers this action |
| `overrideClassifierId` | `string` | No | Classifier ID override |
| `parameters` | `StageActionParameter[]` | No | Parameters to extract from user input |
| `effects` | `Effect[]` | No | Effects to execute when triggered |
| `examples` | `string[]` | No | Example trigger phrases |
| `metadata` | `object` | No | Additional metadata |

**Response** `201 Created` — [Global Action Response](#global-action-response)

**Errors:** `400` Invalid body | `409` Already exists

## Get Global Action

```http
GET /api/projects/:projectId/global-actions/:id
```

**Response** `200 OK` — [Global Action Response](#global-action-response)

## List Global Actions

```http
GET /api/projects/:projectId/global-actions
```

Supports [pagination & filtering](./pagination).

## Update Global Action

```http
PUT /api/projects/:projectId/global-actions/:id
Content-Type: application/json
```

All create fields are optional plus `version` (required).

**Response** `200 OK` — [Global Action Response](#global-action-response)

**Errors:** `400` | `404` | `409`

## Delete Global Action

```http
DELETE /api/projects/:projectId/global-actions/:id
Content-Type: application/json
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` (min 1) | Yes | Current version for optimistic locking |

**Response** `204 No Content`

## Clone Global Action

```http
POST /api/projects/:projectId/global-actions/:id/clone
Content-Type: application/json
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | New ID (auto-generated if omitted) |
| `name` | `string` | No | New name (defaults to "{original name} (Clone)") |

**Response** `201 Created` — [Global Action Response](#global-action-response)

---

## Global Action Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique identifier |
| `projectId` | `string` | No | Parent project ID |
| `name` | `string` | No | Display name |
| `condition` | `string` | Yes | Condition expression |
| `triggerOnUserInput` | `boolean` | No | Triggered on user input |
| `triggerOnClientCommand` | `boolean` | No | Triggered on client commands |
| `classificationTrigger` | `string` | Yes | Classification trigger label |
| `overrideClassifierId` | `string` | Yes | Classifier override ID |
| `parameters` | `StageActionParameter[]` | No | Parameters array |
| `effects` | `Effect[]` | No | Effects array |
| `examples` | `string[]` | Yes | Example phrases |
| `metadata` | `object` | Yes | Additional metadata |
| `version` | `integer` | No | Version number |
| `createdAt` | `string` | No | ISO 8601 creation timestamp |
| `updatedAt` | `string` | No | ISO 8601 last update timestamp |
