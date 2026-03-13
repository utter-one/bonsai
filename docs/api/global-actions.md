# Global Actions

Global actions are reusable action handlers that can be triggered across multiple stages. They respond to user input classification, conditions, or client commands.

**Tag:** `Global Actions` | **Scoped to:** Project

For more information, see the [Global Actions](../guide/global-actions) and [Actions & Effects](../guide/actions-and-effects) guides.

## Create Global Action

```http
POST /api/projects/:projectId/global-actions
Content-Type: application/json
```

**Required permission:** `global_action:write`

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
| `tags` | `string[]` | No | Tags for categorizing and filtering |
| `metadata` | `object` | No | Additional metadata |

**Response** `201 Created` — [Global Action Response](#global-action-response)

**Errors:** `400` Invalid body | `409` Already exists

## Get Global Action

```http
GET /api/projects/:projectId/global-actions/:id
```

**Required permission:** `global_action:read`

**Response** `200 OK` — [Global Action Response](#global-action-response)

## List Global Actions

```http
GET /api/projects/:projectId/global-actions
```

**Required permission:** `global_action:read`

Supports [pagination & filtering](./pagination).

## Update Global Action

```http
PUT /api/projects/:projectId/global-actions/:id
Content-Type: application/json
```

**Required permission:** `global_action:write`

All create fields are optional plus `version` (required).

**Response** `200 OK` — [Global Action Response](#global-action-response)

**Errors:** `400` | `404` | `409`

## Delete Global Action

```http
DELETE /api/projects/:projectId/global-actions/:id
Content-Type: application/json
```

**Required permission:** `global_action:delete`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` (min 1) | Yes | Current version for optimistic locking |

**Response** `204 No Content`

## Clone Global Action

```http
POST /api/projects/:projectId/global-actions/:id/clone
Content-Type: application/json
```

**Required permission:** `global_action:write`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | New ID (auto-generated if omitted) |
| `name` | `string` | No | New name (defaults to "{original name} (Clone)") |

**Response** `201 Created` — [Global Action Response](#global-action-response)

## Get Audit Logs

```http
GET /api/projects/:projectId/global-actions/:id/audit-logs
```

**Required permission:** `audit:read`

Returns audit log entries for the specified global action. See [Audit Logs](./audit-logs) for response format.

---

## Conversation Lifecycle Hooks

Global actions with the following reserved IDs act as conversation-level lifecycle hooks. They fire automatically at the corresponding event and are **excluded** from stage-level action classification.

| Reserved ID | Fires when | Restricted effects |
|---|---|---|
| `__conversation_start` | Conversation and first stage are initialised | `end_conversation`, `abort_conversation` |
| `__conversation_resume` | A previously-interrupted conversation is resumed | `end_conversation`, `abort_conversation` |
| `__conversation_end` | Conversation is gracefully ended | `go_to_stage`, `generate_response`, `abort_conversation` |
| `__conversation_abort` | Conversation is aborted (immediate stop) | `go_to_stage`, `generate_response`, `end_conversation` |
| `__conversation_failed` | Conversation encounters a fatal error | `go_to_stage`, `generate_response`, `end_conversation`, `abort_conversation` |

Create or update a global action using the standard [Create](#create-global-action) / [Update](#update-global-action) endpoints with one of these exact IDs. Only one hook per type is supported per project.

See [Global Actions — Conversation Lifecycle Hooks](../guide/global-actions#conversation-lifecycle-hooks) in the guide for use cases and examples.

---

## Content Moderation Hook

A global action with the reserved ID `__moderation_blocked` fires when user input is flagged by the project's content moderation policy. It is automatically available in every stage (global actions whose name starts with `__` are always loaded).

| Reserved ID | Fires when | Effect restrictions |
|---|---|---|
| `__moderation_blocked` | User input blocked by content moderation | None |

Create it using the standard [Create](#create-global-action) endpoint with `id: "__moderation_blocked"`. See [Global Actions — Content Moderation Hook](../guide/global-actions#content-moderation-hook) in the guide for behaviour details and use cases.

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
| `tags` | `string[]` | No | Tags |
| `metadata` | `object` | Yes | Additional metadata |
| `version` | `integer` | No | Version number |
| `createdAt` | `string` | No | ISO 8601 creation timestamp |
| `updatedAt` | `string` | No | ISO 8601 last update timestamp |
| `archived` | `boolean` | Yes | Whether this entity belongs to an archived project |
