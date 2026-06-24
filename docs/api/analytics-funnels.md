# Analytics Funnel Engine

The funnel engine measures sequential user journeys through your conversational AI experience. A funnel is an ordered series of steps; each step describes a conversation event that must occur for a user to proceed to the next step.

All endpoints are scoped to a project and require the `analytics:read` permission.

| Scoped to: Project |
|---|

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/projects/:projectId/analytics/funnels/query` | Execute an ad-hoc funnel query |
| GET | `/api/projects/:projectId/analytics/funnels/saved-queries` | List saved funnel queries |
| POST | `/api/projects/:projectId/analytics/funnels/saved-queries` | Create a saved funnel query |
| PUT | `/api/projects/:projectId/analytics/funnels/saved-queries/:id` | Update a saved funnel query |
| DELETE | `/api/projects/:projectId/analytics/funnels/saved-queries/:id` | Delete a saved funnel query |

---

## Concepts

### Funnel Steps

Each step in a funnel defines a conversation event that the user must trigger. Steps are evaluated in order — a user is counted at step *N* only if they have already reached step *N-1* within the same conversation.

A step is defined by an **event type** and a set of **params** that narrow which events of that type qualify.

### Event Types

| Event Type | Description | Required Params | Optional Params |
|---|---|---|---|
| `enter_stage` | User entered a stage | `stageName` | — |
| `end_stage` | User left a stage | `stageName` | `reason` |
| `action_fire` | A named action fired | `actionName` | — |
| `variable_changed` | A variable was updated | `variableName` | `value` (exact match) |
| `user_profile_changed` | A user profile field was updated | `profileName` | `value` (exact match) |
| `session_started` | A session was started by the user | `minSessions` (string-encoded integer ≥ 1) | — |
| `tool_response` | A tool returned a result | `toolName`, `value` (exact match on first result text) | — |

### Time Range Filtering

Time ranges work the same way as in the slice-and-dice analytics engine:

- **Absolute range**: provide `from` and/or `to` as ISO 8601 date strings.
- **Relative range**: provide a `relativeTime` object with `amount` (1–100,000) and `unit` (`hours`, `days`, `weeks`, or `months`). Relative ranges are computed from the current server time.

`relativeTime` and `from`/`to` are mutually exclusive.

---

## Execute Funnel Query

```http
POST /api/projects/:projectId/analytics/funnels/query
Content-Type: application/json
```

**Required permission:** `analytics:read`

Runs an ad-hoc funnel query and returns per-step conversion metrics.

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `steps` | `FunnelStep[]` | Yes | Ordered funnel steps (min 2, max 15) |
| `relativeTime` | `RelativeTime` | No | Relative time window (mutually exclusive with `from`/`to`) |
| `scenarioRunId` | `string` | No | Filter to conversations used by this scenario run |
| `from` | `string` (ISO 8601) | No | Start of the absolute date range (inclusive) |
| `to` | `string` (ISO 8601) | No | End of the absolute date range (inclusive) |

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `scenarioRunId` | `string` | Filter funnels to conversations used by this scenario run |

#### Funnel Step

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `eventType` | `string` | Yes | Event type (see table above) |
| `params` | `Record<string, string>` | Yes | Event parameters narrowing which events qualify |

#### Relative Time

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `amount` | `integer` (1–100,000) | Yes | Number of time units to look back |
| `unit` | `string` | Yes | Time unit: `hours`, `days`, `weeks`, or `months` |

### Response `200 OK`

| Field | Type | Description |
|-------|------|-------------|
| `totalConversionRate` | `number` | Percentage of step-1 users who reached the final step (0.0–100.0) |
| `usersAtStart` | `integer` | Unique users who matched step 1 |
| `usersAtEnd` | `integer` | Unique users who reached the final step |
| `steps` | `FunnelStepResult[]` | Per-step metrics |

#### Funnel Step Result

| Field | Type | Description |
|-------|------|-------------|
| `stepNumber` | `integer` | 1-based step index |
| `label` | `string` | Human-readable step label generated from the event type and params |
| `userCount` | `integer` | Unique users who reached this step |
| `percentage` | `number` | `userCount / usersAtStart × 100`; always `100.0` for step 1 |
| `dropoffCount` | `integer` | Users lost compared to the previous step; `0` for step 1 |
| `dropoffPercentage` | `number` | `dropoffCount / usersAtStart × 100`; `0.0` for step 1 |

### Example

```bash
curl -X POST "http://localhost:3000/api/projects/my-project/analytics/funnels/query" \
  -H "Authorization: Bearer eyJhbG..." \
  -H "Content-Type: application/json" \
  -d '{
    "steps": [
      { "eventType": "enter_stage", "params": { "stageName": "Greeting" } },
      { "eventType": "enter_stage", "params": { "stageName": "Booking" } },
      { "eventType": "action_fire",  "params": { "actionName": "submit_booking" } }
    ],
    "relativeTime": { "amount": 7, "unit": "days" }
  }'
