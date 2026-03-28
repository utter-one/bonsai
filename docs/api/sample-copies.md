# Sample Copies

Sample copies hold a set of variant answers that the system selects from at runtime based on a classifier trigger. They are used to deliver pre-written, prescripted responses while still leveraging the AI pipeline for context and delivery.

**Tag:** `Sample Copies` | **Scoped to:** Project

For more information, see the [Sample Copies](../guide/sample-copies) guide.

## Create Sample Copy

```http
POST /api/projects/:projectId/sample-copies
Content-Type: application/json
```

**Required permission:** `sample_copy:write`

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` (min 1) | No | Unique identifier (auto-generated if omitted) |
| `name` | `string` (min 1) | Yes | Display name, used as identifier throughout the system (must be unique per project) |
| `stages` | `string[]` | No | Stage IDs this sample copy applies to; omit to apply to all stages |
| `agents` | `string[]` | No | Agent IDs this sample copy applies to; omit to apply to all agents |
| `promptTrigger` | `string` (min 1) | Yes | Trigger string used by the classifier to activate this sample copy |
| `classifierOverrideId` | `string \| null` | No | Classifier ID to use instead of the project default |
| `content` | `string[]` (min 1 item) | Yes | Array of variant answers to select from |
| `amount` | `integer` (min 1) | No (default: `1`) | Number of items to sample from `content` on each turn |
| `samplingMethod` | `"random" \| "round_robin"` | No (default: `"random"`) | How to select items: random shuffle or sequential round-robin |
| `mode` | `"regular" \| "forced"` | No (default: `"regular"`) | `regular` injects selected copy into context; `forced` bypasses the LLM and delivers copy directly as the response |
| `decoratorId` | `string \| null` | No | Copy decorator ID to apply to selected content; `null` for no decoration |

**Response** `201 Created` — [Sample Copy Response](#sample-copy-response)

**Errors:** `400` Invalid body | `409` Name already exists in this project

## Get Sample Copy

```http
GET /api/projects/:projectId/sample-copies/:id
```

**Required permission:** `sample_copy:read`

**Response** `200 OK` — [Sample Copy Response](#sample-copy-response)

**Errors:** `404` Not found

## List Sample Copies

```http
GET /api/projects/:projectId/sample-copies
```

**Required permission:** `sample_copy:read`

Supports [pagination & filtering](./pagination).

Text search matches against `name` and `promptTrigger`.

**Response** `200 OK` — Paginated list of [Sample Copy Response](#sample-copy-response)

## Update Sample Copy

```http
PUT /api/projects/:projectId/sample-copies/:id
Content-Type: application/json
```

**Required permission:** `sample_copy:write`

All create fields are optional plus `version` (required for optimistic locking).

**Response** `200 OK` — [Sample Copy Response](#sample-copy-response)

**Errors:** `400` Invalid body | `404` Not found | `409` Version conflict

## Delete Sample Copy

```http
DELETE /api/projects/:projectId/sample-copies/:id
Content-Type: application/json
```

**Required permission:** `sample_copy:delete`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` (min 1) | Yes | Current version for optimistic locking |

**Response** `204 No Content`

**Errors:** `400` | `404` | `409` Version conflict

## Clone Sample Copy

```http
POST /api/projects/:projectId/sample-copies/:id/clone
Content-Type: application/json
```

**Required permission:** `sample_copy:write`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | New ID (auto-generated if omitted) |
| `name` | `string` | No | New name (defaults to `"{original name} (Clone)"`) |

**Response** `201 Created` — [Sample Copy Response](#sample-copy-response)

**Errors:** `400` | `404` | `409` Name conflict

## Get Audit Logs

```http
GET /api/projects/:projectId/sample-copies/:id/audit-logs
```

**Required permission:** `audit:read`

Returns audit log entries for the specified sample copy. See [Audit Logs](./audit-logs) for response format.

---

## Sample Copy Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique identifier |
| `projectId` | `string` | No | Parent project ID |
| `name` | `string` | No | Display name (unique per project) |
| `stages` | `string[]` | Yes | Stage IDs this copy applies to; `null` means all stages |
| `agents` | `string[]` | Yes | Agent IDs this copy applies to; `null` means all agents |
| `promptTrigger` | `string` | No | Classifier trigger string |
| `classifierOverrideId` | `string` | Yes | Classifier override ID, or `null` for project default |
| `content` | `string[]` | No | Array of variant answers |
| `amount` | `integer` | No | Number of items sampled per turn |
| `samplingMethod` | `"random" \| "round_robin"` | No | Sampling strategy |
| `mode` | `"regular" \| "forced"` | No | `regular` or `forced` response mode |
| `decoratorId` | `string` | Yes | Copy decorator ID, or `null` if none |
| `version` | `integer` | No | Version number for optimistic locking |
| `createdAt` | `string` | No | ISO 8601 creation timestamp |
| `updatedAt` | `string` | No | ISO 8601 last update timestamp |
| `archived` | `boolean` | Yes | Whether this entity belongs to an archived project |
