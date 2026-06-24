# Saved Slice Queries

Saved slice queries allow operators to store named analytics query configurations for reuse. A saved query contains the full slice-and-dice configuration (source, metrics, groupBy, filters, etc.) along with metadata for UI display settings.

All endpoints are scoped to a project and require the `analytics:read` permission.

| Scoped to: Project |
|---|

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects/:projectId/analytics/saved-queries` | List saved slice queries |
| POST | `/api/projects/:projectId/analytics/saved-queries` | Create a saved slice query |
| GET | `/api/projects/:projectId/analytics/saved-queries/:id` | Get a saved slice query |
| PUT | `/api/projects/:projectId/analytics/saved-queries/:id` | Update a saved slice query |
| DELETE | `/api/projects/:projectId/analytics/saved-queries/:id` | Delete a saved slice query |

---

## List Saved Slice Queries

```
GET /api/projects/:projectId/analytics/saved-queries
```

**Required permission:** `analytics:read`

Returns the operator's own saved queries plus all shared queries within the project.

### Response

| Field | Type | Description |
|-------|------|-------------|
| `savedQueries` | `SavedSliceQuery[]` | List of saved slice queries |

---

## Create Saved Slice Query

```
POST /api/projects/:projectId/analytics/saved-queries
Content-Type: application/json
```

**Required permission:** `analytics:write`

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` (min 1, max 255) | Yes | Unique name for this saved query within the project |
| `query` | `SliceQuery` | Yes | The full slice query configuration to save |
| `isShared` | `boolean` | No (default: `false`) | Whether this query is visible to all operators in the project |
| `metadata` | `Record<string, unknown>` or `null` | No | Arbitrary key-value metadata, e.g. chart display settings from the UI |

### Response

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier of the saved query |
| `name` | `string` | Name of the saved query |
| `projectId` | `string` | Project this query belongs to |
| `operatorId` | `string` or `null` | Operator who created this query |
| `query` | `SliceQuery` | The saved slice query configuration |
| `isShared` | `boolean` | Whether this query is visible to all operators |
| `metadata` | `Record<string, unknown>` or `null` | Arbitrary key-value metadata |
| `version` | `integer` | Version number for optimistic locking |
| `createdAt` | `string` (ISO 8601) | Creation timestamp |
| `updatedAt` | `string` (ISO 8601) | Last update timestamp |

**Errors:** `409` Name already exists in the project

---

## Get Saved Slice Query

```
GET /api/projects/:projectId/analytics/saved-queries/:id
```

**Required permission:** `analytics:read`

### Response

`SavedSliceQuery` object (see above)

**Errors:** `404` Not found

---

## Update Saved Slice Query

```
PUT /api/projects/:projectId/analytics/saved-queries/:id
Content-Type: application/json
```

**Required permission:** `analytics:write`

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` (min 1, max 255) | No | Updated name |
| `query` | `SliceQuery` | No | Updated slice query configuration |
| `isShared` | `boolean` | No | Updated sharing flag |
| `metadata` | `Record<string, unknown>` or `null` | No | Updated metadata |
| `version` | `integer` (min 1) | Yes | Current version number for optimistic locking |

### Response

`SavedSliceQuery` object (see above)

**Errors:** `404` Not found | `409` Version conflict or name already taken

---

## Delete Saved Slice Query

```
DELETE /api/projects/:projectId/analytics/saved-queries/:id
Content-Type: application/json
```

**Required permission:** `analytics:write`

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` (min 1) | Yes | Current version number for optimistic locking |

### Response

`204 No Content`

**Errors:** `404` Not found | `409` Version conflict

---

## SliceQuery Configuration

The `query` field accepts the same configuration as the [Analytics Query Engine](./analytics-query.md):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `source` | `string` | Yes | Source to query (e.g. `turns`, `conversations`, `tool_calls`) |
| `metrics` | `string[]` (min 1, max 10) | Yes | Metric specifications (e.g. `count`, `avg:durationMs`) |
| `groupBy` | `string[]` (max 5) | No | Dimension IDs to group by |
| `normalizeBy` | `string` | No | Dimension for two-phase aggregation |
| `interval` | `string` | No | Time bucket: `hour`, `day`, `week`, `month` |
| `from` | `string` (ISO 8601) | No | Date range start |
| `to` | `string` (ISO 8601) | No | Date range end |
| `relativeTime` | `object` | No | Relative time range |
| `scenarioRunId` | `string` | No | Filter to scenario run conversations |
| `filters` | `Record<string, string>` | No | Dimension equality filters |
| `limit` | `integer` (1–10,000) | No (default: 1000) | Maximum rows |

See [Analytics Query Engine](./analytics-query.md) for full details.