```

```json
{
  "totalConversionRate": 42.5,
  "usersAtStart": 1200,
  "usersAtEnd": 510,
  "steps": [
    {
      "stepNumber": 1,
      "label": "Entered stage: Greeting",
      "userCount": 1200,
      "percentage": 100.0,
      "dropoffCount": 0,
      "dropoffPercentage": 0.0
    },
    {
      "stepNumber": 2,
      "label": "Entered stage: Booking",
      "userCount": 840,
      "percentage": 70.0,
      "dropoffCount": 360,
      "dropoffPercentage": 30.0
    },
    {
      "stepNumber": 3,
      "label": "Action fired: submit_booking",
      "userCount": 510,
      "percentage": 42.5,
      "dropoffCount": 330,
      "dropoffPercentage": 27.5
    }
  ]
}
```

---

## List Saved Funnel Queries

```http
GET /api/projects/:projectId/analytics/funnels/saved-queries
```

**Required permission:** `analytics:read`

Returns all saved funnel queries visible to the requesting operator: their own queries and any queries marked as shared.

### Response `200 OK`

Returns a flat array of [Saved Funnel Query Response](#saved-funnel-query-response) objects.
```

---

## Create Saved Funnel Query

```http
POST /api/projects/:projectId/analytics/funnels/saved-queries
Content-Type: application/json
```

**Required permission:** `analytics:read`

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` (1–255 chars) | Yes | Display name for the saved query |
| `query` | `FunnelQuery` | Yes | The funnel query definition to save |
| `isShared` | `boolean` | No (default: `false`) | Whether the query is visible to all operators in the project |

**Response** `201 Created` — [Saved Funnel Query Response](#saved-funnel-query-response)

---

## Update Saved Funnel Query

```http
PUT /api/projects/:projectId/analytics/funnels/saved-queries/:id
Content-Type: application/json
```

**Required permission:** `analytics:read`

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` | Yes | Current version for optimistic locking |
| `name` | `string` (1–255 chars) | No | Updated display name |
| `query` | `FunnelQuery` | No | Updated funnel query definition |
| `isShared` | `boolean` | No | Updated sharing flag |

**Response** `200 OK` — [Saved Funnel Query Response](#saved-funnel-query-response)

**Errors:** `403` Not the owner | `404` Not found | `409` Version conflict

---

## Delete Saved Funnel Query

```http
DELETE /api/projects/:projectId/analytics/funnels/saved-queries/:id
Content-Type: application/json
```

**Required permission:** `analytics:read`

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` | Yes | Current version for optimistic locking |

**Response** `204 No Content`

**Errors:** `403` Not the owner | `404` Not found | `409` Version conflict

---

## Saved Funnel Query Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique identifier |
| `name` | `string` | No | Display name |
| `projectId` | `string` | No | Project this query belongs to |
| `operatorId` | `string` | Yes | ID of the operator who created the query (`null` if the operator has been deleted) |
| `query` | `FunnelQuery` | No | Stored funnel query definition |
| `isShared` | `boolean` | No | Whether the query is shared with all project operators |
| `version` | `integer` | No | Version number |
| `createdAt` | `string` | Yes | ISO 8601 creation timestamp |
| `updatedAt` | `string` | Yes | ISO 8601 last-updated timestamp |
